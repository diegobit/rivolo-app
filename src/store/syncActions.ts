import { pullFromSync, pushToSync } from '../lib/sync'
import { useDaysStore } from './useDaysStore'
import { useSyncStore } from './useSyncStore'

export const pullFromSyncAndRefresh = async () => {
  useSyncStore.getState().setSyncing(true, 'pull')
  try {
    const result = await pullFromSync()
    if (result.status === 'pulled') {
      await useDaysStore.getState().loadTimeline()
    }
    await useSyncStore.getState().loadState()
    return result
  } finally {
    useSyncStore.getState().setSyncing(false)
  }
}

export const pushToSyncAndRefresh = async (force = false) => {
  useSyncStore.getState().setSyncing(true, 'push')
  try {
    const result = await pushToSync(force)
    await useSyncStore.getState().loadState()
    return result
  } finally {
    useSyncStore.getState().setSyncing(false)
  }
}
