import { pullFromSync } from '../lib/sync'
import { useDaysStore } from './useDaysStore'
import { useSyncStore } from './useSyncStore'

export const pullFromSyncAndRefresh = async () => {
  const result = await pullFromSync()
  if (result.status === 'pulled') {
    await useDaysStore.getState().loadTimeline()
  }
  await useSyncStore.getState().loadState()
  return result
}
