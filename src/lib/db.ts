import initSqlite from '@sqlite.org/sqlite-wasm'
import sqliteWasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url'
import {
  DATABASE_STALE_RELOAD_MESSAGE,
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
const IDB_DATABASE = 'keyval-store'
const IDB_OBJECT_STORE = 'keyval'
// Safari may stop an IndexedDB transaction with the page. Keep only unsaved
// note drafts in this tab's synchronous session storage until the snapshot is
// confirmed durable; provider credentials and sync metadata are never copied.
const DRAFT_RECOVERY_JOURNAL_KEY = 'rivolo.pending-day-recovery.v1'
const PERSIST_FAILURE_MESSAGE = 'Your notes could not be saved on this device. Check available storage and try again.'

export type PendingDayDraft = {
  dayId: string
  contentMd: string
  generation: number
  baseContentMd: string | null
  baseUpdatedAt: number | null
  baseRowWasUnsaved: boolean
}

type PendingDayDraftCommitter = (db: RivoloDatabase, draft: PendingDayDraft) => void
export type RecoverableDayDraft = Omit<PendingDayDraft, 'generation'>
type TrackedDayDraft = PendingDayDraft & {
  commit: PendingDayDraftCommitter
  baseDraftGeneration: number | null
  appliedUpdatedAt: number | null
}
type SnapshotDayDraft = {
  generation: number
  contentMd: string
  updatedAt: number
}
export type DayDraftRecoveryResult = {
  changed: boolean
  appliedDayIds: string[]
  completedDayIds: string[]
  conflictDayIds: string[]
}
export type DayDraftRecoveryHandler = (db: RivoloDatabase, drafts: RecoverableDayDraft[]) => DayDraftRecoveryResult
type SessionDraftEntry = RecoverableDayDraft & {
  requiredAppliedGeneration: number | null
  recoveryConflict?: boolean
}
type SessionDraftJournal = {
  version: 1
  drafts: SessionDraftEntry[]
}

type PendingSnapshot = {
  generation: number
  dayDrafts: Map<string, SnapshotDayDraft>
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
  settled: boolean
}

type DatabaseMutationBarrier = {
  promise: Promise<void>
  resolve: () => void
}

let sqlPromise: Promise<RivoloSqlite> | null = null
let dbPromise: Promise<RivoloDatabase> | null = null
let idbPromise: Promise<IDBDatabase> | null = null
let sqliteHandle: RivoloSqlite | null = null
let dbHandle: RivoloDatabase | null = null
let idbHandle: IDBDatabase | null = null
let saveTimer: number | null = null
let bulkMutationDepth = 0
let bulkMutationDirty = false
let databaseTransactionDepth = 0
let databaseTransactionDirty = false
let databaseMutationBarrier: DatabaseMutationBarrier | null = null
let snapshotRequestedDuringMutation = false
let ftsAvailable: boolean | null = null

let appliedGeneration = 0
let durableGeneration = 0
const pendingSnapshots = new Set<PendingSnapshot>()
const pendingDayDrafts = new Map<string, TrackedDayDraft>()
const unpersistedDayDrafts = new Map<string, TrackedDayDraft & { requiredAppliedGeneration: number }>()
const latestDayDraftGeneration = new Map<string, number>()
const committedDayDraftGeneration = new Map<string, number>()
const unsavedDayCreationGeneration = new Map<string, number>()
let dayDraftRecoveryHandler: DayDraftRecoveryHandler | null = null

let persistFailureMessage: string | null = null
const persistFailureListeners = new Set<() => void>()

const beginDatabaseMutationBarrier = () => {
  if (databaseMutationBarrier) return
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  databaseMutationBarrier = { promise, resolve }
}

const isDatabaseMutationActive = () =>
  databaseMutationBarrier !== null || bulkMutationDepth > 0 || databaseTransactionDepth > 0

const waitForDatabaseMutation = async () => {
  while (databaseMutationBarrier) await databaseMutationBarrier.promise
}

const releaseDatabaseMutationBarrier = () => {
  if (bulkMutationDepth > 0 || databaseTransactionDepth > 0) return
  const barrier = databaseMutationBarrier
  databaseMutationBarrier = null
  barrier?.resolve()
  if (!snapshotRequestedDuringMutation) return

  snapshotRequestedDuringMutation = false
  queueMicrotask(() => {
    void flushDatabaseSave().catch((error) => {
      if (error instanceof Error && error.message === DATABASE_STALE_RELOAD_MESSAGE) return
      if (!persistFailureMessage) console.error('[DB] persist:blocked', { error })
    })
  })
}

const setPersistFailureMessage = (message: string | null) => {
  if (persistFailureMessage === message) return
  persistFailureMessage = message
  persistFailureListeners.forEach((listener) => listener())
}

const reportPersistFailure = (error: unknown) => {
  if (!persistFailureMessage) console.error('[DB] persist:failed', { error })
  setPersistFailureMessage(PERSIST_FAILURE_MESSAGE)
}

const isRecoverableDraft = (value: unknown): value is RecoverableDayDraft => {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<RecoverableDayDraft>
  return (
    typeof draft.dayId === 'string' &&
    typeof draft.contentMd === 'string' &&
    (draft.baseContentMd === null || typeof draft.baseContentMd === 'string') &&
    (draft.baseUpdatedAt === null || (typeof draft.baseUpdatedAt === 'number' && Number.isFinite(draft.baseUpdatedAt))) &&
    typeof draft.baseRowWasUnsaved === 'boolean'
  )
}

const getSessionStorage = () => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

const readSessionDraftJournal = (): SessionDraftJournal | null => {
  try {
    const session = getSessionStorage()
    if (!session) return null
    const serialized = session.getItem(DRAFT_RECOVERY_JOURNAL_KEY)
    if (!serialized) return null
    const parsed: unknown = JSON.parse(serialized)
    if (!parsed || typeof parsed !== 'object') return null
    const journal = parsed as Partial<SessionDraftJournal>
    if (journal.version !== 1 || !Array.isArray(journal.drafts)) return null
    const drafts = journal.drafts.filter((entry): entry is SessionDraftEntry => {
      if (!isRecoverableDraft(entry)) return false
      const journalEntry = entry as Partial<SessionDraftEntry>
      const required = journalEntry.requiredAppliedGeneration
      return (
        (required === null || (typeof required === 'number' && Number.isFinite(required))) &&
        (journalEntry.recoveryConflict === undefined || typeof journalEntry.recoveryConflict === 'boolean')
      )
    })
    return { version: 1, drafts }
  } catch (error) {
    reportPersistFailure(error)
    return null
  }
}

const writeSessionDraftJournal = (drafts: SessionDraftEntry[]) => {
  try {
    const session = getSessionStorage()
    if (!session) return false
    if (!drafts.length) {
      session.removeItem(DRAFT_RECOVERY_JOURNAL_KEY)
      return true
    }
    session.setItem(
      DRAFT_RECOVERY_JOURNAL_KEY,
      JSON.stringify({ version: 1, drafts } satisfies SessionDraftJournal),
    )
    return true
  } catch (error) {
    reportPersistFailure(error)
    return false
  }
}

const clearSessionDraftJournalThrough = (generation: number) => {
  const journal = readSessionDraftJournal()
  if (!journal) return
  const remaining = journal.drafts.filter(
    (draft) => draft.requiredAppliedGeneration === null || draft.requiredAppliedGeneration > generation,
  )
  if (remaining.length !== journal.drafts.length) writeSessionDraftJournal(remaining)
}

const removeSessionDraftJournalEntry = (dayId: string) => {
  const journal = readSessionDraftJournal()
  if (!journal) return
  const remaining = journal.drafts.filter((draft) => draft.dayId !== dayId)
  if (remaining.length !== journal.drafts.length) writeSessionDraftJournal(remaining)
}

const toRecoverableDraft = ({
  dayId,
  contentMd,
  baseContentMd,
  baseUpdatedAt,
  baseRowWasUnsaved,
}: PendingDayDraft): RecoverableDayDraft => ({
  dayId,
  contentMd,
  baseContentMd,
  baseUpdatedAt,
  baseRowWasUnsaved,
})

const markJournalDraftApplied = (draft: PendingDayDraft, requiredAppliedGeneration: number) => {
  const journal = readSessionDraftJournal()
  if (!journal) return
  let found = false
  const drafts = journal.drafts.filter((entry) => {
    if (entry.dayId !== draft.dayId) return true
    found = true
    return false
  })
  if (found) {
    drafts.push({
      ...toRecoverableDraft(draft),
      requiredAppliedGeneration,
      recoveryConflict: false,
    })
  }
  if (found) writeSessionDraftJournal(drafts)
}

const draftsForSessionJournal = () => {
  const drafts = new Map<string, SessionDraftEntry>()
  for (const [dayId, draft] of unpersistedDayDrafts) {
    drafts.set(dayId, {
      ...toRecoverableDraft(draft),
      requiredAppliedGeneration: draft.requiredAppliedGeneration,
    })
  }
  for (const [dayId, draft] of pendingDayDrafts) {
    drafts.set(dayId, { ...toRecoverableDraft(draft), requiredAppliedGeneration: null })
  }
  return [...drafts.values()]
}

const mergeSessionDraftJournal = (drafts: SessionDraftEntry[]) => {
  const journal = readSessionDraftJournal()
  if (!journal?.drafts.length) return drafts

  const currentDayIds = new Set(drafts.map((draft) => draft.dayId))
  // An edit on the same day intentionally supersedes its older recovery text;
  // unrelated drafts leave that conflict intact until a same-day edit or deletion.
  const retained = journal.drafts.filter((draft) => !currentDayIds.has(draft.dayId))
  return [...retained, ...drafts]
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
    sqlPromise = initialize({ locateFile: () => sqliteWasmUrl })
      .then((sqlite) => {
        sqliteHandle = sqlite
        return sqlite
      })
      .catch((error) => {
        sqlPromise = null
        sqliteHandle = null
        throw error
      })
  }

  return sqlPromise
}

