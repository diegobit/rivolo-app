import type { Database, Sqlite3Static, SqlValue } from '@sqlite.org/sqlite-wasm'
import { ensureHashtagIndexSchema } from './hashtagIndex'

export type RivoloDatabase = Database
export type RivoloSqlite = Sqlite3Static
export type SqlParam = string | number | null

const FTS_TRIGRAM_SCHEMA = /tokenize\s*=\s*['"]trigram['"]/i

// Each day's search entry lives at a row number taken from its date
// (2026-07-14 -> 20260714), so replacing or deleting it is a direct lookup
// instead of a scan of every entry: day_id is UNINDEXED in the index.
const FTS_ROWID_SQL = "CAST(replace(day_id, '-', '') AS INTEGER)"
export const dayFtsRowid = (dayId: string) => Number(dayId.replace(/-/g, ''))

export const executeSql = (db: RivoloDatabase, sql: string, params: SqlParam[] = []) => {
  if (!params.length) {
    db.exec(sql)
    return
  }

  db.exec({ sql, bind: params })
}

export const openSerializedDatabase = (
  sqlite: RivoloSqlite,
  stored?: ArrayBuffer | Uint8Array | null,
) => {
  const db = new sqlite.oo1.DB()
  if (!stored) return db

  const bytes = stored instanceof Uint8Array ? stored : new Uint8Array(stored)
  const pointer = sqlite.wasm.allocFromTypedArray(bytes)
  const flags =
    sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
    sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE
  const result = sqlite.capi.sqlite3_deserialize(
    db,
    'main',
    pointer,
    bytes.byteLength,
    bytes.byteLength,
    flags,
  )

  if (result !== sqlite.capi.SQLITE_OK) {
    sqlite.wasm.dealloc(pointer)
    db.close()
    throw new Error(`Could not open the saved database (SQLite result ${result}).`)
  }

  return db
}

export const exportSerializedDatabase = (sqlite: RivoloSqlite, db: RivoloDatabase) =>
  sqlite.capi.sqlite3_js_db_export(db)

export const ensureDatabaseSchema = (db: RivoloDatabase) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS days (
      day_id TEXT PRIMARY KEY,
      human_title TEXT NOT NULL,
      content_md TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  const existingFtsSchema = db.selectValue(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'days_fts' LIMIT 1",
  )
  // An index built before date row numbers, or touched by an older app
  // version since, has entries elsewhere; rebuilding puts them back in place.
  const ftsNeedsRebuild =
    typeof existingFtsSchema !== 'string' ||
    !FTS_TRIGRAM_SCHEMA.test(existingFtsSchema) ||
    db.selectValue(`SELECT 1 FROM days_fts WHERE rowid <> ${FTS_ROWID_SQL} LIMIT 1`) !== undefined

  if (ftsNeedsRebuild) {
    db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS days_fts')
      db.exec(`
        CREATE VIRTUAL TABLE days_fts
        USING fts5(day_id UNINDEXED, human_title, content_md, tokenize='trigram');
      `)
      db.exec(`
        INSERT INTO days_fts (rowid, day_id, human_title, content_md)
        SELECT ${FTS_ROWID_SQL}, day_id, human_title, content_md FROM days
        WHERE day_id GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
      `)
    })
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // The journal is updated by the same SQLite statement as the note. A crash
  // cannot persist an edit (including an AI/MCP write) without its sync intent.
  db.exec(`
    CREATE TABLE IF NOT EXISTS onedrive_day_changes (
      day_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, deleted INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS onedrive_daily_state (
      target TEXT NOT NULL, day_id TEXT NOT NULL, revision INTEGER NOT NULL,
      value TEXT NOT NULL, error TEXT, PRIMARY KEY (target, day_id)
    );
  `)
  // Upgrade early daily-sync databases without discarding their checkpoints.
  if (!queryRows<{ name: string }>(db, 'PRAGMA table_info(onedrive_daily_state)').some((column) => column.name === 'error')) {
    db.exec('ALTER TABLE onedrive_daily_state ADD COLUMN error TEXT')
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS onedrive_daily_errors ON onedrive_daily_state(target, error);
    CREATE TABLE IF NOT EXISTS onedrive_outbox (
      context TEXT NOT NULL, item TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (context, item)
    );
    INSERT OR IGNORE INTO onedrive_day_changes
      SELECT day_id, 1, 0 FROM days WHERE content_md != '';
    CREATE TRIGGER IF NOT EXISTS onedrive_day_insert AFTER INSERT ON days
    WHEN NEW.content_md != '' BEGIN
      INSERT INTO onedrive_day_changes VALUES (NEW.day_id, 1, 0)
      ON CONFLICT(day_id) DO UPDATE SET revision = revision + 1, deleted = 0;
    END;
    CREATE TRIGGER IF NOT EXISTS onedrive_day_update AFTER UPDATE ON days
    WHEN NEW.content_md != OLD.content_md OR NEW.human_title != OLD.human_title OR NEW.day_id != OLD.day_id BEGIN
      INSERT INTO onedrive_day_changes VALUES (NEW.day_id, 1, 0)
      ON CONFLICT(day_id) DO UPDATE SET revision = revision + 1, deleted = 0;
      INSERT INTO onedrive_day_changes SELECT OLD.day_id, 1, 1 WHERE OLD.day_id != NEW.day_id
      ON CONFLICT(day_id) DO UPDATE SET revision = revision + 1, deleted = 1;
    END;
    CREATE TRIGGER IF NOT EXISTS onedrive_day_delete AFTER DELETE ON days BEGIN
      INSERT INTO onedrive_day_changes VALUES (OLD.day_id, 1, 1)
      ON CONFLICT(day_id) DO UPDATE SET revision = revision + 1, deleted = 1;
    END;
    INSERT INTO settings VALUES ('onedrive.daily.schema', '1')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta_json TEXT
    );
  `)

  const hashtagIndexCreated = ensureHashtagIndexSchema(db)
  return { ftsAvailable: true, ftsRebuilt: ftsNeedsRebuild, hashtagIndexCreated }
}

export const queryRows = <T>(db: RivoloDatabase, sql: string, params: SqlParam[] = []) => {
  const statement = db.prepare(sql)
  const rows: T[] = []

  try {
    if (params.length) statement.bind(params)
    while (statement.step()) {
      rows.push(statement.get({}) as T)
    }
  } finally {
    statement.finalize()
  }

  return rows
}

export const queryFirstRow = <T>(
  db: RivoloDatabase,
  sql: string,
  params: SqlParam[] = [],
) => {
  const statement = db.prepare(sql)

  try {
    if (params.length) statement.bind(params)
    return statement.step() ? (statement.get({}) as T) : null
  } finally {
    statement.finalize()
  }
}

export const quoteFtsPhrase = (query: string) => `"${query.replace(/"/g, '""')}"`

export const isAtLeastThreeCodePoints = (value: string) => [...value].length >= 3

export const isAscii = (value: string) =>
  [...value].every((character) => (character.codePointAt(0) ?? 0x80) <= 0x7f)

export type { SqlValue }
