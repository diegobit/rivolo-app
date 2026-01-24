/// <reference lib="webworker" />
import { initSQLite, isOpfsSupported } from '@subframe7536/sqlite-wasm'
import { useOpfsStorage } from '@subframe7536/sqlite-wasm/opfs'
import sqliteWasmUrl from '@subframe7536/sqlite-wasm/wasm?url'

const DB_NAME = 'rivolo-db'

type SqlValue = string | number | bigint | null

type WorkerRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'run'; sql: string; params: SqlValue[] }
  | { id: number; type: 'queryAll'; sql: string; params: SqlValue[] }
  | { id: number; type: 'isFtsAvailable' }
  | { id: number; type: 'upsertFts'; dayId: string; humanTitle: string; content: string }

type WorkerResponse = { id: number; result?: unknown; error?: string }

type SqliteDb = Awaited<ReturnType<typeof initSQLite>>

const ctx = self as DedicatedWorkerGlobalScope

let dbPromise: Promise<SqliteDb> | null = null
let ftsAvailable: boolean | null = null
let queue: Promise<void> = Promise.resolve()

const enqueue = <T>(task: () => Promise<T>) => {
  const run = queue.then(task, task)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

const ensureSchema = async (db: SqliteDb) => {
  await db.sqlite.exec(
    db.db,
    `
      CREATE TABLE IF NOT EXISTS days (
        day_id TEXT PRIMARY KEY,
        human_title TEXT NOT NULL,
        content_md TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  )

  try {
    await db.sqlite.exec(
      db.db,
      `
        CREATE VIRTUAL TABLE IF NOT EXISTS days_fts
        USING fts5(day_id UNINDEXED, human_title, content_md);
      `,
    )
    ftsAvailable = true
  } catch (error) {
    ftsAvailable = false
    console.warn('FTS5 unavailable, falling back to LIKE search.', error)
  }

  await db.sqlite.exec(
    db.db,
    `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  )

  await db.sqlite.exec(
    db.db,
    `
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        meta_json TEXT
      );
    `,
  )
}

const openDatabase = async () => {
  if (!(await isOpfsSupported())) {
    throw new Error('OPFS is not supported in this browser.')
  }

  const db = await initSQLite(
    useOpfsStorage(DB_NAME, {
      url: sqliteWasmUrl,
    }),
  )

  await ensureSchema(db)
  return db
}

const getDatabase = async () => {
  if (!dbPromise) {
    dbPromise = openDatabase()
  }
  return dbPromise
}

const handleRequest = async (request: WorkerRequest): Promise<WorkerResponse> => {
  try {
    const db = await getDatabase()

    switch (request.type) {
      case 'init':
        return { id: request.id, result: true }
      case 'run':
        await db.run(request.sql, request.params)
        return { id: request.id, result: true }
      case 'queryAll': {
        const rows = await db.run(request.sql, request.params)
        return { id: request.id, result: rows }
      }
      case 'isFtsAvailable':
        return { id: request.id, result: Boolean(ftsAvailable) }
      case 'upsertFts':
        if (!ftsAvailable) {
          return { id: request.id, result: false }
        }
        await db.run('DELETE FROM days_fts WHERE day_id = ?', [request.dayId])
        await db.run('INSERT INTO days_fts (day_id, human_title, content_md) VALUES (?, ?, ?)', [
          request.dayId,
          request.humanTitle,
          request.content,
        ])
        return { id: request.id, result: true }
      default: {
        const fallback = request as WorkerRequest
        return { id: fallback.id, error: 'Unknown SQLite request.' }
      }
    }
  } catch (error) {
    return {
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  void enqueue(async () => {
    const response = await handleRequest(event.data)
    ctx.postMessage(response)
  })
})