const clearIdbHandle = (database: IDBDatabase) => {
  if (idbHandle !== database) return
  idbHandle = null
  idbPromise = null
}

const ensureIdb = () => {
  if (idbHandle) return Promise.resolve(idbHandle)
  if (idbPromise) return idbPromise

  idbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(IDB_DATABASE)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_OBJECT_STORE)) {
        request.result.createObjectStore(IDB_OBJECT_STORE)
      }
    }
    request.onerror = () => {
      idbPromise = null
      reject(request.error ?? new Error('Could not open local storage.'))
    }
    request.onblocked = () => {
      idbPromise = null
      reject(new Error('Local storage is busy in another tab.'))
    }
    request.onsuccess = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(IDB_OBJECT_STORE)) {
        database.close()
        idbPromise = null
        reject(new Error('The local database is missing its key/value store.'))
        return
      }
      database.addEventListener('close', () => clearIdbHandle(database))
      database.onversionchange = () => {
        clearIdbHandle(database)
        database.close()
      }
      idbHandle = database
      resolve(database)
    }
  })

  return idbPromise
}

const readStoredSnapshot = (database: IDBDatabase) =>
  new Promise<ArrayBuffer | Uint8Array | null>((resolve, reject) => {
    let value: unknown
    let settled = false
    const transaction = database.transaction(IDB_OBJECT_STORE, 'readonly')
    const request = transaction.objectStore(IDB_OBJECT_STORE).get(DB_KEY)
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    }
    request.onsuccess = () => {
      value = request.result
    }
    request.onerror = () => fail(request.error ?? new Error('Could not read the local database.'))
    transaction.oncomplete = () => {
      if (settled) return
      settled = true
      if (value == null) {
        resolve(null)
      } else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        resolve(value as ArrayBuffer | Uint8Array)
      } else {
        reject(new Error('The saved local database is not binary data.'))
      }
    }
    transaction.onerror = () => fail(transaction.error ?? new Error('Could not read the local database.'))
    transaction.onabort = () => fail(transaction.error ?? new Error('The local database read was aborted.'))
  })

