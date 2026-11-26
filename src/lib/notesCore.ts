import { createNoteTokenRegex, normalizeNoteToken } from './noteTokens.js'

export type Day = {
  dayId: string
  humanTitle: string
  contentMd: string
  createdAt: number
  updatedAt: number
}

export type SearchFilter = 'open-todos' | 'tags' | 'mentions' | 'headings'

export type DaySearchResult = {
  day: Day
  matchedBlocks: string[]
  blockKind: 'line' | 'section'
  // Supplied by author searches so identical text on another author's line
  // never takes the place of the selected occurrence.
  sourceLineIndexes?: number[]
}

export type DayFilterOptions = {
  dateFrom?: string
  dateTo?: string
  beforeDayId?: string
  includeEmpty?: boolean
}

export type TodoItem = {
  dayId: string
  humanTitle: string
  lineNumber: number
  text: string
}

export type TokenSummary = {
  token: string
  count: number
  days: string[]
}

const TODO_LINE_REGEX = /^\s*-\s+\[ \]/
const TAG_REGEX = createNoteTokenRegex('#')
const MENTION_REGEX = createNoteTokenRegex('@')
const TAG_TOKEN_REGEX = createNoteTokenRegex('#')
const MENTION_TOKEN_REGEX = createNoteTokenRegex('@')
const HEADING_REGEX = /^\s{0,3}(#{1,6})\s+/

const includesText = (value: string, query: string) => value.toLocaleLowerCase().includes(query)

const hasMatchingToken = (line: string, regex: RegExp, query: string) => {
  regex.lastIndex = 0
  const matches = line.match(regex)
  if (!matches?.length) {
    return false
  }

  if (!query) {
    return true
  }

  return matches.some((token) => token.toLocaleLowerCase().includes(query))
}

const getSectionEndIndex = (lines: string[], headingStart: number, headingLevel: number) => {
  for (let index = headingStart + 1; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(HEADING_REGEX)
    if (headingMatch && headingMatch[1].length <= headingLevel) {
      return index
    }
  }

  return lines.length
}

const collectHeadingSections = (lines: string[], normalizedQuery: string) => {
  const sections: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(HEADING_REGEX)
    if (!headingMatch) {
      continue
    }

    const headingLine = lines[index].trimEnd()
    if (normalizedQuery && !includesText(headingLine, normalizedQuery)) {
      continue
    }

    const headingLevel = headingMatch[1].length
    const sectionEnd = getSectionEndIndex(lines, index, headingLevel)
    const sectionText = lines
      .slice(index, sectionEnd)
      .map((line) => line.trimEnd())
      .join('\n')
      .trimEnd()

    if (sectionText.trim()) {
      sections.push(sectionText)
    }
  }

  return sections
}

type AuthorSearch = {
  name: string
  byDay: ReadonlyMap<string, ReadonlyArray<string | null>>
}

const getMatchedBlocks = (day: Day, query: string, filter: SearchFilter | null, author?: AuthorSearch) => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const lines = day.contentMd.split('\n')
  const matches: string[] = []
  const sourceLineIndexes: number[] = []
  const authors = author?.byDay.get(day.dayId)

  if (filter === 'headings' && !author) {
    return {
      blockKind: 'section' as const,
      matchedBlocks: collectHeadingSections(lines, normalizedQuery),
    }
  }

  for (const [index, rawLine] of lines.entries()) {
    if (author && authors?.[index] !== author.name) continue
    const line = rawLine.trimEnd()
    if (!line.trim()) {
      continue
    }

    let isMatch = false

    if (filter === 'headings') {
      isMatch = HEADING_REGEX.test(line) && (!normalizedQuery || includesText(line, normalizedQuery))
    } else if (filter === 'open-todos') {
      isMatch = TODO_LINE_REGEX.test(line) && (!normalizedQuery || includesText(line, normalizedQuery))
    } else if (filter === 'tags') {
      isMatch = hasMatchingToken(line, TAG_REGEX, normalizedQuery)
    } else if (filter === 'mentions') {
      isMatch = hasMatchingToken(line, MENTION_REGEX, normalizedQuery)
    } else {
      isMatch = !normalizedQuery || includesText(line, normalizedQuery)
    }

    if (isMatch) {
      matches.push(line)
      if (author) sourceLineIndexes.push(index)
    }
  }

  if (!author && !filter && normalizedQuery && includesText(day.humanTitle, normalizedQuery) && matches.length === 0) {
    const fallbackLine = lines.find((line) => line.trim())
    if (fallbackLine) {
      matches.push(fallbackLine.trimEnd())
    }
  }

  return {
    blockKind: 'line' as const,
    matchedBlocks: matches,
    ...(author ? { sourceLineIndexes } : {}),
  }
}

const collectTokens = (days: Day[], regex: RegExp) => {
  const tokenMap = new Map<string, { count: number; days: Set<string> }>()

  for (const day of days) {
    for (const line of day.contentMd.split('\n')) {
      regex.lastIndex = 0
      let match = regex.exec(line)

      while (match) {
        const token = normalizeNoteToken(match[2])
        const summary = tokenMap.get(token) ?? { count: 0, days: new Set<string>() }
        summary.count += 1
        summary.days.add(day.dayId)
        tokenMap.set(token, summary)
        match = regex.exec(line)
      }
    }
  }

  return [...tokenMap.entries()]
    .map(([token, summary]) => ({
      token,
      count: summary.count,
      days: [...summary.days].sort((a, b) => b.localeCompare(a)),
    }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token))
}

export const sortDaysDescending = (days: Day[]) =>
  [...days].sort((a, b) => b.dayId.localeCompare(a.dayId))

export const filterDays = (days: Day[], options: DayFilterOptions = {}) => {
  const includeEmpty = options.includeEmpty ?? true

  return days.filter((day) => {
    if (!includeEmpty && !day.contentMd.trim()) {
      return false
    }

    if (options.dateFrom && day.dayId < options.dateFrom) {
      return false
    }

    if (options.dateTo && day.dayId > options.dateTo) {
      return false
    }

    if (options.beforeDayId && day.dayId >= options.beforeDayId) {
      return false
    }

    return true
  })
}

export const searchDaysInMemory = (
  days: Day[],
  query: string,
  options: { filter?: SearchFilter | null; author?: AuthorSearch } = {},
  limit = 30,
) => {
  const trimmed = query.trim()
  const filter = options.filter ?? null

  if (!trimmed && !filter && !options.author) {
    return []
  }

  const results: DaySearchResult[] = []

  for (const day of days) {
    const match = getMatchedBlocks(day, trimmed, filter, options.author)
    if (!match.matchedBlocks.length) {
      continue
    }

    results.push({ day, ...match })
    if (results.length >= limit) {
      break
    }
  }

  return results
}

export const listOpenTodosFromDays = (days: Day[]) => {
  const todos: TodoItem[] = []

  for (const day of days) {
    const lines = day.contentMd.split('\n')

    lines.forEach((rawLine, index) => {
      const line = rawLine.trimEnd()
      if (TODO_LINE_REGEX.test(line)) {
        todos.push({
          dayId: day.dayId,
          humanTitle: day.humanTitle,
          lineNumber: index + 1,
          text: line,
        })
      }
    })
  }

  return todos
}

export const listTagsFromDays = (days: Day[]): TokenSummary[] => collectTokens(days, TAG_TOKEN_REGEX)

export const listMentionsFromDays = (days: Day[]): TokenSummary[] =>
  collectTokens(days, MENTION_TOKEN_REGEX)
