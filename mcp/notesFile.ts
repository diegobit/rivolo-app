import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { formatDayTitle, isValidDayId } from '../src/lib/dates.js'
import { parseMarkdown } from '../src/lib/markdown.js'
import { sortDaysDescending, type Day, type DayFilterOptions } from '../src/lib/notesCore.js'

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

export const loadNotesPath = async (path: string, range: DayFilterOptions = {}): Promise<NotesFile> => {
  const root = resolve(path)
  const rootStats = await stat(root)
  if (!rootStats.isDirectory()) return loadNotesFile(root)

  const candidates = new Map<string, string>()
  const add = (name: string, directory: string, prefix = '') => {
    const id = name.slice(0, -3)
    if (!name.endsWith('.md') || !isValidDayId(id) || !id.startsWith(prefix) ||
        range.dateFrom && id < range.dateFrom || range.dateTo && id > range.dateTo) return
    if (candidates.has(id)) throw new Error(`More than one daily document was found for ${id}.`)
    candidates.set(id, join(directory, name))
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile()) add(entry.name, root)
    if (!entry.isDirectory() || !/^\d{4}$/.test(entry.name)) continue
    const year = join(root, entry.name)
    for (const child of await readdir(year, { withFileTypes: true })) {
      if (!child.isDirectory() || !/^(0[1-9]|1[0-2])$/.test(child.name)) continue
      const month = join(year, child.name)
      for (const file of await readdir(month, { withFileTypes: true })) {
        if (file.isFile()) add(file.name, month, `${entry.name}-${child.name}-`)
      }
    }
  }

  const days: Day[] = []
  const warnings: string[] = []
  let sizeBytes = 0
  let lastModified = rootStats.mtimeMs
  for (const [id, file] of candidates) {
    const snapshot = await loadNotesFile(file)
    sizeBytes += snapshot.source.sizeBytes
    lastModified = Math.max(lastModified, Date.parse(snapshot.source.modifiedAt))
    if (snapshot.warnings.length || snapshot.days.length !== 1 || snapshot.days[0].dayId !== id) {
      warnings.push(`${id}.md must contain exactly its own day.`)
      continue
    }
    days.push(snapshot.days[0])
  }
  return {
    source: { filePath: root, sizeBytes, modifiedAt: new Date(lastModified).toISOString() },
    warnings,
    days: sortDaysDescending(days),
  }
}