const findInFlightSnapshot = (generation: number) =>
  [...pendingSnapshots]
    .filter((snapshot) => !snapshot.settled && snapshot.generation >= generation)
    .sort((left, right) => left.generation - right.generation)[0]

const readDraftSnapshotRow = (db: RivoloDatabase, dayId: string, contentMd: string) => {
  const row = queryFirstRow<{ content_md: string; updated_at: number }>(
    db,
    'SELECT content_md, updated_at FROM days WHERE day_id = ? LIMIT 1',
    [dayId],
  )
  return row?.content_md === contentMd ? row : null
}

const captureSnapshotDayDrafts = (db: RivoloDatabase, generation: number) => {
  const dayDrafts = new Map<string, SnapshotDayDraft>()
  for (const [dayId, draft] of unpersistedDayDrafts) {
    if (
      draft.requiredAppliedGeneration > generation ||
      draft.appliedUpdatedAt === null
    ) {
      continue
    }
    const row = readDraftSnapshotRow(db, dayId, draft.contentMd)
    if (!row || row.updated_at !== draft.appliedUpdatedAt) continue
    dayDrafts.set(dayId, {
      generation: draft.generation,
      contentMd: row.content_md,
      updatedAt: row.updated_at,
    })
  }
  return dayDrafts
}

