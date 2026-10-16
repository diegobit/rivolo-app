import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDaySaveQueue } from './useDaySaveQueue'

vi.mock('../../lib/db', () => ({ flushDatabaseSave: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../store/syncActions', () => ({ flushAutoPushToSync: vi.fn().mockResolvedValue(undefined) }))

describe('useDaySaveQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports a day as saved only after its content is written', async () => {
    let finishWrite: () => void = () => undefined
    const updateDayContent = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        }),
    )
    const onDaySaved = vi.fn()
    const { result } = renderHook(() =>
      useDaySaveQueue({ canSync: false, updateDayContent, onAutoPush: vi.fn(), onDaySaved }),
    )

    act(() => {
      result.current.scheduleSave('2026-09-26', 'edited')
    })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(updateDayContent).toHaveBeenCalledWith('2026-09-26', 'edited')
    expect(onDaySaved).not.toHaveBeenCalled()

    await act(async () => {
      finishWrite()
    })

    expect(onDaySaved).toHaveBeenCalledExactlyOnceWith('2026-09-26')
  })

  it('does not report a save that was made stale before it finished', async () => {
    let finishWrite: () => void = () => undefined
    const updateDayContent = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        }),
    )
    const onDaySaved = vi.fn()
    const { result } = renderHook(() =>
      useDaySaveQueue({ canSync: false, updateDayContent, onAutoPush: vi.fn(), onDaySaved }),
    )

    act(() => {
      result.current.scheduleSave('2026-09-26', 'edited')
    })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    act(() => {
      result.current.markDaySavesStale('2026-09-26')
    })
    await act(async () => {
      finishWrite()
    })

    expect(onDaySaved).not.toHaveBeenCalled()
  })
})
