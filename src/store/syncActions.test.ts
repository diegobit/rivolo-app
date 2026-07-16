import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sync = vi.hoisted(() => ({
  getActiveProviderStatus: vi.fn(),
  pullFromSync: vi.fn(),
  pushToSync: vi.fn(),
  checkActiveProviderRemote: vi.fn(),
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
    }),
  },
}))

import {
  detectRemoteChangeWhileDirty,
  pullFromSyncAndRefresh,
  pushToSyncAndRefresh,
  scheduleAutoPushToSync,
} from './syncActions'

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
    sync.checkActiveProviderRemote.mockResolvedValue({ status: 'unknown' })
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

  it('clears attention after a successful automatic push', async () => {
    stores.syncAttention = { operation: 'push', message: 'Old failure.', at: 0 }

    scheduleAutoPushToSync()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(sync.pushToSync).toHaveBeenCalled()
    expect(stores.setSyncAttention).toHaveBeenCalledWith(null)
  })
})

describe('detectRemoteChangeWhileDirty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stores.syncAttention = null
    coordinator.getTabSyncBlockReason.mockReturnValue(null)
    sync.checkActiveProviderRemote.mockResolvedValue({ status: 'unknown' })
  })

  it('raises sync attention when the remote changed while dirty', async () => {
    sync.checkActiveProviderRemote.mockResolvedValue({ status: 'changed', reason: 'remote_changed' })

    await detectRemoteChangeWhileDirty()

    expect(stores.setSyncAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'pull',
        message: expect.stringContaining('changed on another device'),
      }),
    )
  })

  it('raises sync attention when the remote file went missing while dirty', async () => {
    sync.checkActiveProviderRemote.mockResolvedValue({ status: 'changed', reason: 'remote_missing' })

    await detectRemoteChangeWhileDirty()

    expect(stores.setSyncAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'pull',
        message: expect.stringContaining('was removed on another device'),
      }),
    )
  })

  it('stays quiet when the remote is unchanged', async () => {
    sync.checkActiveProviderRemote.mockResolvedValue({ status: 'unchanged' })

    await detectRemoteChangeWhileDirty()

    expect(stores.setSyncAttention).not.toHaveBeenCalled()
  })

  it('does not even check the remote in a secondary tab', async () => {
    coordinator.getTabSyncBlockReason.mockReturnValue(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )

    await detectRemoteChangeWhileDirty()

    expect(sync.checkActiveProviderRemote).not.toHaveBeenCalled()
    expect(stores.setSyncAttention).not.toHaveBeenCalled()
  })
})
