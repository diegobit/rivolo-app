import { getActiveProviderStatus, pullFromSync, pushToSync } from '../lib/sync'
import { SYNC_PROVIDER_LABELS } from '../lib/syncState'
import { claimPrimaryTabForSync, getTabSyncBlockReason } from '../lib/tabSyncCoordinator'
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
  const reason = claimPrimaryTabForSync()
  if (reason) throw new Error(reason)
}

const canRunAutoSync = () => getTabSyncBlockReason() === null

const activeProviderLabel = () => {
  const providerId = useSyncStore.getState().activeProvider
  return providerId ? SYNC_PROVIDER_LABELS[providerId] : 'Sync provider'
}

export const recordSyncAttention = (operation: 'pull' | 'push', message: string) => {
  const state = useSyncStore.getState()
  if (
    state.syncAttention?.operation === operation &&
    state.syncAttention.message === message
  ) {
    return
  }
  state.setSyncAttention({ operation, message, at: Date.now() })
}

const clearSyncAttention = () => {
  if (useSyncStore.getState().syncAttention) {
    useSyncStore.getState().setSyncAttention(null)
  }
}

// These messages render inside the sync-attention alert, which shows its own
// recovery buttons in both Basic and Advanced mode — so they describe the
// situation without naming any button that could be absent from the mode.
export const blockedPushMessage = (reason: 'remote_missing' | 'remote_changed') => {
  const label = activeProviderLabel()
  return reason === 'remote_missing'
    ? `${label} file is missing. Local data is safe — keep this device's notes to recreate it.`
    : `${label} changed remotely. Choose which copy to keep.`
}

export const pullFromSyncAndRefresh = async (options?: {
  force?: boolean
  allowUnsafeImport?: boolean
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
      allowUnsafeImport: options?.allowUnsafeImport,
    })
    if (result.status === 'pulled') {
      await useDaysStore.getState().loadTimeline()
    }
    await useSyncStore.getState().loadState()
    clearSyncAttention()
    return result
  })

export const pushToSyncAndRefresh = async (force = false) =>
  enqueueSyncOperation('push', async () => {
    requirePrimarySyncTab()
    const result = await pushToSync(force)
    await useSyncStore.getState().loadState()
    if (result.status === 'pushed' && result.attention) {
      recordSyncAttention('push', result.attention)
    } else if (result.status !== 'blocked') {
      clearSyncAttention()
    }
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
    (result) => {
      if (result.status === 'blocked') {
        recordSyncAttention('push', blockedPushMessage(result.reason))
      }
    },
    (error: unknown) => {
      recordSyncAttention(
        'push',
        error instanceof Error ? error.message : 'Automatic push failed.',
      )
    },
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
