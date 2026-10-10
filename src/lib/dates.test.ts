import { describe, expect, it } from 'vitest'
import { formatDayTitle, formatTimeAgo, isValidDayId } from './dates'

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

describe('formatTimeAgo', () => {
  const now = new Date(2026, 9, 10, 12, 0).getTime()

  it.each([
    [now - 20_000, 'Just now'],
    [now + 5_000, 'Just now'],
    [now - 5 * 60_000, '5m ago'],
    [now - 3 * 60 * 60_000, '3h ago'],
    [now - 2 * 24 * 60 * 60_000, '2d ago'],
    [new Date(2026, 8, 12, 9, 0).getTime(), 'Sep 12'],
  ])('formats %d', (timestamp, label) => {
    expect(formatTimeAgo(timestamp, now)).toBe(label)
  })
})
