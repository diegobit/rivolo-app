import { create } from 'zustand'
import { getActiveProviderId, getActiveProviderStatus, getEmptySyncStatus, setActiveProviderId } from '../lib/sync'
import type { SyncProviderId, SyncStatus } from '../lib/sync'

export type SyncViewState = {
  activeProvider: SyncProviderId | null
  status: SyncStatus
  loadState: () => Promise<void>
  setActiveProvider: (providerId: SyncProviderId | null) => Promise<void>
}

export const useSyncStore = create<SyncViewState>((set) => ({
  activeProvider: null,
  status: getEmptySyncStatus(),

  loadState: async () => {
    const activeProvider = await getActiveProviderId()
    const status = await getActiveProviderStatus()
    set({ activeProvider, status })
  },

  setActiveProvider: async (providerId: SyncProviderId | null) => {
    await setActiveProviderId(providerId)
    const status = providerId ? await getActiveProviderStatus() : getEmptySyncStatus()
    set({ activeProvider: providerId, status })
  },
}))
