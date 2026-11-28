import { formatDayTitle, isValidDayId } from './dates.js'
import type { Day } from './notesCore.js'
import { isAuthorsMetadataLine, notebookText } from './notebookMetadata.js'

export type ParsedDay = {
  dayId: string
  humanTitle: string
  contentMd: string
}

export type ImportResult = {
  days: ParsedDay[]
  warnings: string[]
}

// Lines end only at \n. With the m flag, ^ and $ would also match around the
// Unicode line and paragraph separators U+2028 and U+2029, which content can
// hold, so a marker hidden behind one would split the day.
// A match may include the \n before the marker; markerStart skips it.
const DAY_MARKER = /(?:^|\n)<!--[ \t]*day:(\d{4}-\d{2}-\d{2})[ \t]*-->[ \t]*\r?(?=\n|$)/g
const markerStart = (match: RegExpMatchArray) => (match.index ?? 0) + (match[0].startsWith('\n') ? 1 : 0)
const DAY_MARKER_LINE = /^<!--[ \t]*day:\d{4}-\d{2}-\d{2}[ \t]*-->[ \t]*\r?$/

// Exported content lines that could be mistaken for structure are prefixed with
// this token. Prefix-prefixed content is escaped too, so removing exactly one
// token during import is reversible across repeated export/import cycles.
const CONTENT_ESCAPE_PREFIX = '<!-- rivolo:escaped-content -->'

const encodeContent = (content: string) =>
  content
    .split('\n')
    .map((line) =>
      line.startsWith(CONTENT_ESCAPE_PREFIX) || DAY_MARKER_LINE.test(line) || isAuthorsMetadataLine(line)
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
  source = notebookText(source)
  const warnings: string[] = []
  const dayMap = new Map<string, ParsedDay>()
  const matches = [...source.matchAll(DAY_MARKER)]

  if (matches.length === 0) {
    return { days: [], warnings: ['No day markers found.'] }
  }

  const firstMarkerIndex = markerStart(matches[0])
  if (source.slice(0, firstMarkerIndex).trim()) {
    warnings.push('Content before the first day marker is ignored.')
  }

  matches.forEach((match, index) => {
    const dayId = match[1]
    if (!isValidDayId(dayId)) {
      warnings.push(`Invalid day marker for ${dayId}; skipping block.`)
      return
    }

    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1] ? markerStart(matches[index + 1]) : source.length
    // Only the two newlines between day blocks belong to the notebook format.
    // Other whitespace belongs to the draft, including an empty last paragraph.
    const rawBlock = source.slice(start, end)
    const block = (index + 1 < matches.length ? rawBlock.replace(/(?:\r?\n){2}$/, '') : rawBlock)
      .replace(/^\n+/, '')
    const lines = block.split('\n')

    const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0)
    let humanTitle = formatDayTitle(dayId)
    let contentStart = 0

    if (firstNonEmptyIndex !== -1 && !lines[firstNonEmptyIndex].trim().match(/^[-_]{3,}$/)) {
      humanTitle = lines[firstNonEmptyIndex].trim()
      contentStart = firstNonEmptyIndex + 1

      if (lines[contentStart]?.trim().match(/^[-_]{3,}$/)) {
        contentStart += 1
      }

      if (lines[contentStart]?.trim() === '') {
        contentStart += 1
      }
    }

    const contentMd = decodeContent(lines.slice(contentStart).join('\n'))

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
      const content = encodeContent(day.contentMd)
      return [
        `<!-- day:${day.dayId} -->`,
        title,
        underline,
        '',
        content,
      ]
        .join('\n')
    })
    .join('\n\n')
}
