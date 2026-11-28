import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDaySaveQueue } from './useDaySaveQueue'
import { getEditorRevision, getPendingEditorDayIds } from '../../lib/pendingEditorSaves'
import { acknowledgePendingDayDraft } from '../../lib/db'

// Keep the real draft registry; only the IndexedDB snapshot is stubbed.
vi.mock('../../lib/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/db')>(),
  flushDatabaseSave: vi.fn(),
}))
vi.mock('../../store/syncActions', () => ({ flushAutoPushToSync: vi.fn() }))

afterEach(() => { vi.useRealTimers() })

describe('editor drafts during daily sync', () => {
  it('protects a draft through debounce and persistence, then releases it for sync', async () => {
    vi.useFakeTimers()
    let finishSave!: () => void
    // Like saveDay, acknowledge the draft generation once it is written.
    const updateDayContent = vi.fn((dayId: string, _content: string, generation?: number) => new Promise<boolean>((resolve) => {
      finishSave = () => {
        acknowledgePendingDayDraft(dayId, generation!)
        resolve(true)
      }
    }))
    const { result, unmount } = renderHook(() => useDaySaveQueue({
      canSync: true, updateDayContent, onAutoPush: vi.fn(),
    }))
    const before = getEditorRevision()
    act(() => result.current.scheduleSave('2026-09-30', 'Typing'))
    expect(getEditorRevision()).toBeGreaterThan(before)
    expect(getPendingEditorDayIds().has('2026-09-30')).toBe(true)
    expect(updateDayContent).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(updateDayContent).toHaveBeenCalledWith('2026-09-30', 'Typing', expect.any(Number))
    expect(getPendingEditorDayIds().has('2026-09-30')).toBe(true)
    await act(async () => { finishSave() })
    expect(getPendingEditorDayIds().size).toBe(0)
    unmount()
  })
})
