import { listDays } from './dayRepository'
import type { Day } from './dayRepository'

export const buildContextDays = async (query: string) => {
  void query
  const allDays = await listDays(10000) // Get all days
  return allDays
}

export const formatContext = (days: Day[]) => {
  return days
    .map((day) => {
      const content = day.contentMd.trim() || '(empty)'
      return `<!-- day:${day.dayId} -->\n${day.humanTitle}\n${'-'.repeat(Math.max(3, day.humanTitle.length))}\n\n${content}`
    })
    .join('\n\n')
}
