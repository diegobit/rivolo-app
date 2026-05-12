import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { get, set } from 'idb-keyval'

const DB_KEY = 'single-note-db'

let sqlPromise: Promise<SqlJsStatic> | null = null
let dbPromise: Promise<Database> | null = null
let saveTimer: number | null = null
let pendingSavePromise: Promise<void> | null = null
let bulkMutationDepth = 0
let bulkMutationDirty = false
let ftsAvailable: boolean | null = null

const ensureSql = () => {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => sqlWasmUrl })
  }

  return sqlPromise
}

const ensureSchema = (db: Database) => {
  db.run(`
    CREATE TABLE IF NOT EXISTS days (
      day_id TEXT PRIMARY KEY,
      human_title TEXT NOT NULL,
      content_md TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  try {
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS days_fts
      USING fts5(day_id UNINDEXED, human_title, content_md);
    `)
    ftsAvailable = true
  } catch (error) {
    ftsAvailable = false
    console.warn('FTS5 unavailable, falling back to LIKE search.', error)
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta_json TEXT
    );
  `)
}

const persistDatabase = (db: Database) => {
  const data = db.export()
  const savePromise = set(DB_KEY, data)
  pendingSavePromise = savePromise

  savePromise.catch((error: unknown) => {
    console.error('[DB] persist:failed', { error })
  }).finally(() => {
    if (pendingSavePromise === savePromise) {
      pendingSavePromise = null
    }
  })

  return savePromise
}

const scheduleSave = (db: Database) => {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
  }

  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void persistDatabase(db)
  }, 400)
}

const markDatabaseChanged = (db: Database) => {
  if (bulkMutationDepth > 0) {
    bulkMutationDirty = true
    return
  }

  scheduleSave(db)
}

export const flushDatabaseSave = async () => {
  const db = await getDatabase()

  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }

  if (pendingSavePromise) {
    await pendingSavePromise
  }

  await persistDatabase(db)
}

export const getDatabase = async () => {
  if (!dbPromise) {
    dbPromise = (async () => {
      const SQL = await ensureSql()
      const stored = await get(DB_KEY)
      const db = stored ? new SQL.Database(new Uint8Array(stored)) : new SQL.Database()
      ensureSchema(db)
      return db
    })()
  }

  return dbPromise
}

export const run = async (sql: string, params: (string | number | null)[] = []) => {
  const db = await getDatabase()
  db.run(sql, params)
  markDatabaseChanged(db)
}

export const runBulkDatabaseMutation = async <T>(callback: () => Promise<T>) => {
  const isOutermostBulk = bulkMutationDepth === 0
  bulkMutationDepth += 1
  let result: T

  try {
    result = await callback()
  } catch (error) {
    bulkMutationDepth -= 1
    if (isOutermostBulk) {
      bulkMutationDirty = false
    }
    throw error
  }

  bulkMutationDepth -= 1

  if (isOutermostBulk && bulkMutationDirty) {
    bulkMutationDirty = false
    await flushDatabaseSave()
  }

  return result
}

export const queryAll = async <T = Record<string, string | number | null>>(
  sql: string,
  params: (string | number | null)[] = [],
): Promise<T[]> => {
  const db = await getDatabase()
  const statement = db.prepare(sql)
  statement.bind(params)
  const rows: T[] = []

  while (statement.step()) {
    rows.push(statement.getAsObject() as T)
  }

  statement.free()
  return rows
}

export const queryOne = async <T = Record<string, string | number | null>>(
  sql: string,
  params: (string | number | null)[] = [],
): Promise<T | null> => {
  const db = await getDatabase()
  const statement = db.prepare(sql)
  statement.bind(params)
  const result = statement.step() ? (statement.getAsObject() as T) : null
  statement.free()
  return result
}

export const isFtsAvailable = async () => {
  await getDatabase()
  return Boolean(ftsAvailable)
}

export const upsertFts = async (
  dayId: string,
  humanTitle: string,
  content: string,
) => {
  if (!(await isFtsAvailable())) {
    return
  }

  const db = await getDatabase()
  db.run('DELETE FROM days_fts WHERE day_id = ?', [dayId])
  db.run('INSERT INTO days_fts (day_id, human_title, content_md) VALUES (?, ?, ?)', [
    dayId,
    humanTitle,
    content,
  ])
  markDatabaseChanged(db)
}
