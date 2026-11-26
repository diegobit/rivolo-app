import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sync = vi.hoisted(() => ({
  getActiveProviderStatus: vi.fn(),
  pullFromSync: vi.fn(),
  pushToSync: vi.fn(),
}))
const coordinator = vi.hoisted(() => ({
  claimPrimaryTabForSync: vi.fn(),
  getTabSyncBlockReason: vi.fn(),
}))
const stores = vi.hoisted(() => ({
  loadTimeline: vi.fn(),
  loadSyncState: vi.fn(),
  setSyncing: vi.fn(),
  setSyncAttention: vi.fn(),
  syncAttention: null as { operation: string; message: string; at: number } | null,
}))

vi.mock('../lib/sync', () => sync)
vi.mock('../lib/tabSyncCoordinator', () => ({
  ...coordinator,
}))
vi.mock('./useDaysStore', () => ({
  useDaysStore: { getState: () => ({ loadTimeline: stores.loadTimeline }) },
}))
vi.mock('./useSyncStore', () => ({
  useSyncStore: {
    getState: () => ({
      loadState: stores.loadSyncState,
      setSyncing: stores.setSyncing,
      setSyncAttention: stores.setSyncAttention,
      syncAttention: stores.syncAttention,
      activeProvider: 'google-drive',
      status: { daily: false, targetName: '/rivolo/inbox.md' },
    }),
  },
}))

import {
  pullFromSyncAndRefresh,
  pushToSyncAndRefresh,
  recordSyncAttention,
  scheduleAutoPushToSync,
} from './syncActions'
import { registerPendingEditorSaves } from '../lib/pendingEditorSaves'

describe('sync action tab coordination', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    stores.syncAttention = null
    coordinator.claimPrimaryTabForSync.mockReturnValue(null)
    coordinator.getTabSyncBlockReason.mockReturnValue(null)
    sync.pullFromSync.mockResolvedValue({ status: 'noop' })
    sync.pushToSync.mockResolvedValue({ status: 'pushed' })
    sync.getActiveProviderStatus.mockResolvedValue({ localDirty: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('blocks manual sync when another tab owns the lease', async () => {
    coordinator.claimPrimaryTabForSync.mockReturnValue(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )

    await expect(pullFromSyncAndRefresh()).rejects.toThrow(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )
    expect(sync.pullFromSync).not.toHaveBeenCalled()
    expect(coordinator.claimPrimaryTabForSync).toHaveBeenCalledOnce()
  })

  it('does not schedule auto-push in a secondary tab', () => {
    coordinator.getTabSyncBlockReason.mockReturnValue(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )

    scheduleAutoPushToSync()
    vi.advanceTimersByTime(10_000)

    expect(sync.pushToSync).not.toHaveBeenCalled()
  })

  it('records attention when an automatic push is blocked', async () => {
    sync.pushToSync.mockResolvedValue({ status: 'blocked', reason: 'remote_changed' })

    scheduleAutoPushToSync()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(stores.setSyncAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'push',
        message: expect.stringContaining('Google Drive changed remotely'),
        blocked: true,
      }),
    )
  })

  it('records attention returned by a completed push', async () => {
    sync.pushToSync.mockResolvedValue({
      status: 'pushed',
      attention: 'Google Drive changed while uploading.',
    })

    await pushToSyncAndRefresh()

    expect(stores.setSyncAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'push',
        message: 'Google Drive changed while uploading.',
      }),
    )
  })

  it('refreshes the visible notebook after a push imports merged remote additions', async () => {
    sync.pushToSync.mockResolvedValue({ status: 'pushed', localUpdated: true })
    await pushToSyncAndRefresh()
    expect(stores.loadTimeline).toHaveBeenCalledWith({ preserveWindow: true })
    expect(stores.loadSyncState).toHaveBeenCalled()
  })

  it('clears attention after a successful automatic push', async () => {
    stores.syncAttention = { operation: 'push', message: 'Old failure.', at: 0 }

    scheduleAutoPushToSync()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(sync.pushToSync).toHaveBeenCalled()
    expect(stores.setSyncAttention).toHaveBeenCalledWith(null)
  })

  it('does not refresh an identical attention item', () => {
    stores.syncAttention = { operation: 'push', message: 'Remote changed.', at: 1 }

    recordSyncAttention('push', 'Remote changed.')

    expect(stores.setSyncAttention).not.toHaveBeenCalled()
  })

  it.each(['pulled', 'noop'] as const)('clears the notification after a successful %s pull', async (status) => {
    stores.syncAttention = { operation: 'pull', message: 'OneDrive unavailable.', at: 1 }
    sync.pullFromSync.mockResolvedValue({ status })
    await pullFromSyncAndRefresh()
    expect(stores.setSyncAttention).toHaveBeenCalledWith(null)
  })

  it('keeps the notification after a blocked push or a failed pull', async () => {
    stores.syncAttention = { operation: 'push', message: 'Remote changed.', at: 1 }
    sync.pushToSync.mockResolvedValue({ status: 'blocked', reason: 'remote_changed' })
    await pushToSyncAndRefresh()
    sync.pullFromSync.mockRejectedValue(new Error('Still unavailable'))
    await expect(pullFromSyncAndRefresh()).rejects.toThrow('Still unavailable')
    expect(stores.setSyncAttention).not.toHaveBeenCalledWith(null)
  })

  it('does not clear the notification when sync was skipped for pending editor drafts', async () => {
    stores.syncAttention = { operation: 'push', message: 'Remote changed.', at: 1 }
    sync.pushToSync.mockResolvedValue({ status: 'clean' })
    const unregister = registerPendingEditorSaves(() => ['2026-09-30'])
    try {
      await pushToSyncAndRefresh()
      await pullFromSyncAndRefresh()
      expect(stores.setSyncAttention).not.toHaveBeenCalledWith(null)
    } finally { unregister() }
  })

  it('does not treat a push with nothing to upload as recovery from a pull failure', async () => {
    stores.syncAttention = { operation: 'pull', message: 'OneDrive download failed.', at: 1 }
    sync.pushToSync.mockResolvedValue({ status: 'clean' })
    await pushToSyncAndRefresh()
    expect(stores.setSyncAttention).not.toHaveBeenCalledWith(null)
  })
})
