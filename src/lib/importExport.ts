import { exportMarkdown, parseMarkdown } from './markdown'
import { listDays, replaceDays, saveDay } from './dayRepository'
import { runBulkDatabaseMutation } from './db'
import { formatDayTitle } from './dates'

export const importMarkdownToDb = async (
  source: string,
  options: { replace?: boolean; markDirty?: boolean } = {},
) => {
  const { days, warnings } = parseMarkdown(source)
  const markDirty = options.markDirty ?? true
  const hasNoMarkersWarning = warnings.some((warning) =>
    warning.toLowerCase().includes('no day markers'),
  )

  if (options.replace && days.length === 0 && hasNoMarkersWarning) {
    return { imported: 0, warnings }
  }

  const normalizedDays = days.map((day) => ({
    ...day,
    humanTitle: day.humanTitle || formatDayTitle(day.dayId),
  }))

  if (options.replace) {
    await runBulkDatabaseMutation(async () => {
      await replaceDays(normalizedDays, { markDirty })
    })

    return { imported: days.length, warnings }
  }

  await runBulkDatabaseMutation(async () => {
    for (const day of normalizedDays) {
      await saveDay(day.dayId, day.contentMd, day.humanTitle, { markDirty })
    }
  })

  return { imported: days.length, warnings }
}

export const exportMarkdownFromDb = async () => {
  const days = await listDays(10000)
  return exportMarkdown(days)
}
