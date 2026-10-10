import { describe, expect, it } from 'vitest'
import type { DaySearchResult } from '../../lib/dayRepository'
import { keepEditedDayInResults, keepInteractedTodoInResults } from './searchResults'

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


describe('keepInteractedTodoInResults', () => {
  const changed: DaySearchResult = {
    ...result('2026-10-10'),
    day: { ...result('2026-10-10').day, contentMd: '- [ ] other task\n- [-] buy milk' },
    matchedBlocks: ['- [ ] other task', '- [-] buy milk'],
  }
  const interacted = { dayId: changed.day.dayId, sourceLineIndex: 1 }

  it('keeps only the changed task when the day stops matching, in date order', () => {
    const next = [result('2026-10-11'), result('2026-10-09')]
    const kept = keepInteractedTodoInResults(next, [changed], interacted)
    expect(kept.map((entry) => entry.day.dayId)).toEqual(['2026-10-11', '2026-10-10', '2026-10-09'])
    expect(kept[1].matchedBlocks).toEqual(['- [-] buy milk'])
  })

  it('keeps the changed line alongside other matching tasks in the same day', () => {
    const next = [{ ...changed, matchedBlocks: ['- [ ] other task'] }]
    const kept = keepInteractedTodoInResults(next, [changed], interacted)
    expect(kept[0].matchedBlocks).toEqual(['- [ ] other task', '- [-] buy milk'])
    expect(kept[0].day.contentMd).toBe(changed.day.contentMd)
  })

  it('does not duplicate matches and stops retaining when the interaction is cleared', () => {
    expect(keepInteractedTodoInResults([changed], [changed], interacted)).toEqual([changed])
    const next: DaySearchResult[] = []
    expect(keepInteractedTodoInResults(next, [changed], null)).toBe(next)
  })
})
