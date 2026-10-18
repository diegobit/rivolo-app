// @vitest-environment node
import initSqlite from '@sqlite.org/sqlite-wasm'
import { beforeAll, describe, expect, it } from 'vitest'
import { ensureDatabaseSchema, executeSql, exportSerializedDatabase, openSerializedDatabase, type RivoloSqlite } from './sqliteRuntime'
import { hasDirtyHashtags, readHashtagSuggestions, refreshHashtagIndex } from './hashtagIndex'
import { countHashtags } from './noteTokens'
import { listTagsFromDays, searchDaysInMemory } from './notesCore'

describe('SQLite hashtag index', () => {
  let sqlite: RivoloSqlite
  beforeAll(async () => { sqlite = await initSqlite() })

  it('backfills all existing days and keeps Unicode, case, hyphens and duplicates consistent with search', () => {
    const db = openSerializedDatabase(sqlite)
    db.exec('CREATE TABLE days (day_id TEXT PRIMARY KEY, human_title TEXT, content_md TEXT, created_at INTEGER, updated_at INTEGER)')
    const content = '#FCRF #fcrf #next #next-ai #novità #novita\u0300 #東京\n### Heading\ncittà#fake email@alice ##not-a-tag'
    executeSql(db, 'INSERT INTO days VALUES (?, ?, ?, ?, ?)', ['2020-01-01', 'Old', content, 1, 1])
    ensureDatabaseSchema(db)
    expect(hasDirtyHashtags(db)).toBe(true)
    db.transaction(() => refreshHashtagIndex(db))
    expect(hasDirtyHashtags(db)).toBe(false)
    expect(readHashtagSuggestions(db, '#ne', '')).toEqual([{ token: '#next', count: 1 }, { token: '#next-ai', count: 1 }])
    expect(readHashtagSuggestions(db, '#F', '')).toEqual([{ token: '#fcrf', count: 2 }])
    expect(readHashtagSuggestions(db, '#nov', '')).toEqual([{ token: '#novità', count: 2 }])
    expect(readHashtagSuggestions(db, '#東', '')).toEqual([{ token: '#東京', count: 1 }])
    expect(readHashtagSuggestions(db, '#', '')).toHaveLength(5)
    const day = { dayId: '2020-01-01', humanTitle: 'Old', contentMd: content, createdAt: 1, updatedAt: 1 }
    expect(listTagsFromDays([day]).map(({ token, count }) => [token, count])).toEqual([...countHashtags(content)].sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b)))
    expect(searchDaysInMemory([day], '#novità', { filter: 'tags' })).toHaveLength(1)
    expect(db.selectValue('SELECT content_md FROM days')).toBe(content)
    db.close()
  })

  it('recovers persisted edits and removals, handles raw sync upserts and moves, and rolls back with notes', () => {
    let db = openSerializedDatabase(sqlite)
    ensureDatabaseSchema(db)
    db.exec("INSERT INTO days VALUES ('2026-10-01', 'One', '#next #fcrf', 1, 1)")
    db.exec("INSERT INTO days VALUES ('2026-10-02', 'Two', '#next-ai #fcrf', 1, 1)")
    db.transaction(() => refreshHashtagIndex(db))
    // The daily-sync path writes directly rather than going through saveDay.
    db.exec("INSERT INTO days VALUES ('2026-10-01', 'One', '#novità', 1, 2) ON CONFLICT(day_id) DO UPDATE SET content_md = excluded.content_md")
    db.exec("UPDATE days SET day_id = '2026-10-03' WHERE day_id = '2026-10-02'")
    const bytes = exportSerializedDatabase(sqlite, db)
    db.close()
    db = openSerializedDatabase(sqlite, bytes)
    expect(ensureDatabaseSchema(db).hashtagIndexCreated).toBe(false)
    db.transaction(() => refreshHashtagIndex(db))
    expect(readHashtagSuggestions(db, '#ne', '')).toEqual([{ token: '#next-ai', count: 1 }])
    expect(readHashtagSuggestions(db, '#f', '2026-10-03')).toEqual([])
    expect(db.selectValue("SELECT COUNT(*) FROM day_hashtags WHERE day_id = '2026-10-02'")).toBe(0)
    expect(() => db.transaction(() => {
      db.exec("DELETE FROM days WHERE day_id = '2026-10-03'")
      refreshHashtagIndex(db)
      throw new Error('failed import')
    })).toThrow('failed import')
    expect(readHashtagSuggestions(db, '#f', '')).toEqual([{ token: '#fcrf', count: 1 }])
    db.exec("DELETE FROM days WHERE day_id = '2026-10-03'")
    db.transaction(() => refreshHashtagIndex(db))
    expect(readHashtagSuggestions(db, '#f', '')).toEqual([])
    // Whole-notebook replacement used by imports/Dropbox/Google Drive.
    db.transaction(() => {
      db.exec('DELETE FROM days')
      db.exec("INSERT INTO days VALUES ('2026-10-04', 'New', '#next-ai', 1, 1)")
    })
    db.transaction(() => refreshHashtagIndex(db))
    expect(readHashtagSuggestions(db, '#nov', '')).toEqual([])
    expect(readHashtagSuggestions(db, '#ne', '')).toEqual([{ token: '#next-ai', count: 1 }])
    const indexed = exportSerializedDatabase(sqlite, db)
    db.close()
    db = openSerializedDatabase(sqlite, indexed)
    ensureDatabaseSchema(db)
    expect(hasDirtyHashtags(db)).toBe(false)
    expect(readHashtagSuggestions(db, '#ne', '')).toEqual([{ token: '#next-ai', count: 1 }])
    db.close()
  })
})
