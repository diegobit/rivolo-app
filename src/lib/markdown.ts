import { formatDayTitle } from './dates.js'
import type { Day } from './notesCore.js'

export type ParsedDay = {
  dayId: string
  humanTitle: string
  contentMd: string
}

export type ImportResult = {
  days: ParsedDay[]
  warnings: string[]
}

const DAY_MARKER = /^<!--[ \t]*day:(\d{4}-\d{2}-\d{2})[ \t]*-->[ \t]*\r?$/gm
const DAY_MARKER_LINE = /^<!--[ \t]*day:\d{4}-\d{2}-\d{2}[ \t]*-->[ \t]*\r?$/

// Exported content lines that could be mistaken for structure are prefixed with
// this token. Prefix-prefixed content is escaped too, so removing exactly one
// token during import is reversible across repeated export/import cycles.
const CONTENT_ESCAPE_PREFIX = '<!-- rivolo:escaped-content -->'

const encodeContent = (content: string) =>
  content
    .split('\n')
    .map((line) =>
      line.startsWith(CONTENT_ESCAPE_PREFIX) || DAY_MARKER_LINE.test(line)
        ? `${CONTENT_ESCAPE_PREFIX}${line}`
        : line,
    )
    .join('\n')

const decodeContent = (content: string) =>
  content
    .split('\n')
    .map((line) =>
      line.startsWith(CONTENT_ESCAPE_PREFIX)
        ? line.slice(CONTENT_ESCAPE_PREFIX.length)
        : line,
    )
    .join('\n')

export const parseMarkdown = (source: string): ImportResult => {
  const warnings: string[] = []
  const dayMap = new Map<string, ParsedDay>()
  const matches = [...source.matchAll(DAY_MARKER)]

  if (matches.length === 0) {
    return { days: [], warnings: ['No day markers found.'] }
  }

  matches.forEach((match, index) => {
    const dayId = match[1]
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? source.length
    const block = source.slice(start, end).replace(/^\n+/, '')
    const lines = block.split('\n')

    const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0)
    let humanTitle = formatDayTitle(dayId)
    let contentStart = 0

    if (firstNonEmptyIndex !== -1) {
      humanTitle = lines[firstNonEmptyIndex].trim()
      contentStart = firstNonEmptyIndex + 1

      if (lines[contentStart]?.trim().match(/^[-_]{3,}$/)) {
        contentStart += 1
      }

      if (lines[contentStart]?.trim() === '') {
        contentStart += 1
      }
    }

    const contentMd = decodeContent(lines.slice(contentStart).join('\n').trimEnd())

    if (dayMap.has(dayId)) {
      warnings.push(`Duplicate day marker for ${dayId}; using last block.`)
    }

    dayMap.set(dayId, { dayId, humanTitle, contentMd })
  })

  return { days: [...dayMap.values()], warnings }
}

export const exportMarkdown = (days: Day[]) => {
  const sorted = [...days].sort((a, b) => b.dayId.localeCompare(a.dayId))

  return sorted
    .map((day) => {
      const title = day.humanTitle || formatDayTitle(day.dayId)
      const underline = '-'.repeat(Math.max(3, title.length))
      const content = encodeContent(day.contentMd.trimEnd())
      return [
        `<!-- day:${day.dayId} -->`,
        title,
        underline,
        '',
        content,
      ]
        .filter((line, index, array) => !(index === array.length - 1 && line === ''))
        .join('\n')
    })
    .join('\n\n')
    .trimEnd()
}
