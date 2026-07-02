import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoPullSync } from './useAutoPullSync'

const coordinator = vi.hoisted(() => ({
  getTabSyncBlockReason: vi.fn(),
}))
const syncActions = vi.hoisted(() => ({
  pullFromSyncAndRefresh: vi.fn(),
  recordSyncAttention: vi.fn(),
}))

vi.mock('../../lib/tabSyncCoordinator', () => coordinator)
vi.mock('../../store/syncActions', () => syncActions)

describe('useAutoPullSync tab coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coordinator.getTabSyncBlockReason.mockReturnValue(null)
    syncActions.pullFromSyncAndRefresh.mockResolvedValue({ status: 'noop' })
  })

  it('does not auto-pull when another tab owns the lease', () => {
    coordinator.getTabSyncBlockReason.mockReturnValue(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )

    renderHook(() =>
      useAutoPullSync({
        connected: true,
        targetName: '/inbox.md',
        localDirty: false,
      }),
    )

    expect(coordinator.getTabSyncBlockReason).toHaveBeenCalled()
    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
  })

  it('records attention when an automatic pull fails', async () => {
    syncActions.pullFromSyncAndRefresh.mockRejectedValue(
      new Error('Import aborted because the Markdown file contains duplicate day markers.'),
    )

    renderHook(() =>
      useAutoPullSync({
        connected: true,
        targetName: '/inbox.md',
        localDirty: false,
      }),
    )

    await waitFor(() => {
      expect(syncActions.recordSyncAttention).toHaveBeenCalledWith(
        'pull',
        'Import aborted because the Markdown file contains duplicate day markers.',
      )
    })
  })
})