const advanceDraftRecoveryBaselines = (snapshot: PendingSnapshot) => {
  let changed = false
  const drafts = [...unpersistedDayDrafts.values(), ...pendingDayDrafts.values()]
  for (const draft of drafts) {
    const predecessorGeneration = draft.baseDraftGeneration
    if (predecessorGeneration === null) continue
    const storedPredecessor = snapshot.dayDrafts.get(draft.dayId)
    if (!storedPredecessor || storedPredecessor.generation > predecessorGeneration) continue

    draft.baseContentMd = storedPredecessor.contentMd
    draft.baseUpdatedAt = storedPredecessor.updatedAt
    draft.baseRowWasUnsaved = false
    if (storedPredecessor.generation === predecessorGeneration) {
      draft.baseDraftGeneration = null
    }
    changed = true
  }
  return changed
}

const settleSnapshot = (
  snapshot: PendingSnapshot,
  outcome: { error?: unknown },
) => {
  if (snapshot.settled) return
  snapshot.settled = true
  pendingSnapshots.delete(snapshot)
  if ('error' in outcome) {
    reportPersistFailure(outcome.error)
    snapshot.reject(outcome.error)
    return
  }

  durableGeneration = Math.max(durableGeneration, snapshot.generation)
  const recoveryBaselineChanged = advanceDraftRecoveryBaselines(snapshot)
  for (const [dayId, draft] of unpersistedDayDrafts) {
    if (draft.requiredAppliedGeneration <= durableGeneration) unpersistedDayDrafts.delete(dayId)
  }
  for (const [dayId, generation] of unsavedDayCreationGeneration) {
    if (generation <= durableGeneration) unsavedDayCreationGeneration.delete(dayId)
  }
  if (recoveryBaselineChanged) {
    const drafts = draftsForSessionJournal()
    if (drafts.length) writeSessionDraftJournal(mergeSessionDraftJournal(drafts))
  }
  clearSessionDraftJournalThrough(durableGeneration)
  broadcastDatabasePersisted()
  const hasRecoveryConflict = readSessionDraftJournal()?.drafts.some((draft) => draft.recoveryConflict) ?? false
  if (!hasRecoveryConflict) setPersistFailureMessage(null)
  snapshot.resolve()
}

// All writers export and issue their IDB put in the same synchronous call.
// IndexedDB serializes readwrite transactions on this object store in their
// submission order, so an older snapshot cannot land after a newer one.
const submitSnapshot = (
  db: RivoloDatabase,
  sqlite: RivoloSqlite,
  database: IDBDatabase,
): Promise<void> => {
  assertDatabaseWritable()
  if (isDatabaseMutationActive()) {
    return waitForDatabaseMutation().then(() => submitSnapshot(db, sqlite, database))
  }

  const generation = appliedGeneration
  if (generation <= durableGeneration) return Promise.resolve()
  const inFlight = findInFlightSnapshot(generation)
  if (inFlight) return inFlight.promise

  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  const snapshot: PendingSnapshot = {
    generation,
    dayDrafts: new Map(),
    promise,
    resolve,
    reject,
    settled: false,
  }
  pendingSnapshots.add(snapshot)
  let transaction: IDBTransaction | null = null

  try {
    // The permission check belongs beside export and transaction creation: a
    // caller may have waited for a mutation barrier or storage handle above.
    assertDatabaseWritable()
    snapshot.dayDrafts = captureSnapshotDayDrafts(db, generation)
    const bytes = exportSerializedDatabase(sqlite, db)
    const snapshotTransaction = database.transaction(IDB_OBJECT_STORE, 'readwrite')
    transaction = snapshotTransaction
    snapshotTransaction.oncomplete = () => settleSnapshot(snapshot, {})
    snapshotTransaction.onerror = () =>
      settleSnapshot(snapshot, {
        error: snapshotTransaction.error ?? new Error('Could not save the local database.'),
      })
    snapshotTransaction.onabort = () =>
      settleSnapshot(snapshot, {
        error: snapshotTransaction.error ?? new Error('The local database write was aborted.'),
      })
    snapshotTransaction.objectStore(IDB_OBJECT_STORE).put(bytes, DB_KEY)
    // Make the commit request while the transaction is still active. This lets
    // the browser's native storage engine finish the checkpoint even when the
    // page is immediately hidden or navigated away.
    snapshotTransaction.commit()
  } catch (error) {
    // If transaction creation succeeded but put failed synchronously, make sure
    // the native transaction cannot later commit partial work.
    try {
      transaction?.abort()
    } catch {
      // An already completed transaction needs no further cleanup.
    }
    settleSnapshot(snapshot, { error })
  }

  return promise
}

