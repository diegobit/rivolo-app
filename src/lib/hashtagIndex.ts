import type { Database } from '@sqlite.org/sqlite-wasm'
import { countHashtags, normalizeNoteToken } from './noteTokens'

export type HashtagSuggestion = { token: string; count: number }

export const ensureHashtagIndexSchema = (db: Database) => {
  const created = !db.selectValue("SELECT name FROM sqlite_master WHERE name = 'day_hashtags'")
  db.exec(`
    CREATE TABLE IF NOT EXISTS day_hashtags (
      day_id TEXT NOT NULL, token TEXT NOT NULL, count INTEGER NOT NULL CHECK(count > 0),
      PRIMARY KEY(day_id, token)
    );
    CREATE INDEX IF NOT EXISTS hashtags_by_token ON day_hashtags(token, day_id);
    CREATE TABLE IF NOT EXISTS hashtag_dirty_days (day_id TEXT PRIMARY KEY);
    CREATE TRIGGER IF NOT EXISTS hashtags_insert AFTER INSERT ON days BEGIN
      INSERT INTO hashtag_dirty_days VALUES (NEW.day_id) ON CONFLICT(day_id) DO NOTHING;
    END;
    CREATE TRIGGER IF NOT EXISTS hashtags_update AFTER UPDATE ON days
    WHEN NEW.content_md != OLD.content_md OR NEW.day_id != OLD.day_id BEGIN
      INSERT INTO hashtag_dirty_days VALUES (OLD.day_id) ON CONFLICT(day_id) DO NOTHING;
      INSERT INTO hashtag_dirty_days VALUES (NEW.day_id) ON CONFLICT(day_id) DO NOTHING;
    END;
    CREATE TRIGGER IF NOT EXISTS hashtags_delete AFTER DELETE ON days BEGIN
      INSERT INTO hashtag_dirty_days VALUES (OLD.day_id) ON CONFLICT(day_id) DO NOTHING;
    END;
  `)
  if (created) db.exec('INSERT OR IGNORE INTO hashtag_dirty_days SELECT day_id FROM days')
  return created
}

export const hasDirtyHashtags = (db: Database) =>
  Boolean(db.selectValue('SELECT 1 FROM hashtag_dirty_days LIMIT 1'))

// Called inside a synchronous transaction. The dirty queue is persisted with
// each note mutation, including imports, raw sync writes, moves and deletions.
// Pure SQL triggers also keep it recoverable when an older client writes notes.
export const refreshHashtagIndex = (db: Database) => {
  const days = db.selectObjects(`
    SELECT dirty.day_id, days.content_md FROM hashtag_dirty_days dirty
    LEFT JOIN days ON days.day_id = dirty.day_id
  `)
  const remove = db.prepare('DELETE FROM day_hashtags WHERE day_id = ?')
  const insert = db.prepare('INSERT INTO day_hashtags (day_id, token, count) VALUES (?, ?, ?)')
  try {
    for (const day of days) {
      const dayId = String(day.day_id)
      remove.bind([dayId]).step()
      remove.reset(true)
      if (typeof day.content_md !== 'string') continue
      for (const [token, count] of countHashtags(day.content_md)) {
        insert.bind([dayId, token, count]).step()
        insert.reset(true)
      }
    }
    db.exec('DELETE FROM hashtag_dirty_days')
  } finally {
    remove.finalize()
    insert.finalize()
  }
}

export const readHashtagSuggestions = (db: Database, prefix: string, excludeDayId: string, limit = 20): HashtagSuggestion[] =>
  db.selectObjects(`
    SELECT token, SUM(count) AS count FROM day_hashtags
    WHERE token >= ? AND token < ? AND token != ? AND day_id != ?
    GROUP BY token ORDER BY count DESC, token LIMIT ?
  `, [normalizeNoteToken(prefix), `${normalizeNoteToken(prefix)}\u{10ffff}`, normalizeNoteToken(prefix), excludeDayId, limit])
    .map((row) => ({ token: String(row.token), count: Number(row.count) }))
