import { exportMarkdown, parseMarkdown, type ParsedDay } from './markdown'
import { isValidDayId } from './dates'

export type DailyRemoteFile = { ref: string; revision: string; modifiedAt?: string }

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
  return new Map(parsed.days.map((day) => [day.dayId, encodeNotebookDay(day)]))
}

export const decodeCutoverRecord = (value: unknown): Map<string, string | null> => {
  // Earlier preview builds saved just the day IDs.
  if (Array.isArray(value) && value.every(isValidDayId)) {
    return new Map(value.map((id) => [id, null]))
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid daily notebook cutover record.')
  const result = new Map<string, string | null>()
  for (const [id, document] of Object.entries(value)) {
    if (typeof document !== 'string') throw new Error('Invalid daily notebook cutover document.')
    decodeNotebookDay(document, id)
    result.set(id, document)
  }
  return result
}
