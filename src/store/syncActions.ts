import { getActiveProviderStatus, pullFromSync, pushToSync } from '../lib/sync'
import { getTabSyncBlockReason } from '../lib/tabSyncCoordinator'
import { useDaysStore } from './useDaysStore'
import { useSyncStore } from './useSyncStore'

type SyncQueueOperation = 'pull' | 'push'

const AUTO_PUSH_DELAY_MS = 7_000

let syncQueueTail: Promise<void> = Promise.resolve()
let autoPushTimer: number | null = null
let autoPushInFlight: Promise<void> | null = null
let autoPushRequestedWhileRunning = false

const enqueueSyncOperation = async <T>(operation: SyncQueueOperation, runner: () => Promise<T>) => {
  const run = async () => {
    useSyncStore.getState().setSyncing(true, operation)
    try {
      return await runner()
    } finally {
      useSyncStore.getState().setSyncing(false)
    }
  }

  const queuedRun = syncQueueTail.then(run, run)
  syncQueueTail = queuedRun.then(
    () => undefined,
    () => undefined,
  )
  return queuedRun
}

const requirePrimarySyncTab = () => {
  const reason = getTabSyncBlockReason()
  if (reason) throw new Error(reason)
}

const canRunAutoSync = () => getTabSyncBlockReason() === null

export const pullFromSyncAndRefresh = async (options?: {
  force?: boolean
  allowDestructiveReplace?: boolean
}) =>
  enqueueSyncOperation('pull', async () => {
    requirePrimarySyncTab()
    const force = options?.force ?? false
    if (!force) {
      const status = await getActiveProviderStatus()
      if (status.localDirty) {
        await useSyncStore.getState().loadState()
        return { status: 'noop' as const }
      }
    }

    const result = await pullFromSync({
      force,
      allowDestructiveReplace: options?.allowDestructiveReplace,
    })
    if (result.status === 'pulled') {
      await useDaysStore.getState().loadTimeline()
    }
    await useSyncStore.getState().loadState()
    return result
  })

export const pushToSyncAndRefresh = async (force = false) =>
  enqueueSyncOperation('push', async () => {
    requirePrimarySyncTab()
    const result = await pushToSync(force)
    await useSyncStore.getState().loadState()
    return result
  })

const runAutoPush = () => {
  if (!canRunAutoSync()) {
    return Promise.resolve()
  }

  if (autoPushInFlight) {
    autoPushRequestedWhileRunning = true
    return autoPushInFlight
  }

  autoPushRequestedWhileRunning = false
  const run = pushToSyncAndRefresh().then(
    () => undefined,
    () => undefined,
  )
  autoPushInFlight = run
  run.then(
    () => {
      autoPushInFlight = null
      if (autoPushRequestedWhileRunning) {
        autoPushRequestedWhileRunning = false
        void runAutoPush()
      }
    },
    () => {
      autoPushInFlight = null
    },
  )
  return run
}

export const scheduleAutoPushToSync = () => {
  if (!canRunAutoSync()) {
    return
  }

  if (autoPushTimer !== null) {
    window.clearTimeout(autoPushTimer)
  }

  autoPushTimer = window.setTimeout(() => {
    autoPushTimer = null
    void runAutoPush()
  }, AUTO_PUSH_DELAY_MS)
}

export const flushAutoPushToSync = async () => {
  if (!canRunAutoSync()) {
    return
  }

  if (autoPushTimer === null) {
    if (autoPushInFlight) {
      await autoPushInFlight
    }
    return
  }

  window.clearTimeout(autoPushTimer)
  autoPushTimer = null
  await runAutoPush()
}
