import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Day } from '../lib/notesCore'
import { useDaysStore } from './useDaysStore'

const mocks = vi.hoisted(() => ({
  appendLineToDay: vi.fn(),
  deleteDay: vi.fn(),
  ensureDay: vi.fn(),
  getDay: vi.fn(),
  hasDaysBefore: vi.fn(),
  listDaysBefore: vi.fn(),
  listDaysSince: vi.fn(),
  moveDay: vi.fn(),
  saveDay: vi.fn(),
}))

vi.mock('../lib/dayRepository', () => mocks)

const existingDay: Day = {
  dayId: '2026-03-01',
  humanTitle: 'Mar 01, 2026',
  contentMd: 'content',
  createdAt: 1,
  updatedAt: 1,
}

describe('useDaysStore date moves', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDaysStore.setState({ days: [existingDay], activeDay: existingDay })
  })

  it('rejects an invalid target before persistence or state mutation', async () => {
    const result = await useDaysStore.getState().moveDayDate('2026-03-01', '2026-02-30')

    expect(result).toEqual({ conflict: false, error: 'Choose a valid calendar date.' })
    expect(mocks.moveDay).not.toHaveBeenCalled()
    expect(useDaysStore.getState().days).toEqual([existingDay])
    expect(useDaysStore.getState().activeDay).toEqual(existingDay)
  })
})

describe('useDaysStore loadTimeline error state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDaysStore.setState({ days: [], activeDay: null, loaded: false, loading: false, loadError: null })
  })

  it('records a load error instead of silently reporting an empty timeline', async () => {
    mocks.listDaysSince.mockRejectedValueOnce(new Error('database is corrupt'))

    await useDaysStore.getState().loadTimeline()

    const state = useDaysStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.loading).toBe(false)
    expect(state.days).toEqual([])
    expect(state.loadError).toBe('database is corrupt')
  })

  it('clears a previous load error once a retry succeeds', async () => {
    useDaysStore.setState({ loadError: 'database is corrupt' })
    mocks.listDaysSince.mockResolvedValueOnce([existingDay])
    mocks.listDaysBefore.mockResolvedValueOnce([])
    mocks.hasDaysBefore.mockResolvedValueOnce(false)

    await useDaysStore.getState().loadTimeline()

    const state = useDaysStore.getState()
    expect(state.loadError).toBeNull()
    expect(state.days).toEqual([existingDay])
  })
})