const scheduleSave = (db: RivoloDatabase) => {
  if (saveTimer !== null) {
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
  if (databaseTransactionDepth > 0) {
    databaseTransactionDirty = true
    return
  }
  if (bulkMutationDepth > 0) {
    bulkMutationDirty = true
    return
  }

  appliedGeneration += 1
  scheduleSave(db)
}

const applyPendingDayDrafts = (db: RivoloDatabase) => {
  if (!pendingDayDrafts.size) return false
  assertDatabaseWritable()
  if (databaseTransactionDepth > 0 || bulkMutationDepth > 0) {
    throw new Error('A local database operation is still in progress.')
  }

  const drafts = [...pendingDayDrafts.values()]
  let applied = false
  db.transaction(() => {
    for (const draft of drafts) {
      const current = pendingDayDrafts.get(draft.dayId)
      if (!current || current.generation !== draft.generation) continue
      current.commit(db, draft)
      applied = true
    }
  })

  if (!applied) return false
  markDatabaseChanged(db)
  for (const draft of drafts) {
    const current = pendingDayDrafts.get(draft.dayId)
    if (current?.generation !== draft.generation) continue
    pendingDayDrafts.delete(draft.dayId)
    committedDayDraftGeneration.set(
      draft.dayId,
      Math.max(committedDayDraftGeneration.get(draft.dayId) ?? 0, draft.generation),
    )
    unpersistedDayDrafts.set(draft.dayId, {
      ...current,
      requiredAppliedGeneration: appliedGeneration,
      appliedUpdatedAt: readDraftSnapshotRow(db, draft.dayId, current.contentMd)?.updated_at ?? null,
    })
    markJournalDraftApplied(current, appliedGeneration)
  }
  return true
}

export const registerPendingDayDraft = (
  dayId: string,
  contentMd: string,
  commit: PendingDayDraftCommitter,
) => {
  const generation = (latestDayDraftGeneration.get(dayId) ?? 0) + 1
  latestDayDraftGeneration.set(dayId, generation)
  const priorPendingDraft = pendingDayDrafts.get(dayId)
  const priorUnpersistedDraft = unpersistedDayDrafts.get(dayId)
  const priorDraft = priorPendingDraft ?? priorUnpersistedDraft
  const baseDraftGeneration = priorUnpersistedDraft?.generation ?? priorPendingDraft?.baseDraftGeneration ?? null
  let baseline = priorDraft
    ? {
        baseContentMd: priorDraft.baseContentMd,
        baseUpdatedAt: priorDraft.baseUpdatedAt,
        baseRowWasUnsaved: priorDraft.baseRowWasUnsaved,
      }
    : {
        baseContentMd: null,
        baseUpdatedAt: null,
        baseRowWasUnsaved: unsavedDayCreationGeneration.has(dayId),
      }
  if (!priorDraft && dbHandle) {
    try {
      const existing = queryFirstRow<{ content_md: string; updated_at: number }>(
        dbHandle,
        'SELECT content_md, updated_at FROM days WHERE day_id = ? LIMIT 1',
        [dayId],
      )
      if (existing) {
        baseline = {
          ...baseline,
          baseContentMd: existing.content_md,
          baseUpdatedAt: existing.updated_at,
        }
      }
    } catch (error) {
      console.error('[DB] draft baseline read failed', { error })
    }
  }
  unpersistedDayDrafts.delete(dayId)
  pendingDayDrafts.set(dayId, {
    dayId,
    contentMd,
    generation,
    commit,
    baseDraftGeneration,
    appliedUpdatedAt: null,
    ...baseline,
  })
  return generation
}

export const registerDayDraftRecoveryHandler = (handler: DayDraftRecoveryHandler) => {
  dayDraftRecoveryHandler = handler
}

export const markNewDayForRecovery = (dayId: string) => {
  unsavedDayCreationGeneration.set(dayId, appliedGeneration)
}

export const getPendingDayDraft = (dayId: string) => {
  const draft = pendingDayDrafts.get(dayId)
  if (!draft) return null
  const { dayId: pendingDayId, contentMd, generation, baseContentMd, baseUpdatedAt, baseRowWasUnsaved } = draft
  return { dayId: pendingDayId, contentMd, generation, baseContentMd, baseUpdatedAt, baseRowWasUnsaved }
}

export const getLatestDayDraftGeneration = (dayId: string) =>
  latestDayDraftGeneration.get(dayId) ?? 0

export const getCommittedDayDraftGeneration = (dayId: string) =>
  committedDayDraftGeneration.get(dayId) ?? 0

export const acknowledgePendingDayDraft = (dayId: string, generation: number) => {
  const current = pendingDayDrafts.get(dayId)
  if (current?.generation === generation) {
    pendingDayDrafts.delete(dayId)
    unpersistedDayDrafts.set(dayId, {
      ...current,
      requiredAppliedGeneration: appliedGeneration,
      appliedUpdatedAt: dbHandle
        ? readDraftSnapshotRow(dbHandle, dayId, current.contentMd)?.updated_at ?? null
        : null,
    })
    markJournalDraftApplied(current, appliedGeneration)
  }
  committedDayDraftGeneration.set(
    dayId,
    Math.max(committedDayDraftGeneration.get(dayId) ?? 0, generation),
  )
}

export const invalidatePendingDayDraft = (dayId: string) => {
  const generation = (latestDayDraftGeneration.get(dayId) ?? 0) + 1
  latestDayDraftGeneration.set(dayId, generation)
  pendingDayDrafts.delete(dayId)
  unpersistedDayDrafts.delete(dayId)
  unsavedDayCreationGeneration.delete(dayId)
  removeSessionDraftJournalEntry(dayId)
  return generation
}

export const isDayDraftGenerationStale = (dayId: string, generation: number) =>
  generation < (latestDayDraftGeneration.get(dayId) ?? 0) ||
  generation <= (committedDayDraftGeneration.get(dayId) ?? 0)

export const runAtomicDatabaseMutation = async <T>(
  callback: (db: RivoloDatabase) => T,
  options: {
    shouldMarkChanged?: (result: T) => boolean
    onCommit?: (result: T) => void
    persistImmediately?: boolean
  } = {},
) => {
  assertDatabaseWritable()
  const db = await getDatabase()
  assertDatabaseWritable()
  let result!: T
  const outermostTransaction = databaseTransactionDepth === 0
  const ownsMutationBarrier =
    outermostTransaction && bulkMutationDepth === 0 && databaseMutationBarrier === null
  if (ownsMutationBarrier) beginDatabaseMutationBarrier()
  if (outermostTransaction) databaseTransactionDirty = false
  databaseTransactionDepth += 1
  let transactionCommitted = false
  try {
    db.transaction(() => {
      result = callback(db)
    })
    transactionCommitted = true
  } catch (error) {
    reportPersistFailure(error)
    throw error
  } finally {
    databaseTransactionDepth -= 1
    if (outermostTransaction) databaseTransactionDirty = false
    if (ownsMutationBarrier && !transactionCommitted) releaseDatabaseMutationBarrier()
  }
  let changed = false
  try {
    changed = options.shouldMarkChanged?.(result) ?? true
    if (changed) markDatabaseChanged(db)
    options.onCommit?.(result)
  } finally {
    if (ownsMutationBarrier) releaseDatabaseMutationBarrier()
  }
  if (changed && options.persistImmediately) {
    if (isDatabaseMutationActive()) {
      snapshotRequestedDuringMutation = true
    } else {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer)
        saveTimer = null
      }
      await persistDatabase(db)
    }
  }
  return result
}

