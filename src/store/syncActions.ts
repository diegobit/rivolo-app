import { getActiveProviderStatus, pullFromSync, pushToSync } from '../lib/sync'
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

export const pullFromSyncAndRefresh = async (options?: { allowDirty?: boolean }) =>
  enqueueSyncOperation('pull', async () => {
    const allowDirty = options?.allowDirty ?? true
    if (!allowDirty) {
      const status = await getActiveProviderStatus()
      if (status.localDirty) {
        await useSyncStore.getState().loadState()
        return { status: 'noop' as const }
      }
    }

    const result = await pullFromSync()
    if (result.status === 'pulled') {
      await useDaysStore.getState().loadTimeline()
    }
    await useSyncStore.getState().loadState()
    return result
  })

export const pushToSyncAndRefresh = async (force = false) =>
  enqueueSyncOperation('push', async () => {
    const result = await pushToSync(force)
    await useSyncStore.getState().loadState()
    return result
  })

const runAutoPush = () => {
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
  if (autoPushTimer !== null) {
    window.clearTimeout(autoPushTimer)
  }

  autoPushTimer = window.setTimeout(() => {
    autoPushTimer = null
    void runAutoPush()
  }, AUTO_PUSH_DELAY_MS)
}

export const flushAutoPushToSync = async () => {
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
