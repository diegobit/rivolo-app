import { getActiveProviderStatus, pullFromSync, pushToSync } from '../lib/sync'
import { useDaysStore } from './useDaysStore'
import { useSyncStore } from './useSyncStore'

type SyncQueueOperation = 'pull' | 'push'

let syncQueueTail: Promise<void> = Promise.resolve()

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
