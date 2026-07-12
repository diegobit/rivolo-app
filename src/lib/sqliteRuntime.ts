import type { Database, Sqlite3Static, SqlValue } from '@sqlite.org/sqlite-wasm'

export type RivoloDatabase = Database
export type RivoloSqlite = Sqlite3Static
export type SqlParam = string | number | null

const FTS_TRIGRAM_SCHEMA = /tokenize\s*=\s*['"]trigram['"]/i

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
  const ftsNeedsRebuild =
    typeof existingFtsSchema !== 'string' || !FTS_TRIGRAM_SCHEMA.test(existingFtsSchema)

  if (ftsNeedsRebuild) {
    db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS days_fts')
      db.exec(`
        CREATE VIRTUAL TABLE days_fts
        USING fts5(day_id UNINDEXED, human_title, content_md, tokenize='trigram');
      `)
      db.exec(`
        INSERT INTO days_fts (day_id, human_title, content_md)
        SELECT day_id, human_title, content_md FROM days;
      `)
    })
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
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

  return { ftsAvailable: true, ftsRebuilt: ftsNeedsRebuild }
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
