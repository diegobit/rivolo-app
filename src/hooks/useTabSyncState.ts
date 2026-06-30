import { useEffect, useSyncExternalStore } from 'react'
import {
  getTabSyncSnapshot,
  startPrimaryTabCoordinator,
  subscribeTabSync,
} from '../lib/tabSyncCoordinator'

export const useTabSyncState = () => {
  useEffect(() => {
    startPrimaryTabCoordinator()
  }, [])

  return useSyncExternalStore(subscribeTabSync, getTabSyncSnapshot, getTabSyncSnapshot)
}
