import { ensureDay, listDays, searchDays } from './dayRepository'
import { getTodayId } from './dates'
import type { Day } from './dayRepository'

export const buildContextDays = async (query: string, limit = 6) => {
  const todayId = getTodayId()
  const today = await ensureDay(todayId)
  const recent = await listDays(3)
  const searchResults = query.trim() ? await searchDays(query, {}, limit) : []

  const map = new Map<string, Day>()
  ;[today, ...recent, ...searchResults].forEach((day) => {
    map.set(day.dayId, day)
  })

  return [...map.values()].slice(0, limit + 3)
}

export const formatContext = (days: Day[]) => {
  return days
    .map((day) => {
      const content = day.contentMd.trim() || '(empty)'
      return `<!-- day:${day.dayId} -->\n${day.humanTitle}\n${'-'.repeat(Math.max(3, day.humanTitle.length))}\n\n${content}`
    })
    .join('\n\n')
}
