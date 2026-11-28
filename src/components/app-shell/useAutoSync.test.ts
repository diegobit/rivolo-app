import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoSync } from './useAutoSync'
import { registerPendingEditorSaves } from '../../lib/pendingEditorSaves'

const coordinator = vi.hoisted(() => ({
  getTabSyncBlockReason: vi.fn(),
}))
const providerState = vi.hoisted(() => ({ getActiveProviderStatus: vi.fn() }))
vi.mock('../../lib/sync', () => providerState)
const syncActions = vi.hoisted(() => ({
  pullFromSyncAndRefresh: vi.fn(),
  pushToSyncAndRefresh: vi.fn(),
  recordBlockedPush: vi.fn(),
  recordSyncAttention: vi.fn(),
}))

vi.mock('../../lib/tabSyncCoordinator', () => coordinator)
vi.mock('../../store/syncActions', () => syncActions)

const daily = { connected: true, targetName: '/inbox.rivolo-daily', notebookChannel: 'id:daily-folder', localDirty: false, daily: true }

describe('useAutoSync tab coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coordinator.getTabSyncBlockReason.mockReturnValue(null)
    providerState.getActiveProviderStatus.mockResolvedValue({ localDirty: false })
    syncActions.pullFromSyncAndRefresh.mockResolvedValue({ status: 'noop' })
    syncActions.pushToSyncAndRefresh.mockResolvedValue({ status: 'pushed' })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('waits for a draft without checking the cloud, then pushes it and pulls only the deferred day', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    let pending = ['2026-10-01']
    const unregister = registerPendingEditorSaves(() => pending)
    syncActions.pullFromSyncAndRefresh.mockResolvedValueOnce({ status: 'noop', deferredDayIds: ['2026-10-01'] })
    const hook = renderHook(() => useAutoSync(daily, 'dropbox'))
    try {
      await act(async () => Promise.resolve())
      expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
      expect(syncActions.pushToSyncAndRefresh).not.toHaveBeenCalled()
      pending = []
      providerState.getActiveProviderStatus.mockResolvedValue({ localDirty: true })
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      expect(syncActions.pushToSyncAndRefresh).toHaveBeenCalledWith(false)
      expect(syncActions.pullFromSyncAndRefresh).toHaveBeenLastCalledWith({ force: false, dayIds: ['2026-10-01'] })
    } finally { unregister(); hook.unmount(); vi.restoreAllMocks() }
  })

  it('does not check a daily notebook while idle and refreshes on return', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    renderHook(() => useAutoSync(daily, 'dropbox'))
    await act(async () => Promise.resolve())
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
    visibility.mockReturnValue('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
    visibility.mockReturnValue('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => Promise.resolve())
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(2)
    online.mockReturnValue(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(2)
    visibility.mockRestore()
    online.mockRestore()
  })

  it('retries a failed daily reconciliation, then stays idle after recovery', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
    syncActions.pullFromSyncAndRefresh.mockRejectedValueOnce(new Error('Network failed'))
    renderHook(() => useAutoSync(daily, 'dropbox'))
    await act(async () => Promise.resolve())
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(2)
  })

  it('does not auto-pull when another tab owns the lease', () => {
    coordinator.getTabSyncBlockReason.mockReturnValue(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )

    renderHook(() =>
      useAutoSync({
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
      useAutoSync({
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

  it('conditionally pushes instead of pulling on start when local edits are dirty', async () => {
    renderHook(() =>
      useAutoSync({ connected: true, targetName: '/inbox.md', localDirty: true }),
    )

    await waitFor(() => {
      expect(syncActions.pushToSyncAndRefresh).toHaveBeenCalledWith(false)
    })
    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
  })

  it('auto-pulls when local is clean', async () => {
    renderHook(() =>
      useAutoSync({ connected: true, targetName: '/inbox.md', localDirty: false }),
    )

    await waitFor(() => {
      expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledWith({ force: false })
    })
    expect(syncActions.pushToSyncAndRefresh).not.toHaveBeenCalled()
  })

  it('does neither while another tab owns the lease, even when dirty', () => {
    coordinator.getTabSyncBlockReason.mockReturnValue(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )

    renderHook(() =>
      useAutoSync({ connected: true, targetName: '/inbox.md', localDirty: true }),
    )

    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
    expect(syncActions.pushToSyncAndRefresh).not.toHaveBeenCalled()
  })

  it('conditionally pushes every three minutes while local edits remain dirty', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))

    renderHook(() =>
      useAutoSync({ connected: true, targetName: '/inbox.md', localDirty: true }),
    )

    await act(async () => Promise.resolve())
    expect(syncActions.pushToSyncAndRefresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 59_999)
    })
    expect(syncActions.pushToSyncAndRefresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(syncActions.pushToSyncAndRefresh).toHaveBeenCalledTimes(2)
    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
  })

  it('pulls every three minutes while local state is clean and visible', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))

    renderHook(() =>
      useAutoSync({ connected: true, targetName: '/inbox.md', localDirty: false }),
    )

    await act(async () => Promise.resolve())
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 59_999)
    })
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(2)
  })

  it('uses the latest dirty state at the next three-minute reconciliation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))

    const { rerender } = renderHook(
      ({ localDirty }) =>
        useAutoSync({ connected: true, targetName: '/inbox.md', localDirty }),
      { initialProps: { localDirty: false } },
    )

    await act(async () => Promise.resolve())
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)

    rerender({ localDirty: true })
    expect(syncActions.pushToSyncAndRefresh).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000)
    })

    expect(syncActions.pushToSyncAndRefresh).toHaveBeenCalledTimes(1)
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
  })

  it('retries a failed dirty push at the next three-minute reconciliation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
    syncActions.pushToSyncAndRefresh
      .mockRejectedValueOnce(new Error('Network failed.'))
      .mockResolvedValueOnce({ status: 'pushed' })

    renderHook(() =>
      useAutoSync({ connected: true, targetName: '/inbox.md', localDirty: true }),
    )

    await act(async () => Promise.resolve())
    expect(syncActions.recordSyncAttention).toHaveBeenCalledWith('push', 'Network failed.')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000)
    })

    expect(syncActions.pushToSyncAndRefresh).toHaveBeenCalledTimes(2)
  })

  it('refreshes on focus after 15 seconds backgrounded, bypassing the normal throttle', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))

    renderHook(() =>
      useAutoSync({ connected: true, targetName: '/inbox.md', localDirty: false }),
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
      useAutoSync({ connected: true, targetName: '/inbox.md', localDirty: false }),
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

  it('conditionally pushes on foreground return while dirty', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))

    renderHook(() =>
      useAutoSync({ connected: true, targetName: '/inbox.md', localDirty: true }),
    )

    await act(async () => Promise.resolve())
    act(() => window.dispatchEvent(new Event('blur')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    act(() => window.dispatchEvent(new Event('focus')))
    await act(async () => Promise.resolve())

    expect(syncActions.pushToSyncAndRefresh).toHaveBeenCalledTimes(2)
    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
  })

  it('conditionally pushes on reconnect while dirty', async () => {
    renderHook(() =>
      useAutoSync({ connected: true, targetName: '/inbox.md', localDirty: true }),
    )

    await act(async () => Promise.resolve())
    act(() => window.dispatchEvent(new Event('online')))
    await act(async () => Promise.resolve())

    expect(syncActions.pushToSyncAndRefresh).toHaveBeenCalledTimes(2)
    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
  })

  it('records attention when a lifecycle push is blocked', async () => {
    syncActions.pushToSyncAndRefresh.mockResolvedValue({
      status: 'blocked',
      reason: 'remote_changed',
    })

    renderHook(() =>
      useAutoSync({ connected: true, targetName: '/inbox.md', localDirty: true }),
    )

    await waitFor(() => {
      expect(syncActions.recordBlockedPush).toHaveBeenCalledWith('remote_changed')
    })
  })

  it('queues one reconciliation when another trigger arrives in flight', async () => {
    let resolveFirstPull: ((value: { status: 'noop' }) => void) | undefined
    syncActions.pullFromSyncAndRefresh
      .mockImplementationOnce(
        () =>
          new Promise<{ status: 'noop' }>((resolve) => {
            resolveFirstPull = resolve
          }),
      )
      .mockResolvedValue({ status: 'noop' })

    renderHook(() =>
      useAutoSync({ connected: true, targetName: '/inbox.md', localDirty: false }),
    )

    await waitFor(() => {
      expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
    })
    act(() => window.dispatchEvent(new Event('online')))
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirstPull?.({ status: 'noop' })
    })

    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(2)
  })
})
