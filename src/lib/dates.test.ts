import { describe, expect, it } from 'vitest'
import { formatDayTitle, isValidDayId } from './dates'

describe('day IDs', () => {
  it.each([
    '2026-02-30',
    '2026-00-10',
    '2026-13-10',
    '2026-99-10',
    '2026-01-00',
    '2027-02-29',
    '26-01-01',
  ])('rejects invalid calendar day ID %s', (dayId) => {
    expect(isValidDayId(dayId)).toBe(false)
  })

  it.each([
    ['2026-01-01', 'Jan 01, 2026'],
    ['2026-12-31', 'Dec 31, 2026'],
    ['2028-02-29', 'Feb 29, 2028'],
  ])('accepts and formats calendar day ID %s', (dayId, title) => {
    expect(isValidDayId(dayId)).toBe(true)
    expect(formatDayTitle(dayId)).toBe(title)
  })
})
