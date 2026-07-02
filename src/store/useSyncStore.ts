import { create } from 'zustand'
import { getActiveProviderId, getActiveProviderStatus, getEmptySyncStatus, setActiveProviderId } from '../lib/sync'
import type { SyncProviderId, SyncStatus } from '../lib/sync'

export type SyncOperation = 'pull' | 'push' | null

export type SyncAttention = {
  operation: 'pull' | 'push'
  message: string
  at: number
}

export type SyncViewState = {
  activeProvider: SyncProviderId | null
  status: SyncStatus
  syncing: boolean
  syncOperation: SyncOperation
  syncAttention: SyncAttention | null
  loadState: () => Promise<void>
  setActiveProvider: (providerId: SyncProviderId | null) => Promise<void>
  setSyncing: (syncing: boolean, operation?: SyncOperation) => void
  setSyncAttention: (attention: SyncAttention | null) => void
}

export const useSyncStore = create<SyncViewState>((set) => ({
  activeProvider: null,
  status: getEmptySyncStatus(),
  syncing: false,
  syncOperation: null,
  syncAttention: null,

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

  setSyncing: (syncing: boolean, operation?: SyncOperation) => {
    set({ syncing, syncOperation: syncing ? operation ?? null : null })
  },

  setSyncAttention: (attention: SyncAttention | null) => {
    set({ syncAttention: attention })
  },
}))
