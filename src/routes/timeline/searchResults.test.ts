import { describe, expect, it } from 'vitest'
import type { DaySearchResult } from '../../lib/dayRepository'
import { keepEditedDayInResults } from './searchResults'

const result = (dayId: string): DaySearchResult => ({
  day: { dayId, humanTitle: '', contentMd: dayId, createdAt: 0, updatedAt: 0 },
  matchedBlocks: [dayId],
  blockKind: 'line',
})

describe('keepEditedDayInResults', () => {
  const previous = [result('2026-09-26'), result('2026-09-20'), result('2026-09-10')]

  it('keeps the day being edited, in date order, when the refresh drops it', () => {
    const next = [result('2026-09-26'), result('2026-09-10')]

    expect(keepEditedDayInResults(next, previous, '2026-09-20').map((r) => r.day.dayId)).toEqual([
      '2026-09-26',
      '2026-09-20',
      '2026-09-10',
    ])
  })

  it('appends it when it is older than every remaining result', () => {
    const next = [result('2026-09-26')]

    expect(keepEditedDayInResults(next, previous, '2026-09-10').map((r) => r.day.dayId)).toEqual([
      '2026-09-26',
      '2026-09-10',
    ])
  })

  it('leaves the refresh alone when nothing is being edited or the day still matches', () => {
    const next = [result('2026-09-26')]

    expect(keepEditedDayInResults(next, previous, null)).toBe(next)
    expect(keepEditedDayInResults(next, previous, '2026-09-26')).toBe(next)
  })
})
