import { IDBFactory } from 'fake-indexeddb'
import { vi } from 'vitest'
import { clear } from 'idb-keyval'

const testIndexedDB = new IDBFactory()

// Only the browser asset URL is adapted for Node. SQLite, serialization,
// repository SQL, idb-keyval and IndexedDB transactions remain real.
vi.mock('@sqlite.org/sqlite-wasm/sqlite3.wasm?url', () => ({
  default: new URL('../../../node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm', import.meta.url).pathname,
}))

export const loadStorage = async () => {
  const db = await import('../../lib/db')
  const repository = await import('../../lib/dayRepository')
  const importer = await import('../../lib/importExport')
  const settings = await import('../../lib/settingsRepository')
  const database = await db.getDatabase()
  return { db, repository, importer, settings, database }
}

export type Storage = Awaited<ReturnType<typeof loadStorage>>

export const createStorage = async () => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubGlobal('indexedDB', testIndexedDB)
  vi.stubGlobal('window', {
    setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer),
  })
  await clear()
  return loadStorage()
}

export const reopenStorage = async (storage: Storage) => {
  await storage.db.flushDatabaseSave()
  storage.database.close()
  vi.clearAllTimers()
  vi.resetModules()
  return loadStorage()
}

export const closeStorage = (storage: Storage) => {
  vi.clearAllTimers()
  storage.database.close()
  vi.useRealTimers()
  vi.unstubAllGlobals()
}
