import { exportMarkdown, parseMarkdown } from './markdown'
import { clearDays, listDays, saveDay } from './dayRepository'
import { formatDayTitle } from './dates'

export const importMarkdownToDb = async (
  source: string,
  options: { replace?: boolean } = {},
) => {
  const { days, warnings } = parseMarkdown(source)

  if (options.replace) {
    await clearDays()
  }

  for (const day of days) {
    const title = day.humanTitle || formatDayTitle(day.dayId)
    await saveDay(day.dayId, day.contentMd, title)
  }

  return { imported: days.length, warnings }
}

export const exportMarkdownFromDb = async () => {
  const days = await listDays(10000)
  return exportMarkdown(days)
}