export const run = async (sql: string, params: (string | number | null)[] = []) => {
  assertDatabaseWritable()
  const db = await getDatabase()
  assertDatabaseWritable()
  executeSql(db, sql, params)
  markDatabaseChanged(db)
}

export const persistDatabase = async (db: RivoloDatabase) => {
  assertDatabaseWritable()
  try {
    await waitForDatabaseMutation()
    assertDatabaseWritable()
    const [sqlite, database] = await Promise.all([ensureSql(), ensureIdb()])
    assertDatabaseWritable()
    return await submitSnapshot(db, sqlite, database)
  } catch (error) {
    if (error instanceof Error && error.message === DATABASE_STALE_RELOAD_MESSAGE) throw error
    reportPersistFailure(error)
    throw error
  }
}

export const flushDatabaseSave = async () => {
  assertDatabaseWritable()
  try {
    await waitForDatabaseMutation()
    assertDatabaseWritable()
    const db = await getDatabase()

    assertDatabaseWritable()
    await waitForDatabaseMutation()
    assertDatabaseWritable()
    applyPendingDayDrafts(db)
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
    const [sqlite, database] = await Promise.all([ensureSql(), ensureIdb()])
    assertDatabaseWritable()
    const generation = appliedGeneration
    if (generation <= durableGeneration) return
    const inFlight = findInFlightSnapshot(generation)
    if (inFlight) return inFlight.promise
    return await submitSnapshot(db, sqlite, database)
  } catch (error) {
    if (error instanceof Error && error.message === DATABASE_STALE_RELOAD_MESSAGE) throw error
    reportPersistFailure(error)
    throw error
  }
}

