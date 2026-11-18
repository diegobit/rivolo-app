import { exportMarkdown, parseMarkdown, type ParsedDay } from './markdown'
import { isValidDayId } from './dates'
import { readNotebookAttribution, writeNotebookAttribution } from './oneDriveBlame'

export type DailyRemoteFile = { ref: string; revision: string }

export const dayPath = (dayId: string) => {
  if (!isValidDayId(dayId)) throw new Error(`Invalid day ID: ${dayId}`)
  return `${dayId.slice(0, 4)}/${dayId.slice(5, 7)}/${dayId}.md`
}

export const encodeNotebookDay = (day: ParsedDay) => {
  dayPath(day.dayId)
  return exportMarkdown([{ ...day, createdAt: 0, updatedAt: 0 }])
}

export const decodeNotebookDay = (source: string, dayId: string) => {
  dayPath(dayId)
  const parsed = parseMarkdown(source)
  if (parsed.warnings.length || parsed.days.length !== 1 || parsed.days[0].dayId !== dayId) {
    throw new Error(`Day ${dayId}: the file must contain exactly its own valid day marker.`)
  }
  return parsed.days[0]
}

export const splitNotebookDays = async (source: string) => {
  const parsed = parseMarkdown(source)
  if (parsed.warnings.length || !parsed.days.length) throw new Error('Daily sync migration needs a notebook with valid, unique day markers.')
  const authors = await readNotebookAttribution(source)
  const result = new Map<string, string>()
  for (const day of parsed.days) {
    result.set(day.dayId, await writeNotebookAttribution(encodeNotebookDay(day), new Map([[day.dayId, authors.get(day.dayId) ?? []]])))
  }
  return result
}
