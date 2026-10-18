// @vitest-environment node
import initSqlite from '@sqlite.org/sqlite-wasm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeStorage, createStorage, loadStorage, type Storage } from '../test/helpers/storage'
import { openSerializedDatabase, queryRows } from './sqliteRuntime'

let storage: Storage
beforeEach(async () => { storage = await createStorage(); await storage.db.flushDatabaseSave() })
afterEach(() => { closeStorage(storage) })

const readSnapshotBytes = async () => {
  const openRequest = indexedDB.open('keyval-store')
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    openRequest.onsuccess = () => resolve(openRequest.result)
    openRequest.onerror = () => reject(openRequest.error)
  })
  try {
    const stored = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction('keyval', 'readonly')
      const request = transaction.objectStore('keyval').get('single-note-db')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      transaction.onabort = () => reject(transaction.error)
    })
    if (stored instanceof ArrayBuffer) return new Uint8Array(stored)
    if (ArrayBuffer.isView(stored)) return new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength)
    return null
  } finally {
    database.close()
  }
}

const replaceSnapshotBytes = async (bytes: Uint8Array) => {
  const openRequest = indexedDB.open('keyval-store')
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    openRequest.onsuccess = () => resolve(openRequest.result)
    openRequest.onerror = () => reject(openRequest.error)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('keyval', 'readwrite')
      transaction.objectStore('keyval').put(bytes, 'single-note-db')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

const persistedNotes = async () => {
  const bytes = await readSnapshotBytes()
  if (!bytes) return []
  const db = openSerializedDatabase(await initSqlite(), bytes)
  try {
    return queryRows<{ day_id: string; content_md: string }>(db, 'SELECT day_id, content_md FROM days ORDER BY day_id DESC')
      .map((day) => [day.day_id, day.content_md])
  } finally { db.close() }
}

const persistedSnapshot = async () => {
  const bytes = await readSnapshotBytes()
  if (!bytes) throw new Error('No SQLite snapshot was stored in IndexedDB.')
  const db = openSerializedDatabase(await initSqlite(), bytes)
  try {
    const parseSetting = (value: string) => {
      try { return JSON.parse(value) as unknown } catch { return value }
    }
    return {
      days: queryRows<{ day_id: string; content_md: string }>(db, 'SELECT day_id, content_md FROM days ORDER BY day_id DESC'),
      settings: Object.fromEntries(queryRows<{ key: string; value: string }>(db, 'SELECT key, value FROM settings')
        .map(({ key, value }) => [key, parseSetting(value)])),
    }
  } finally { db.close() }
}

describe('database IndexedDB commit boundary', () => {
  it('debounces edits and commits the latest serialized notes after the save delay', async () => {
    await storage.repository.saveDay('2026-07-12', 'first', undefined, { markDirty: false })
    await vi.advanceTimersByTimeAsync(399)
    expect(await persistedNotes()).toEqual([])
    await storage.repository.saveDay('2026-07-12', 'latest', undefined, { markDirty: false })
    await vi.advanceTimersByTimeAsync(399)
    expect(await persistedNotes()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    // Reading the same IDB store waits behind the queued write transaction.
    expect(await persistedNotes()).toEqual([['2026-07-12', 'latest']])
  })

  it('flushes pending edits immediately without requiring the debounce timer', async () => {
    await storage.repository.saveDay('2026-07-12', 'flush now', undefined, { markDirty: false })
    expect(await persistedNotes()).toEqual([])
    await storage.db.flushDatabaseSave()
    expect(await persistedNotes()).toEqual([['2026-07-12', 'flush now']])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('synchronously checkpoints the newest registered editor draft before returning', async () => {
    await storage.repository.ensureDay('2026-07-14')
    const latest = 'Checkpoint café 🙂\nwith punctuation — intact'
    storage.db.registerPendingDayDraft('2026-07-14', latest, storage.repository.commitDayDraftInDatabase)

    expect(storage.db.checkpointDatabaseSynchronously()).toBe(true)
    await storage.db.flushDatabaseSave()

    expect(await persistedNotes()).toEqual([['2026-07-14', latest]])
    const saved = await storage.repository.getDay('2026-07-14')
    expect(saved?.contentMd).toBe(latest)
  })

  it('recovers the lifecycle draft journal when the interrupted snapshot is absent on reload', async () => {
    const dayId = '2026-07-14'
    const latest = 'Recovered café 🙂\nwith punctuation — intact'
    await storage.repository.saveDay(dayId, 'durable baseline', undefined, { markDirty: false })
    await storage.db.flushDatabaseSave()
    const baselineBytes = await readSnapshotBytes()
    expect(baselineBytes).not.toBeNull()

    storage.db.registerPendingDayDraft(dayId, latest, storage.repository.commitDayDraftInDatabase)
    expect(storage.db.checkpointDatabaseSynchronously()).toBe(true)
    const journal = window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')
    expect(JSON.parse(journal ?? '{}').drafts[0].contentMd).toBe(latest)
    await storage.db.flushDatabaseSave()
    expect(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')).toBeNull()

    // Recreate a browser that retained its synchronous session journal but lost
    // the asynchronous IndexedDB transaction started by pagehide.
    await replaceSnapshotBytes(baselineBytes!)
    window.sessionStorage.setItem('rivolo.pending-day-recovery.v1', journal!)
    storage.database.close()
    vi.clearAllTimers()
    vi.resetModules()
    storage = await loadStorage()

    expect((await storage.repository.getDay(dayId))?.contentMd).toBe(latest)
    expect(await persistedNotes()).toEqual([[dayId, latest]])
    expect(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')).toBeNull()
  })

  it('does not replay a session draft over a newer saved day from another tab', async () => {
    const dayId = '2026-07-14'
    await storage.repository.saveDay(dayId, 'newer saved from another tab', undefined, { markDirty: false })
    await storage.db.flushDatabaseSave()
    window.sessionStorage.setItem('rivolo.pending-day-recovery.v1', JSON.stringify({
      version: 1,
      drafts: [{
        dayId,
        contentMd: 'stale tab draft',
        baseContentMd: 'older saved value',
        baseUpdatedAt: 1,
        baseRowWasUnsaved: false,
        requiredAppliedGeneration: null,
      }],
    }))

    storage.database.close()
    vi.clearAllTimers()
    vi.resetModules()
    storage = await loadStorage()

    expect((await storage.repository.getDay(dayId))?.contentMd).toBe('newer saved from another tab')
    expect(await persistedNotes()).toEqual([[dayId, 'newer saved from another tab']])
    expect(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')).not.toBeNull()
    expect(storage.db.getDatabasePersistFailureSnapshot()).toContain('could not be saved')
  })

  it('prevents an older async editor save from replacing a newer lifecycle draft', async () => {
    await storage.repository.saveDay('2026-07-14', 'baseline', undefined, { markDirty: false })
    const oldGeneration = storage.db.registerPendingDayDraft(
      '2026-07-14',
      'older delayed text',
      storage.repository.commitDayDraftInDatabase,
    )
    storage.db.registerPendingDayDraft(
      '2026-07-14',
      'newest lifecycle text',
      storage.repository.commitDayDraftInDatabase,
    )

    expect(await storage.repository.saveDay('2026-07-14', 'older delayed text', undefined, {
      draftGeneration: oldGeneration,
    })).toBeNull()
    expect((await storage.repository.getDay('2026-07-14'))?.contentMd).toBe('baseline')

    expect(storage.db.checkpointDatabaseSynchronously()).toBe(true)
    await storage.db.flushDatabaseSave()
    expect(await persistedNotes()).toEqual([['2026-07-14', 'newest lifecycle text']])
  })

  it('settles concurrent durable waiters only after the latest submitted bytes commit', async () => {
    await storage.repository.saveDay('2026-07-14', 'waiter value', undefined, { markDirty: false })

    await Promise.all([storage.db.flushDatabaseSave(), storage.db.flushDatabaseSave()])

    expect(await persistedNotes()).toEqual([['2026-07-14', 'waiter value']])
  })

  it('keeps IndexedDB snapshot submission order when a newer SQL generation arrives in flight', async () => {
    await storage.repository.saveDay('2026-07-14', 'first submitted snapshot', undefined, { markDirty: false })
    const firstCommit = storage.db.flushDatabaseSave()

    await storage.repository.saveDay('2026-07-14', 'newer submitted snapshot', undefined, { markDirty: false })
    const newestCommit = storage.db.flushDatabaseSave()
    await Promise.all([firstCommit, newestCommit])

    expect(await persistedNotes()).toEqual([['2026-07-14', 'newer submitted snapshot']])
  })

  it('keeps Dropbox and Google Drive revisions and metadata dirty in the note transaction', async () => {
    await storage.settings.setJsonSetting('dropbox.state', {
      connected: true,
      filePath: '/notes.md',
      lastRemoteRev: 'remote-rev-7',
      lastPushedHash: 'pushed-hash',
      localDirty: false,
      localRevision: 7,
      accountEmail: 'reader@example.test',
    })
    await storage.settings.setJsonSetting('google-drive.state', {
      connected: true,
      fileId: 'file-42',
      fileName: 'notes.md',
      lastRemoteVersion: 'version-9',
      lastPushedHash: 'drive-hash',
      localDirty: false,
      localRevision: 9,
      accountEmail: 'reader@example.test',
    })

    await storage.repository.saveDay('2026-07-14', 'dirty provider note')
    await storage.db.flushDatabaseSave()

    expect(await persistedSnapshot()).toMatchObject({
      settings: {
        'dropbox.state': {
          connected: true,
          filePath: '/notes.md',
          lastRemoteRev: 'remote-rev-7',
          lastPushedHash: 'pushed-hash',
          localDirty: true,
          localRevision: 8,
          accountEmail: 'reader@example.test',
        },
        'google-drive.state': {
          connected: true,
          fileId: 'file-42',
          fileName: 'notes.md',
          lastRemoteVersion: 'version-9',
          lastPushedHash: 'drive-hash',
          localDirty: true,
          localRevision: 10,
          accountEmail: 'reader@example.test',
        },
      },
    })
  })

  it('retains a persistence failure and succeeds on a later durable retry', async () => {
    await storage.repository.saveDay('2026-07-14', 'retry after failure', undefined, { markDirty: false })
    const listener = vi.fn()
    const unsubscribe = storage.db.subscribeDatabasePersistFailure(listener)
    const open = indexedDB.open('keyval-store')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const objectStorePrototype = Object.getPrototypeOf(database.transaction('keyval', 'readwrite').objectStore('keyval')) as IDBObjectStore
    const originalPut = objectStorePrototype.put
    const putSpy = vi.spyOn(objectStorePrototype, 'put').mockImplementation(function (value: unknown, key?: IDBValidKey) {
      if (key === 'single-note-db') throw new Error('simulated quota failure')
      return originalPut.call(this, value, key)
    })

    await expect(storage.db.flushDatabaseSave()).rejects.toThrow('simulated quota failure')
    expect(storage.db.getDatabasePersistFailureSnapshot()).toContain('could not be saved')
    expect(listener).toHaveBeenCalledTimes(1)

    putSpy.mockRestore()
    database.close()
    await storage.db.flushDatabaseSave()
    expect(await persistedNotes()).toEqual([['2026-07-14', 'retry after failure']])
    expect(storage.db.getDatabasePersistFailureSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('reopens a warm IndexedDB handle after a version change closes it', async () => {
    const currentRequest = indexedDB.open('keyval-store')
    const currentDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      currentRequest.onsuccess = () => resolve(currentRequest.result)
      currentRequest.onerror = () => reject(currentRequest.error)
    })
    const nextVersion = currentDatabase.version + 1
    currentDatabase.close()
    const upgradeRequest = indexedDB.open('keyval-store', nextVersion)
    const upgradedDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      upgradeRequest.onsuccess = () => resolve(upgradeRequest.result)
      upgradeRequest.onerror = () => reject(upgradeRequest.error)
    })
    upgradedDatabase.close()

    await storage.settings.setSetting('settings.view', 'advanced')
    expect(await storage.settings.getSetting('settings.view')).toBe('advanced')
    expect((await persistedSnapshot()).settings['settings.view']).toBe('advanced')
  })

  it('persists a bulk mutation only after all writes complete', async () => {
    await storage.db.runBulkDatabaseMutation(async () => {
      await storage.repository.saveDay('2026-07-12', 'first', undefined, { markDirty: false })
      await vi.advanceTimersByTimeAsync(1000)
      expect(await persistedNotes()).toEqual([])
      await storage.repository.saveDay('2026-07-13', 'second', undefined, { markDirty: false })
    })
    expect(await persistedNotes()).toEqual([['2026-07-13', 'second'], ['2026-07-12', 'first']])
  })
})
