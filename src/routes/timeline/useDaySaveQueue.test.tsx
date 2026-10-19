import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDaySaveQueue } from './useDaySaveQueue'

const draftRegistry = vi.hoisted(() => ({
  pending: new Map<string, { contentMd: string; generation: number }>(),
  committed: new Map<string, number>(),
  latest: new Map<string, number>(),
}))

vi.mock('../../lib/db', () => ({
  flushDatabaseSave: vi.fn().mockResolvedValue(undefined),
  getCommittedDayDraftGeneration: (dayId: string) => draftRegistry.committed.get(dayId) ?? 0,
  getPendingDayDraft: (dayId: string) => draftRegistry.pending.get(dayId) ?? null,
  invalidatePendingDayDraft: (dayId: string) => {
    const next = (draftRegistry.latest.get(dayId) ?? 0) + 1
    draftRegistry.latest.set(dayId, next)
    draftRegistry.pending.delete(dayId)
    return next
  },
  registerPendingDayDraft: (dayId: string, contentMd: string) => {
    const next = (draftRegistry.latest.get(dayId) ?? 0) + 1
    draftRegistry.latest.set(dayId, next)
    draftRegistry.pending.set(dayId, { contentMd, generation: next })
    return next
  },
  acknowledgePendingDayDraft: (dayId: string, generation: number) => {
    if (draftRegistry.pending.get(dayId)?.generation === generation) draftRegistry.pending.delete(dayId)
    draftRegistry.committed.set(dayId, Math.max(draftRegistry.committed.get(dayId) ?? 0, generation))
  },
}))
vi.mock('../../lib/dayRepository', () => ({ commitDayDraftInDatabase: vi.fn() }))
vi.mock('../../store/syncActions', () => ({ flushAutoPushToSync: vi.fn().mockResolvedValue(undefined) }))

describe('useDaySaveQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    draftRegistry.pending.clear()
    draftRegistry.committed.clear()
    draftRegistry.latest.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports a day as saved only after its content is written', async () => {
    let finishWrite: () => void = () => undefined
    const updateDayContent = vi.fn(
      (dayId: string, _content: string, generation?: number) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            if (generation !== undefined) {
              const current = draftRegistry.pending.get(dayId)
              if (current?.generation === generation) draftRegistry.pending.delete(dayId)
              draftRegistry.committed.set(dayId, generation)
            }
            resolve()
          }
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

    expect(updateDayContent).toHaveBeenCalledWith('2026-09-26', 'edited', expect.any(Number))
    expect(onDaySaved).not.toHaveBeenCalled()

    await act(async () => {
      finishWrite()
    })

    expect(onDaySaved).toHaveBeenCalledExactlyOnceWith('2026-09-26')
  })

  it('does not report a save that was made stale before it finished', async () => {
    let finishWrite: () => void = () => undefined
    const updateDayContent = vi.fn(
      (dayId: string, _content: string, generation?: number) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            if (generation !== undefined) {
              draftRegistry.committed.set(dayId, generation)
            }
            resolve()
          }
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
