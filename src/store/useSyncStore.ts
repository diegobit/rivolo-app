import { create } from 'zustand'
import { getActiveProviderId, getActiveProviderStatus, getEmptySyncStatus, setActiveProviderId } from '../lib/sync'
import type { SyncProviderId, SyncStatus } from '../lib/sync'

export type SyncOperation = 'pull' | 'push' | null

export type SyncAttention = {
  operation: 'pull' | 'push'
  message: string
  at: number
  // A push the cloud refused (changed or missing remote), as opposed to an
  // error that a plain retry might fix.
  blocked?: boolean
}

export type SyncViewState = {
  activeProvider: SyncProviderId | null
  status: SyncStatus
  syncing: boolean
  syncOperation: SyncOperation
  syncAttention: SyncAttention | null
  syncIssues: Record<string, SyncAttention>
  loadState: () => Promise<void>
  setActiveProvider: (providerId: SyncProviderId | null) => Promise<void>
  setSyncing: (syncing: boolean, operation?: SyncOperation) => void
  setSyncAttention: (attention: SyncAttention | null) => void
  setSyncIssue: (id: string, attention: SyncAttention | null) => void
}

export const useSyncStore = create<SyncViewState>((set) => ({
  activeProvider: null,
  status: getEmptySyncStatus(),
  syncing: false,
  syncOperation: null,
  syncAttention: null,
  syncIssues: {},

  loadState: async () => {
    const activeProvider = await getActiveProviderId()
    const status = await getActiveProviderStatus()
    set((current) => ({ activeProvider, status,
      syncAttention: current.activeProvider === activeProvider && current.status.targetName === status.targetName ? current.syncAttention : null,
      syncIssues: current.activeProvider === activeProvider && current.status.targetName === status.targetName ? current.syncIssues : {},
    }))
  },

  setActiveProvider: async (providerId: SyncProviderId | null) => {
    await setActiveProviderId(providerId)
    const status = providerId ? await getActiveProviderStatus() : getEmptySyncStatus()
    set((current) => ({ activeProvider: providerId, status,
      syncAttention: current.activeProvider === providerId && current.status.targetName === status.targetName ? current.syncAttention : null,
      syncIssues: current.activeProvider === providerId && current.status.targetName === status.targetName ? current.syncIssues : {},
    }))
  },

  setSyncing: (syncing: boolean, operation?: SyncOperation) => {
    set({ syncing, syncOperation: syncing ? operation ?? null : null })
  },

  setSyncAttention: (attention: SyncAttention | null) => {
    set({ syncAttention: attention })
  },
  setSyncIssue: (id: string, attention: SyncAttention | null) => {
    set((current) => {
      const syncIssues = { ...current.syncIssues }
      if (attention) syncIssues[id] = attention
      else delete syncIssues[id]
      const issues = Object.values(syncIssues)
      return { syncIssues, syncAttention: issues.length ? { ...issues[0], message: issues.map((issue) => issue.message).join(' ') } : null }
    })
  },
}))
