const pad = (value: number) => value.toString().padStart(2, '0')

export const getDayIdFromDate = (date: Date) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const getTodayId = () => getDayIdFromDate(new Date())

export const parseDayId = (dayId: string) => {
  const [year, month, day] = dayId.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export const formatDayTitle = (dayId: string) => {
  const date = parseDayId(dayId)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(date)
}

export const formatHumanDate = (
  dayId: string,
  referenceDayId = getTodayId(),
  options: { includeRelativeLabel?: boolean; includeWeekday?: boolean } = {},
) => {
  const date = parseDayId(dayId)
  const reference = parseDayId(referenceDayId)
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date)
  const day = new Intl.DateTimeFormat('en-US', { day: 'numeric' }).format(date)
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date)
  const year = date.getFullYear()
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

  if (year === reference.getFullYear()) {
    return `${day} ${month}${weekdaySuffix}`
  }

  return `${day} ${month} ${year}${weekdaySuffix}`
}

export const addDays = (dayId: string, days: number) => {
  const date = parseDayId(dayId)
  date.setDate(date.getDate() + days)
  return getDayIdFromDate(date)
}
