// @vitest-environment node
import initSqlite from '@sqlite.org/sqlite-wasm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeStorage, createStorage, loadStorage, reopenStorage, type Storage } from '../test/helpers/storage'
import { executeSql, exportSerializedDatabase, openSerializedDatabase, queryRows } from './sqliteRuntime'

let storage: Storage
let databaseEvents: EventTarget | null = null
let databaseStorageValues = new Map<string, string>()
beforeEach(async () => {
  databaseEvents = null
  databaseStorageValues = new Map()
  storage = await createStorage()
  await storage.db.flushDatabaseSave()
})
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

const createForeignSnapshot = async (
  bytes: Uint8Array,
  mutate: (db: ReturnType<typeof openSerializedDatabase>) => void,
) => {
  const sqlite = await initSqlite()
  const database = openSerializedDatabase(sqlite, bytes)
  try {
    mutate(database)
    return exportSerializedDatabase(sqlite, database)
  } finally {
    database.close()
  }
}

const announceForeignRevision = async (revision: number) => {
  databaseEvents ??= new EventTarget()
  const events = databaseEvents
  Object.assign(window, {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    localStorage: {
      getItem: (key: string) => databaseStorageValues.get(key) ?? null,
      setItem: (key: string, value: string) => databaseStorageValues.set(key, value),
      removeItem: (key: string) => databaseStorageValues.delete(key),
    },
  })
  vi.stubGlobal('document', {})
  vi.stubGlobal('BroadcastChannel', undefined)
  const tabSync = await import('./tabSyncCoordinator')
  tabSync.beginDatabaseSnapshotLoad()

  const announcement = new Event('storage')
  Object.assign(announcement, {
    key: 'rivolo.db.persisted-revision',
    newValue: JSON.stringify({ sourceTabId: 'other-tab', revision }),
  })
  events.dispatchEvent(announcement)
  return tabSync
}