export const checkpointDatabaseSynchronously = () => {
  if (isDatabaseMutationActive()) {
    const drafts = draftsForSessionJournal()
    if (drafts.length) writeSessionDraftJournal(mergeSessionDraftJournal(drafts))
    snapshotRequestedDuringMutation = true
    return false
  }

  const hasWork = pendingDayDrafts.size > 0 || appliedGeneration > durableGeneration
  if (!hasWork) return true
  const draftsBeforeApply = draftsForSessionJournal()
  if (draftsBeforeApply.length) writeSessionDraftJournal(mergeSessionDraftJournal(draftsBeforeApply))

  try {
    assertDatabaseWritable()
  } catch (error) {
    if (error instanceof Error && error.message === DATABASE_STALE_RELOAD_MESSAGE) return false
    reportPersistFailure(error)
    return false
  }

  const db = dbHandle
  const sqlite = sqliteHandle
  const database = idbHandle
  if (!db || !sqlite || !database) {
    setPersistFailureMessage(PERSIST_FAILURE_MESSAGE)
    return false
  }

  try {
    applyPendingDayDrafts(db)
    const draftsAfterApply = draftsForSessionJournal()
    if (draftsAfterApply.length) writeSessionDraftJournal(mergeSessionDraftJournal(draftsAfterApply))
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
    const generation = appliedGeneration
    if (generation <= durableGeneration || findInFlightSnapshot(generation)) return true
    void submitSnapshot(db, sqlite, database).catch(() => undefined)
    return true
  } catch (error) {
    if (error instanceof Error && error.message === DATABASE_STALE_RELOAD_MESSAGE) return false
    reportPersistFailure(error)
    return false
  }
}

export const warmDatabaseForVisiblePage = async () => {
  const db = await getDatabase()
  await ensureIdb()
  return db
}

const recoverSessionDayDrafts = async (
  db: RivoloDatabase,
  sqlite: RivoloSqlite,
  database: IDBDatabase,
) => {
  const journal = readSessionDraftJournal()
  if (!journal?.drafts.length || !dayDraftRecoveryHandler) return

  let result!: DayDraftRecoveryResult
  try {
    try {
      assertDatabaseWritable()
    } catch (error) {
      if (error instanceof Error && error.message === DATABASE_STALE_RELOAD_MESSAGE) return
      throw error
    }
    db.transaction(() => {
      result = dayDraftRecoveryHandler!(
        db,
        journal.drafts,
      )
    })
  } catch (error) {
    reportPersistFailure(error)
    return
  }

  const completed = new Set(result.completedDayIds)
  const applied = new Set(result.appliedDayIds)
  const conflicts = new Set(result.conflictDayIds)
  if (result.changed) appliedGeneration += 1

  const remaining = journal.drafts.flatMap((entry) => {
    if (applied.has(entry.dayId)) {
      return [{ ...entry, requiredAppliedGeneration: appliedGeneration, recoveryConflict: false }]
    }
    if (conflicts.has(entry.dayId)) {
      return [{ ...entry, requiredAppliedGeneration: null, recoveryConflict: true }]
    }
    if (completed.has(entry.dayId)) return []
    return [entry]
  })
  writeSessionDraftJournal(remaining)

  if (conflicts.size) {
    reportPersistFailure(new Error('An interrupted note edit conflicts with newer local data.'))
  }
  if (!result.changed) return

  try {
    await submitSnapshot(db, sqlite, database)
  } catch {
    // Keep the synchronous session journal for another startup attempt.
  }
}

