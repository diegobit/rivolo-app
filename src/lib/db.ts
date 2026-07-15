import initSqlite from '@sqlite.org/sqlite-wasm'
import sqliteWasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url'
import { get, set } from 'idb-keyval'
import {
  assertDatabaseWritable,
  beginDatabaseSnapshotLoad,
  broadcastDatabasePersisted,
} from './tabSyncCoordinator'
import {
  ensureDatabaseSchema,
  executeSql,
  exportSerializedDatabase,
  openSerializedDatabase,
  queryFirstRow,
  queryRows,
  type RivoloDatabase,
  type RivoloSqlite,
} from './sqliteRuntime'

const DB_KEY = 'single-note-db'
const PERSIST_FAILURE_MESSAGE = 'Your notes could not be saved on this device. Check available storage and try again.'

let sqlPromise: Promise<RivoloSqlite> | null = null
let dbPromise: Promise<RivoloDatabase> | null = null
let saveTimer: number | null = null
let pendingSavePromise: Promise<void> | null = null
let bulkMutationDepth = 0
let bulkMutationDirty = false
let ftsAvailable: boolean | null = null

let persistFailureMessage: string | null = null
const persistFailureListeners = new Set<() => void>()

const setPersistFailureMessage = (message: string | null) => {
  if (persistFailureMessage === message) return
  persistFailureMessage = message
  persistFailureListeners.forEach((listener) => listener())
}

export const subscribeDatabasePersistFailure = (listener: () => void) => {
  persistFailureListeners.add(listener)
  return () => persistFailureListeners.delete(listener)
}

export const getDatabasePersistFailureSnapshot = () => persistFailureMessage

const ensureSql = () => {
  if (!sqlPromise) {
    const initialize = initSqlite as unknown as (options: {
      locateFile: () => string
    }) => Promise<RivoloSqlite>
    sqlPromise = initialize({ locateFile: () => sqliteWasmUrl }).catch(
      (error) => {
        sqlPromise = null
        throw error
      },
    )
  }

  return sqlPromise
}

export const persistDatabase = async (db: RivoloDatabase) => {
  assertDatabaseWritable()
  const sqlite = await ensureSql()
  const data = exportSerializedDatabase(sqlite, db)
  const savePromise = set(DB_KEY, data).then(() => {
    broadcastDatabasePersisted()
    setPersistFailureMessage(null)
  })
  pendingSavePromise = savePromise

  savePromise.catch((error: unknown) => {
    console.error('[DB] persist:failed', { error })
    setPersistFailureMessage(PERSIST_FAILURE_MESSAGE)
  }).finally(() => {
    if (pendingSavePromise === savePromise) {
      pendingSavePromise = null
    }
  })

  return savePromise
}

const scheduleSave = (db: RivoloDatabase) => {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
  }

  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void persistDatabase(db).catch((error) => {
      if (!persistFailureMessage) {
        console.error('[DB] persist:blocked', { error })
      }
    })
  }, 400)
}

const markDatabaseChanged = (db: RivoloDatabase) => {
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
      const sqlite = await ensureSql()
      beginDatabaseSnapshotLoad()
      const stored = await get(DB_KEY)
      const db = openSerializedDatabase(sqlite, stored ? new Uint8Array(stored) : null)
      const schema = ensureDatabaseSchema(db)
      ftsAvailable = schema.ftsAvailable
      if (schema.ftsRebuilt) scheduleSave(db)
      return db
    })().catch((error) => {
      dbPromise = null
      throw error
    })
  }

  return dbPromise
}

export const run = async (sql: string, params: (string | number | null)[] = []) => {
  assertDatabaseWritable()
  const db = await getDatabase()
  executeSql(db, sql, params)
  markDatabaseChanged(db)
}

export const runBulkDatabaseMutation = async <T>(callback: () => Promise<T>) => {
  assertDatabaseWritable()
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

export const runDatabaseTransaction = async <T>(callback: () => Promise<T>) => {
  assertDatabaseWritable()
  const db = await getDatabase()
  executeSql(db, 'BEGIN TRANSACTION')

  try {
    const result = await callback()
    executeSql(db, 'COMMIT')
    return result
  } catch (error) {
    try {
      executeSql(db, 'ROLLBACK')
    } catch (rollbackError) {
      console.error('[DB] transaction rollback failed', { rollbackError })
    }
    throw error
  }
}

export const queryAll = async <T = Record<string, string | number | null>>(
  sql: string,
  params: (string | number | null)[] = [],
): Promise<T[]> => {
  const db = await getDatabase()
  return queryRows<T>(db, sql, params)
}

export const queryOne = async <T = Record<string, string | number | null>>(
  sql: string,
  params: (string | number | null)[] = [],
): Promise<T | null> => {
  const db = await getDatabase()
  return queryFirstRow<T>(db, sql, params)
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
  assertDatabaseWritable()
  if (!(await isFtsAvailable())) {
    return
  }

  const db = await getDatabase()
  executeSql(db, 'DELETE FROM days_fts WHERE day_id = ?', [dayId])
  executeSql(db, 'INSERT INTO days_fts (day_id, human_title, content_md) VALUES (?, ?, ?)', [
    dayId,
    humanTitle,
    content,
  ])
  markDatabaseChanged(db)
}