const reloadStorageWithoutFlushing = async () => {
  storage.database.close()
  vi.clearAllTimers()
  if (databaseEvents) {
    const events = databaseEvents
    Object.assign(window, {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
      localStorage: {
        getItem: (key: string) => databaseStorageValues.get(key) ?? null,
        setItem: (key: string, value: string) => databaseStorageValues.set(key, value),
        removeItem: (key: string) => databaseStorageValues.delete(key),
      },
    })
    vi.stubGlobal('document', {})
    vi.stubGlobal('BroadcastChannel', undefined)
  }
  vi.resetModules()
  storage = await loadStorage()
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

const persistedDayRows = async () => {
  const bytes = await readSnapshotBytes()
  if (!bytes) return []
  const db = openSerializedDatabase(await initSqlite(), bytes)
  try {
    return queryRows<{ day_id: string; content_md: string; updated_at: number }>(
      db,
      'SELECT day_id, content_md, updated_at FROM days ORDER BY day_id DESC',
    )
  } finally {
    db.close()
  }
}

const abortNextSnapshotPut = async () => {
  const openRequest = indexedDB.open('keyval-store')
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    openRequest.onsuccess = () => resolve(openRequest.result)
    openRequest.onerror = () => reject(openRequest.error)
  })
  const prototype = Object.getPrototypeOf(
    database.transaction('keyval', 'readonly').objectStore('keyval'),
  ) as IDBObjectStore
  database.close()

  const originalPut = prototype.put
  let aborted = false
  let resolveAbort!: () => void
  const transactionAborted = new Promise<void>((resolve) => { resolveAbort = resolve })
  prototype.put = function (
    this: IDBObjectStore,
    value: Parameters<IDBObjectStore['put']>[0],
    key?: IDBValidKey,
  ) {
    const request = originalPut.call(this, value, key)
    if (!aborted && key === 'single-note-db') {
      aborted = true
      this.transaction.addEventListener('abort', resolveAbort, { once: true })
      this.transaction.abort()
    }
    return request
  }

  return {
    transactionAborted,
    restore: () => { prototype.put = originalPut },
    wasTriggered: () => aborted,
  }
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

  it('recovers a later draft from the exact row of its own committed predecessor', async () => {
    const dayId = '2026-07-14'
    await storage.repository.saveDay(dayId, 'durable baseline', undefined, { markDirty: false })
    await storage.db.flushDatabaseSave()

    storage.db.registerPendingDayDraft(dayId, 'first edit café', storage.repository.commitDayDraftInDatabase)
    expect(storage.db.checkpointDatabaseSynchronously()).toBe(true)
    // Register the second generation before the first native transaction can
    // report completion, matching an editor change during snapshot flight.
    storage.db.registerPendingDayDraft(dayId, 'second edit café 🙂', storage.repository.commitDayDraftInDatabase)
    await storage.db.persistDatabase(storage.database)

    const firstStoredRow = (await persistedDayRows())[0]
    expect(firstStoredRow).toMatchObject({ day_id: dayId, content_md: 'first edit café' })

    const fault = await abortNextSnapshotPut()
    try {
      expect(storage.db.checkpointDatabaseSynchronously()).toBe(true)
      await fault.transactionAborted
    } finally {
      fault.restore()
    }
    expect(fault.wasTriggered()).toBe(true)
    expect(await persistedDayRows()).toEqual([firstStoredRow])
    const journal = JSON.parse(
      window.sessionStorage.getItem('rivolo.pending-day-recovery.v1') ?? '{}',
    )
    expect(journal.drafts).toContainEqual(
      expect.objectContaining({
        dayId,
        contentMd: 'second edit café 🙂',
        baseContentMd: 'first edit café',
        baseUpdatedAt: firstStoredRow.updated_at,
      }),
    )

    await reloadStorageWithoutFlushing()
    expect((await storage.repository.getDay(dayId))?.contentMd).toBe('second edit café 🙂')
    expect(await persistedNotes()).toEqual([[dayId, 'second edit café 🙂']])
    expect(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')).toBeNull()
  })

  it('keeps a failed predecessor out of recovery baselines and advances after a later durable draft', async () => {
    const dayId = '2026-07-14'
    await storage.repository.saveDay(dayId, 'durable baseline', undefined, { markDirty: false })
    await storage.db.flushDatabaseSave()

    storage.db.registerPendingDayDraft(dayId, 'failed predecessor', storage.repository.commitDayDraftInDatabase)
    const firstFault = await abortNextSnapshotPut()
    try {
      expect(storage.db.checkpointDatabaseSynchronously()).toBe(true)
      await firstFault.transactionAborted
    } finally {
      firstFault.restore()
    }
    expect(firstFault.wasTriggered()).toBe(true)
    expect(await persistedNotes()).toEqual([[dayId, 'durable baseline']])

    storage.db.registerPendingDayDraft(dayId, 'later edit café', storage.repository.commitDayDraftInDatabase)
    expect(storage.db.checkpointDatabaseSynchronously()).toBe(true)
    // A still newer editor value arrives before this successful snapshot's
    // completion callback; its baseline must advance to the exact stored row.
    storage.db.registerPendingDayDraft(dayId, 'latest edit café 🙂', storage.repository.commitDayDraftInDatabase)
    await storage.db.persistDatabase(storage.database)

    const laterStoredRow = (await persistedDayRows())[0]
    expect(laterStoredRow).toMatchObject({ day_id: dayId, content_md: 'later edit café' })
    const secondFault = await abortNextSnapshotPut()
    try {
      expect(storage.db.checkpointDatabaseSynchronously()).toBe(true)
      await secondFault.transactionAborted
    } finally {
      secondFault.restore()
    }
    expect(secondFault.wasTriggered()).toBe(true)
    expect(await persistedDayRows()).toEqual([laterStoredRow])

    const journal = JSON.parse(
      window.sessionStorage.getItem('rivolo.pending-day-recovery.v1') ?? '{}',
    )
    expect(journal.drafts).toContainEqual(
      expect.objectContaining({
        dayId,
        contentMd: 'latest edit café 🙂',
        baseContentMd: 'later edit café',
        baseUpdatedAt: laterStoredRow.updated_at,
      }),
    )

    await reloadStorageWithoutFlushing()
    expect((await storage.repository.getDay(dayId))?.contentMd).toBe('latest edit café 🙂')
    expect(await persistedNotes()).toEqual([[dayId, 'latest edit café 🙂']])
    expect(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')).toBeNull()
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

  it('journals stale-tab drafts before rejecting writes and keeps foreign state or conflicts intact', async () => {
    const dayId = '2026-07-14'
    const latest = 'Latest stale-tab edit café 🙂'
    await storage.repository.saveDay(dayId, 'saved baseline', undefined, { markDirty: false })
    await storage.db.flushDatabaseSave()
    const baselineBytes = await readSnapshotBytes()
    expect(baselineBytes).not.toBeNull()

    const foreignBytes = await createForeignSnapshot(baselineBytes!, (database) => {
      executeSql(database, 'INSERT INTO settings (key, value) VALUES (?, ?)', [
        'appearance.theme',
        JSON.stringify('dark'),
      ])
    })
    await replaceSnapshotBytes(foreignBytes)

    storage.db.registerPendingDayDraft(dayId, latest, storage.repository.commitDayDraftInDatabase)
    const firstTabSync = await announceForeignRevision(10)
    expect(firstTabSync.getTabSyncSnapshot().databaseStale).toBe(true)
    expect(storage.db.checkpointDatabaseSynchronously()).toBe(false)
    await expect(storage.db.flushDatabaseSave()).rejects.toThrow('older local data')

    const firstJournal = JSON.parse(
      window.sessionStorage.getItem('rivolo.pending-day-recovery.v1') ?? '{}',
    )
    expect(firstJournal.drafts).toContainEqual(
      expect.objectContaining({
        dayId,
        contentMd: latest,
        baseContentMd: 'saved baseline',
        requiredAppliedGeneration: null,
      }),
    )
    expect(await persistedSnapshot()).toMatchObject({
      days: [{ day_id: dayId, content_md: 'saved baseline' }],
      settings: { 'appearance.theme': 'dark' },
    })

    await reloadStorageWithoutFlushing()
    expect((await storage.repository.getDay(dayId))?.contentMd).toBe(latest)
    expect(await persistedSnapshot()).toMatchObject({
      days: [{ day_id: dayId, content_md: latest }],
      settings: { 'appearance.theme': 'dark' },
    })
    expect(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')).toBeNull()

    const conflictDraft = 'Conflicting stale-tab text stays available café 🙂'
    const currentRow = queryRows<{ content_md: string; updated_at: number }>(
      storage.database,
      'SELECT content_md, updated_at FROM days WHERE day_id = ? LIMIT 1',
      [dayId],
    )[0]
    const currentBytes = await readSnapshotBytes()
    expect(currentBytes).not.toBeNull()
    const foreignConflictBytes = await createForeignSnapshot(currentBytes!, (database) => {
      executeSql(database, 'UPDATE days SET content_md = ?, updated_at = ? WHERE day_id = ?', [
        'foreign note change',
        Math.max(Date.now(), currentRow.updated_at + 1),
        dayId,
      ])
      executeSql(database, 'DELETE FROM days_fts WHERE day_id = ?', [dayId])
      executeSql(
        database,
        'INSERT INTO days_fts (day_id, human_title, content_md) SELECT day_id, human_title, content_md FROM days WHERE day_id = ?',
        [dayId],
      )
    })
    await replaceSnapshotBytes(foreignConflictBytes)

    storage.db.registerPendingDayDraft(
      dayId,
      conflictDraft,
      storage.repository.commitDayDraftInDatabase,
    )
    const secondTabSync = await announceForeignRevision(11)
    expect(secondTabSync.getTabSyncSnapshot().databaseStale).toBe(true)
    expect(storage.db.checkpointDatabaseSynchronously()).toBe(false)
    await expect(storage.db.flushDatabaseSave()).rejects.toThrow('older local data')
    expect(await persistedSnapshot()).toMatchObject({
      days: [{ day_id: dayId, content_md: 'foreign note change' }],
      settings: { 'appearance.theme': 'dark' },
    })

    await reloadStorageWithoutFlushing()
    expect((await storage.repository.getDay(dayId))?.contentMd).toBe('foreign note change')
    const conflictJournal = JSON.parse(
      window.sessionStorage.getItem('rivolo.pending-day-recovery.v1') ?? '{}',
    )
    expect(conflictJournal.drafts).toContainEqual(
      expect.objectContaining({
        dayId,
        contentMd: conflictDraft,
        baseContentMd: latest,
        requiredAppliedGeneration: null,
        recoveryConflict: true,
      }),
    )
    expect(storage.db.getDatabasePersistFailureSnapshot()).toContain('could not be saved')
    expect(await persistedSnapshot()).toMatchObject({
      days: [{ day_id: dayId, content_md: 'foreign note change' }],
      settings: { 'appearance.theme': 'dark' },
    })
  })

  it('retains a conflicting recovery draft across unrelated commits until a same-day edit resolves it', async () => {
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

    const unrelatedDayId = '2026-07-15'
    await storage.repository.ensureDay(unrelatedDayId)
    storage.db.registerPendingDayDraft(
      unrelatedDayId,
      'unrelated saved draft',
      storage.repository.commitDayDraftInDatabase,
    )
    expect(storage.db.checkpointDatabaseSynchronously()).toBe(true)
    await storage.db.flushDatabaseSave()

    const savedJournal = JSON.parse(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1') ?? '{}')
    const retained = savedJournal.drafts?.find((draft: { dayId?: string }) => draft.dayId === dayId)
    expect(retained).toMatchObject({
      contentMd: 'stale tab draft',
      recoveryConflict: true,
      requiredAppliedGeneration: null,
    })
    expect(storage.db.getDatabasePersistFailureSnapshot()).toContain('could not be saved')
    expect(await persistedNotes()).toEqual([
      [unrelatedDayId, 'unrelated saved draft'],
      [dayId, 'newer saved from another tab'],
    ])

    storage = await reopenStorage(storage)
    expect((await storage.repository.getDay(dayId))?.contentMd).toBe('newer saved from another tab')
    expect((await storage.repository.getDay(unrelatedDayId))?.contentMd).toBe('unrelated saved draft')
    expect(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')).toContain('stale tab draft')
    expect(storage.db.getDatabasePersistFailureSnapshot()).toContain('could not be saved')

    const resolutionGeneration = storage.db.registerPendingDayDraft(
      dayId,
      'same-day edit resolved the recovery conflict',
      storage.repository.commitDayDraftInDatabase,
    )
    await storage.repository.saveDay(dayId, 'same-day edit resolved the recovery conflict', undefined, {
      draftGeneration: resolutionGeneration,
    })
    expect(await persistedNotes()).toEqual(expect.arrayContaining([
      [dayId, 'same-day edit resolved the recovery conflict'],
    ]))
    expect(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')).toBeNull()
    expect(storage.db.getDatabasePersistFailureSnapshot()).toBeNull()
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

  it('journals pending drafts while a version change leaves the warm IndexedDB handle unavailable', async () => {
    const dayId = '2026-07-14'
    const latest = 'Saved after the IndexedDB handle reopens'
    await storage.repository.ensureDay(dayId)
    storage.db.registerPendingDayDraft(dayId, latest, storage.repository.commitDayDraftInDatabase)

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

    expect(storage.db.checkpointDatabaseSynchronously()).toBe(false)
    expect(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')).toContain(latest)
    await storage.db.flushDatabaseSave()
    expect(await persistedNotes()).toEqual([[dayId, latest]])
    expect(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')).toBeNull()

    await storage.settings.setSetting('settings.view', 'advanced')
    expect(await storage.settings.getSetting('settings.view')).toBe('advanced')
    expect((await persistedSnapshot()).settings['settings.view']).toBe('advanced')
  })

  it('defers prior timers and explicit snapshot waiters until the bulk mutation completes', async () => {
    await storage.repository.saveDay('2026-07-11', 'prior dirty generation', undefined, { markDirty: false })
    await storage.repository.ensureDay('2026-07-14')
    let persistWaiter: Promise<void> | undefined
    let flushWaiter: Promise<void> | undefined
    await storage.db.runBulkDatabaseMutation(async () => {
      await storage.repository.saveDay('2026-07-12', 'first', undefined, { markDirty: false })
      const lifecycleDraft = 'Lifecycle draft saved after the bulk mutation'
      storage.db.registerPendingDayDraft(
        '2026-07-14',
        lifecycleDraft,
        storage.repository.commitDayDraftInDatabase,
      )
      expect(storage.db.checkpointDatabaseSynchronously()).toBe(false)
      expect(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')).toContain(lifecycleDraft)
      persistWaiter = storage.db.persistDatabase(storage.database)
      flushWaiter = storage.db.flushDatabaseSave()
      await vi.advanceTimersByTimeAsync(400)
      expect(await persistedNotes()).toEqual([])
      await storage.repository.saveDay('2026-07-13', 'second', undefined, { markDirty: false })
    })
    await Promise.all([persistWaiter, flushWaiter])
    expect(await persistedNotes()).toEqual([
      ['2026-07-14', 'Lifecycle draft saved after the bulk mutation'],
      ['2026-07-13', 'second'],
      ['2026-07-12', 'first'],
      ['2026-07-11', 'prior dirty generation'],
    ])
    expect(window.sessionStorage.getItem('rivolo.pending-day-recovery.v1')).toBeNull()
  })

  it('rejects a deferred flush after a foreign persisted revision invalidates its snapshot', async () => {
    const dayId = '2026-07-14'
    await storage.repository.saveDay(dayId, 'prior saved baseline', undefined, { markDirty: false })
    await storage.db.flushDatabaseSave()

    const events = new EventTarget()
    const values = new Map<string, string>()
    Object.assign(window, {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    })
    vi.stubGlobal('document', {})
    vi.stubGlobal('BroadcastChannel', undefined)
    const tabSync = await import('./tabSyncCoordinator')
    tabSync.beginDatabaseSnapshotLoad()

    let resume!: () => void
    let started!: () => void
    const pause = new Promise<void>((resolve) => { resume = resolve })
    const ready = new Promise<void>((resolve) => { started = resolve })
    const bulk = storage.db.runBulkDatabaseMutation(async () => {
      await storage.repository.saveDay(dayId, 'stale local queued content', undefined, { markDirty: false })
      started()
      await pause
    })
    const bulkOutcome = bulk.then(() => 'fulfilled', (error) => String(error))
    await ready

    const deferredFlush = storage.db.flushDatabaseSave()
    const announcement = new Event('storage')
    Object.assign(announcement, {
      key: 'rivolo.db.persisted-revision',
      newValue: JSON.stringify({ sourceTabId: 'other-tab', revision: 10 }),
    })
    events.dispatchEvent(announcement)
    expect(tabSync.getTabSyncSnapshot().databaseStale).toBe(true)

    resume()
    const deferredFlushOutcome = deferredFlush.then(() => 'fulfilled', (error) => String(error))
    expect(await bulkOutcome).toContain('older local data')
    expect(await deferredFlushOutcome).toContain('older local data')
    expect(await persistedNotes()).toEqual([[dayId, 'prior saved baseline']])
  })

  it('preserves a prior dirty generation when a bulk operation fails after its timer fires', async () => {
    await storage.repository.saveDay('2026-07-11', 'prior dirty generation', undefined, { markDirty: false })

    await expect(storage.db.runBulkDatabaseMutation(async () => {
      await vi.advanceTimersByTimeAsync(400)
      expect(await persistedNotes()).toEqual([])
      throw new Error('simulated bulk failure')
    })).rejects.toThrow('simulated bulk failure')

    await storage.db.flushDatabaseSave()
    expect(await persistedNotes()).toEqual([['2026-07-11', 'prior dirty generation']])
  })

  it('defers timer snapshots until an awaited SQL transaction commits', async () => {
    await storage.repository.saveDay('2026-07-11', 'prior dirty generation', undefined, { markDirty: false })

    await storage.db.runDatabaseTransaction(async () => {
      await storage.db.run(
        'INSERT INTO days (day_id, human_title, content_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['2026-07-12', '2026-07-12', 'first transaction write', 1, 1],
      )
      await vi.advanceTimersByTimeAsync(400)
      expect(await persistedNotes()).toEqual([])
      await storage.db.run(
        'INSERT INTO days (day_id, human_title, content_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['2026-07-13', '2026-07-13', 'last transaction write', 1, 1],
      )
    })

    await storage.db.flushDatabaseSave()
    expect(await persistedNotes()).toEqual([
      ['2026-07-13', 'last transaction write'],
      ['2026-07-12', 'first transaction write'],
      ['2026-07-11', 'prior dirty generation'],
    ])
  })
})