export const getDatabase = async () => {
  if (!dbPromise) {
    dbPromise = (async () => {
      const [sqlite, idb] = await Promise.all([ensureSql(), ensureIdb()])
      beginDatabaseSnapshotLoad()
      const stored = await readStoredSnapshot(idb)
      const db = openSerializedDatabase(sqlite, stored ? new Uint8Array(stored) : null)
      const schema = ensureDatabaseSchema(db)
      ftsAvailable = schema.ftsAvailable
      dbHandle = db
      if (schema.ftsRebuilt || schema.hashtagIndexCreated) markDatabaseChanged(db)
      await recoverSessionDayDrafts(db, sqlite, idb)
      return db
    })().catch((error) => {
      dbPromise = null
      dbHandle = null
      throw error
    })
  }

  return dbPromise
}

export const runBulkDatabaseMutation = async <T>(callback: () => Promise<T>) => {
  assertDatabaseWritable()
  const isOutermostBulk = bulkMutationDepth === 0
  if (isOutermostBulk) beginDatabaseMutationBarrier()
  bulkMutationDepth += 1
  let result!: T
  let operationError: unknown
  let operationFailed = false

  try {
    result = await callback()
  } catch (error) {
    operationFailed = true
    operationError = error
  }

  bulkMutationDepth -= 1

  const changed = isOutermostBulk && bulkMutationDirty
  if (isOutermostBulk) bulkMutationDirty = false
  try {
    if (changed) {
      const db = dbHandle ?? await getDatabase()
      appliedGeneration += 1
      scheduleSave(db)
    }
  } finally {
    if (isOutermostBulk) releaseDatabaseMutationBarrier()
  }

  if (isOutermostBulk && operationFailed) {
    if (appliedGeneration > durableGeneration) {
      try {
        await flushDatabaseSave()
      } catch {
        // Keep the original bulk error; the persistence failure remains visible.
      }
    }
    throw operationError
  }
  if (isOutermostBulk && changed) {
    await flushDatabaseSave()
  }
  if (operationFailed) throw operationError

  return result
}

export const runDatabaseTransaction = async <T>(callback: () => Promise<T>) => {
  assertDatabaseWritable()
  const db = await getDatabase()
  assertDatabaseWritable()
  const outermostTransaction = databaseTransactionDepth === 0
  const ownsMutationBarrier =
    outermostTransaction && bulkMutationDepth === 0 && databaseMutationBarrier === null
  if (ownsMutationBarrier) beginDatabaseMutationBarrier()
  if (outermostTransaction) databaseTransactionDirty = false
  databaseTransactionDepth += 1
  let started = false
  try {
    executeSql(db, 'BEGIN TRANSACTION')
    started = true
    const result = await callback()
    executeSql(db, 'COMMIT')
    started = false
    return result
  } catch (error) {
    if (started) {
      try {
        executeSql(db, 'ROLLBACK')
      } catch (rollbackError) {
        console.error('[DB] transaction rollback failed', { rollbackError })
      }
    }
    throw error
  } finally {
    databaseTransactionDepth -= 1
    if (outermostTransaction) {
      const changed = databaseTransactionDirty
      databaseTransactionDirty = false
      if (changed && !started) markDatabaseChanged(db)
    }
    if (ownsMutationBarrier) releaseDatabaseMutationBarrier()
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

export const upsertFts = async (dayId: string, humanTitle: string, content: string) => {
  assertDatabaseWritable()
  if (!(await isFtsAvailable())) return

  assertDatabaseWritable()
  const db = await getDatabase()
  assertDatabaseWritable()
  executeSql(db, 'DELETE FROM days_fts WHERE day_id = ?', [dayId])
  executeSql(db, 'INSERT INTO days_fts (day_id, human_title, content_md) VALUES (?, ?, ?)', [
    dayId,
    humanTitle,
    content,
  ])
  markDatabaseChanged(db)
}
