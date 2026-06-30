import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sync = vi.hoisted(() => ({
  getActiveProviderStatus: vi.fn(),
  pullFromSync: vi.fn(),
  pushToSync: vi.fn(),
}))
const coordinator = vi.hoisted(() => ({
  getTabSyncBlockReason: vi.fn(),
}))
const stores = vi.hoisted(() => ({
  loadTimeline: vi.fn(),
  loadSyncState: vi.fn(),
  setSyncing: vi.fn(),
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
    }),
  },
}))

import {
  pullFromSyncAndRefresh,
  scheduleAutoPushToSync,
} from './syncActions'

describe('sync action tab coordination', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    coordinator.getTabSyncBlockReason.mockReturnValue(null)
    sync.pullFromSync.mockResolvedValue({ status: 'noop' })
    sync.pushToSync.mockResolvedValue({ status: 'pushed' })
    sync.getActiveProviderStatus.mockResolvedValue({ localDirty: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('blocks manual sync when another tab owns the lease', async () => {
    coordinator.getTabSyncBlockReason.mockReturnValue(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )

    await expect(pullFromSyncAndRefresh()).rejects.toThrow(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )
    expect(sync.pullFromSync).not.toHaveBeenCalled()
  })

  it('does not schedule auto-push in a secondary tab', () => {
    coordinator.getTabSyncBlockReason.mockReturnValue(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )

    scheduleAutoPushToSync()
    vi.advanceTimersByTime(10_000)

    expect(sync.pushToSync).not.toHaveBeenCalled()
  })
})
