import { describe, expect, it, vi } from 'vitest'
import { formatDayTitle, formatHumanDate, formatTimeAgo, isValidDayId } from './dates'

describe('day IDs', () => {
  it('keeps calendar dates stable and uses the new local zone for timestamps after a zone change', () => {
    const day = '2026-07-14'
    const timestamp = Date.UTC(2026, 6, 14, 2)
    const later = timestamp + 8 * 24 * 60 * 60_000

    try {
      vi.stubEnv('TZ', 'America/Los_Angeles')
      expect(formatDayTitle(day)).toBe('Jul 14, 2026')
      expect(formatHumanDate(day, day)).toBe('Today • 14, Tuesday')
      expect(formatTimeAgo(timestamp, later)).toBe('Jul 13')

      vi.stubEnv('TZ', 'Asia/Tokyo')
      expect(formatDayTitle(day)).toBe('Jul 14, 2026')
      expect(formatHumanDate(day, day)).toBe('Today • 14, Tuesday')
      expect(formatTimeAgo(timestamp, later)).toBe('Jul 14')
    } finally {
      vi.unstubAllEnvs()
    }
  })

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

describe('formatHumanDate', () => {
  const today = '2026-04-05'

  it.each([
    ['2026-04-05', 'Today • 5, Sunday'],
    ['2026-04-04', 'Yesterday • 4, Saturday'],
    ['2026-04-06', 'Tomorrow • 6, Monday'],
    ['2026-03-20', '20 Mar, Friday'],
    ['2025-12-31', '31 Dec 2025, Wednesday'],
  ])('labels %s relative to today', (dayId, label) => {
    expect(formatHumanDate(dayId, today)).toBe(label)
  })

  it('drops the relative label and the weekday when asked', () => {
    const options = { includeRelativeLabel: false, includeWeekday: false }
    expect(formatHumanDate('2026-04-05', today, options)).toBe('5')
    expect(formatHumanDate('2026-03-20', today, options)).toBe('20 Mar')
  })
})
