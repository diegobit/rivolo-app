import { IDBFactory } from 'fake-indexeddb'
import { vi } from 'vitest'

const testIndexedDB = new IDBFactory()
const testSessionValues = new Map<string, string>()
const testSessionStorage = {
  getItem: (key: string) => testSessionValues.get(key) ?? null,
  setItem: (key: string, value: string) => { testSessionValues.set(key, String(value)) },
  removeItem: (key: string) => { testSessionValues.delete(key) },
  clear: () => { testSessionValues.clear() },
}

const clearSnapshotStore = async () => {
  const request = indexedDB.open('keyval-store')
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('keyval')) request.result.createObjectStore('keyval')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('keyval', 'readwrite')
    transaction.objectStore('keyval').clear()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  }).finally(() => database.close())
}

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
  testSessionStorage.clear()
  vi.stubGlobal('window', {
    setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer),
    sessionStorage: testSessionStorage,
  })
  await clearSnapshotStore()
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
