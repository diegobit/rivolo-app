import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDatabaseLifecycle } from './useDatabaseLifecycle'
import { checkpointDatabaseSynchronously } from '../lib/db'

const lifecycle = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('../lib/db', () => ({
  checkpointDatabaseSynchronously: vi.fn(() => {
    lifecycle.calls.push('checkpoint')
    return true
  }),
  flushDatabaseSave: vi.fn(async () => undefined),
  warmDatabaseForVisiblePage: vi.fn(async () => {
    lifecycle.calls.push('warm')
    return {}
  }),
}))

vi.mock('../lib/tabSyncCoordinator', () => ({
  claimPrimaryTabForSync: vi.fn(() => {
    lifecycle.calls.push('claim')
    return null
  }),
  releasePrimaryTabForPageHide: vi.fn(() => {
    lifecycle.calls.push('release')
  }),
}))

describe('app database lifecycle', () => {
  beforeEach(() => {
    lifecycle.calls.length = 0
  })

  it('submits the synchronous checkpoint before releasing the pagehide lease', async () => {
    renderHook(() => useDatabaseLifecycle())
    await waitFor(() => expect(lifecycle.calls).toContain('warm'))
    lifecycle.calls.length = 0

    act(() => window.dispatchEvent(new Event('pagehide')))
    act(() => window.dispatchEvent(new Event('pagehide')))

    expect(lifecycle.calls).toEqual(['checkpoint', 'release', 'checkpoint', 'release'])
  })

  it('releases the sync lease if the synchronous checkpoint throws', async () => {
    renderHook(() => useDatabaseLifecycle())
    await waitFor(() => expect(lifecycle.calls).toContain('warm'))
    lifecycle.calls.length = 0
    vi.mocked(checkpointDatabaseSynchronously).mockImplementationOnce(() => {
      lifecycle.calls.push('checkpoint')
      throw new Error('database became stale')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    act(() => window.dispatchEvent(new Event('pagehide')))

    expect(lifecycle.calls).toEqual(['checkpoint', 'release'])
    expect(consoleError).toHaveBeenCalledWith(
      '[DB] lifecycle pagehide checkpoint failed',
      expect.objectContaining({ error: expect.any(Error) }),
    )
    consoleError.mockRestore()
  })

  it('warms storage before reclaiming sync leadership after pageshow', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    renderHook(() => useDatabaseLifecycle())
    await waitFor(() => expect(lifecycle.calls).toContain('warm'))
    lifecycle.calls.length = 0

    act(() => window.dispatchEvent(new Event('pageshow')))
    await waitFor(() => expect(lifecycle.calls).toContain('claim'))

    expect(lifecycle.calls).toEqual(['warm', 'claim'])
  })
})
