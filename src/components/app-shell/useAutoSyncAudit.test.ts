// Regression test from the AIT fork's daily sync audit (2026-11-12): scheduling while typing.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoSync } from './useAutoSync'
import { registerPendingEditorSaves } from '../../lib/pendingEditorSaves'

const provider = vi.hoisted(() => ({ getActiveProviderStatus: vi.fn() }))
const actions = vi.hoisted(() => ({ blockedPushMessage: vi.fn(), pullFromSyncAndRefresh: vi.fn(), pushToSyncAndRefresh: vi.fn(), recordSyncAttention: vi.fn() }))
vi.mock('../../lib/sync', () => provider)
vi.mock('../../lib/tabSyncCoordinator', () => ({ getTabSyncBlockReason: () => null }))
vi.mock('../../store/syncActions', () => actions)

const status = { connected: true, targetName: '/inbox.rivolo-daily', notebookChannel: 'id:daily-folder', localDirty: false, daily: true }
const start = async () => {
  const hook = renderHook(() => useAutoSync(status, 'dropbox'))
  await act(async () => Promise.resolve())
  return { hook }
}

describe('daily auto-sync audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    provider.getActiveProviderStatus.mockResolvedValue({ localDirty: false })
    actions.pullFromSyncAndRefresh.mockResolvedValue({ status: 'noop' })
    actions.pushToSyncAndRefresh.mockResolvedValue({ status: 'clean' })
  })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

  it('does not check the cloud every second while the user keeps typing', async () => {
    const unregister = registerPendingEditorSaves(() => ['2026-10-01'])
    const { hook } = await start()
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      // Measured: 31 pulls in 30 seconds, each a full folder listing here
      // because no day was reported as deferred.
      expect(actions.pullFromSyncAndRefresh.mock.calls.length).toBeLessThanOrEqual(5)
    } finally { unregister(); hook.unmount() }
  })
})
