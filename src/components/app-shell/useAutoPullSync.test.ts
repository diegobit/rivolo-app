import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoPullSync } from './useAutoPullSync'

const coordinator = vi.hoisted(() => ({
  getTabSyncBlockReason: vi.fn(),
}))
const syncActions = vi.hoisted(() => ({
  pullFromSyncAndRefresh: vi.fn(),
  recordSyncAttention: vi.fn(),
  detectRemoteChangeWhileDirty: vi.fn(),
}))

vi.mock('../../lib/tabSyncCoordinator', () => coordinator)
vi.mock('../../store/syncActions', () => syncActions)

describe('useAutoPullSync tab coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coordinator.getTabSyncBlockReason.mockReturnValue(null)
    syncActions.pullFromSyncAndRefresh.mockResolvedValue({ status: 'noop' })
    syncActions.detectRemoteChangeWhileDirty.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
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

  it('detects remote changes instead of auto-pulling when local edits are dirty', async () => {
    renderHook(() =>
      useAutoPullSync({ connected: true, targetName: '/inbox.md', localDirty: true }),
    )

    await waitFor(() => {
      expect(syncActions.detectRemoteChangeWhileDirty).toHaveBeenCalled()
    })
    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
  })

  it('auto-pulls (not detect) when local is clean', async () => {
    renderHook(() =>
      useAutoPullSync({ connected: true, targetName: '/inbox.md', localDirty: false }),
    )

    await waitFor(() => {
      expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledWith({ force: false })
    })
    expect(syncActions.detectRemoteChangeWhileDirty).not.toHaveBeenCalled()
  })

  it('does neither while another tab owns the lease, even when dirty', () => {
    coordinator.getTabSyncBlockReason.mockReturnValue(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )

    renderHook(() =>
      useAutoPullSync({ connected: true, targetName: '/inbox.md', localDirty: true }),
    )

    expect(syncActions.detectRemoteChangeWhileDirty).not.toHaveBeenCalled()
    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
  })

  it('periodically rechecks remote metadata while local edits remain dirty', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))

    renderHook(() =>
      useAutoPullSync({ connected: true, targetName: '/inbox.md', localDirty: true }),
    )

    await act(async () => Promise.resolve())
    expect(syncActions.detectRemoteChangeWhileDirty).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    })

    expect(syncActions.detectRemoteChangeWhileDirty).toHaveBeenCalledTimes(16)
    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
  })

  it('retries dirty detection after a recent clean auto-pull used the throttle', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))

    const { rerender } = renderHook(
      ({ localDirty }) =>
        useAutoPullSync({ connected: true, targetName: '/inbox.md', localDirty }),
      { initialProps: { localDirty: false } },
    )

    await act(async () => Promise.resolve())
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)

    rerender({ localDirty: true })
    expect(syncActions.detectRemoteChangeWhileDirty).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    })

    expect(syncActions.detectRemoteChangeWhileDirty).toHaveBeenCalledTimes(1)
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes on focus after 15 seconds backgrounded, bypassing the normal throttle', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))

    renderHook(() =>
      useAutoPullSync({ connected: true, targetName: '/inbox.md', localDirty: false }),
    )

    await act(async () => Promise.resolve())
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)

    act(() => window.dispatchEvent(new Event('blur')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999)
    })
    act(() => window.dispatchEvent(new Event('focus')))
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)

    act(() => window.dispatchEvent(new Event('blur')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    act(() => window.dispatchEvent(new Event('focus')))
    await act(async () => Promise.resolve())

    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(2)
  })

  it('deduplicates visibility and focus events for the same foreground return', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
    const visibilityState = vi.spyOn(document, 'visibilityState', 'get')
    visibilityState.mockReturnValue('visible')

    renderHook(() =>
      useAutoPullSync({ connected: true, targetName: '/inbox.md', localDirty: false }),
    )

    await act(async () => Promise.resolve())
    visibilityState.mockReturnValue('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    visibilityState.mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await act(async () => Promise.resolve())

    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(2)
    visibilityState.mockRestore()
  })

  it('uses remote-change detection on foreground return while dirty', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))

    renderHook(() =>
      useAutoPullSync({ connected: true, targetName: '/inbox.md', localDirty: true }),
    )

    await act(async () => Promise.resolve())
    act(() => window.dispatchEvent(new Event('blur')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    act(() => window.dispatchEvent(new Event('focus')))
    await act(async () => Promise.resolve())

    expect(syncActions.detectRemoteChangeWhileDirty).toHaveBeenCalledTimes(2)
    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
  })
})
