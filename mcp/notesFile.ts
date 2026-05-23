import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { formatDayTitle } from '../src/lib/dates.js'
import { parseMarkdown } from '../src/lib/markdown.js'
import { sortDaysDescending, type Day } from '../src/lib/notesCore.js'

export type NotesFileSource = {
  filePath: string
  sizeBytes: number
  modifiedAt: string
}

export type NotesFile = {
  source: NotesFileSource
  warnings: string[]
  days: Day[]
}

export const loadNotesFile = async (filePath: string): Promise<NotesFile> => {
  const resolvedPath = resolve(filePath)
  const [fileStats, source] = await Promise.all([stat(resolvedPath), readFile(resolvedPath, 'utf8')])
  const parsed = parseMarkdown(source)
  const timestamp = fileStats.mtimeMs

  const days = parsed.days.map((day) => ({
    dayId: day.dayId,
    humanTitle: day.humanTitle || formatDayTitle(day.dayId),
    contentMd: day.contentMd,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))

  return {
    source: {
      filePath: resolvedPath,
      sizeBytes: fileStats.size,
      modifiedAt: fileStats.mtime.toISOString(),
    },
    warnings: parsed.warnings,
    days: sortDaysDescending(days),
  }
}
