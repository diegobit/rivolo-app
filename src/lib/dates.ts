const pad = (value: number) => value.toString().padStart(2, '0')

const DAY_ID_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

// Day IDs represent calendar dates. Use UTC to format their components so
// cached formatters stay correct if the device changes time zone.
const dayTitleFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: '2-digit',
  year: 'numeric',
})
const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' })
const dayOfMonthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', day: 'numeric' })
const shortMonthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' })

export const isValidDayId = (value: string) => {
  const match = value.match(DAY_ID_PATTERN)
  if (!match) {
    return false
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  return (
    date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
  )
}

export const getDayIdFromDate = (date: Date) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const getTodayId = () => getDayIdFromDate(new Date())

export const parseDayId = (dayId: string) => {
  const [year, month, day] = dayId.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const parseCalendarDay = (dayId: string) => new Date(`${dayId}T00:00:00Z`)

export const formatDayTitle = (dayId: string) => dayTitleFormatter.format(parseCalendarDay(dayId))

export const formatHumanDate = (
  dayId: string,
  referenceDayId = getTodayId(),
  options: { includeRelativeLabel?: boolean; includeWeekday?: boolean } = {},
) => {
  const date = parseCalendarDay(dayId)
  const reference = parseCalendarDay(referenceDayId)
  const weekday = weekdayFormatter.format(date)
  const day = dayOfMonthFormatter.format(date)
  const month = shortMonthFormatter.format(date)
  const year = date.getUTCFullYear()
  const includeRelativeLabel = options.includeRelativeLabel ?? true
  const includeWeekday = options.includeWeekday ?? true
  const weekdaySuffix = includeWeekday ? `, ${weekday}` : ''

  if (dayId === referenceDayId) {
    return includeRelativeLabel ? `Today • ${day}${weekdaySuffix}` : `${day}${weekdaySuffix}`
  }

  if (dayId === addDays(referenceDayId, -1)) {
    return includeRelativeLabel ? `Yesterday • ${day}${weekdaySuffix}` : `${day}${weekdaySuffix}`
  }

  if (dayId === addDays(referenceDayId, 1)) {
    return includeRelativeLabel ? `Tomorrow • ${day}${weekdaySuffix}` : `${day}${weekdaySuffix}`
  }

  if (year === reference.getUTCFullYear()) {
    return `${day} ${month}${weekdaySuffix}`
  }

  return `${day} ${month} ${year}${weekdaySuffix}`
}

export const addDays = (dayId: string, days: number) => {
  const date = parseDayId(dayId)
  date.setDate(date.getDate() + days)
  return getDayIdFromDate(date)
}

// A compact "how long ago" label for small status text, e.g. "5m ago".
export const formatTimeAgo = (timestamp: number, now = Date.now()) => {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
