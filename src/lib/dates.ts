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

export const addDays = (dayId: string, days: number) => {
  const date = parseDayId(dayId)
  date.setDate(date.getDate() + days)
  return getDayIdFromDate(date)
}
