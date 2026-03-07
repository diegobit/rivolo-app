import { formatDayTitle } from './dates'
import { isFtsAvailable, queryAll, queryOne, run, upsertFts } from './db'
import { markLocalDirty } from './dropboxState'

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
}

type DayRow = {
  day_id: string
  human_title: string
  content_md: string
  created_at: number
  updated_at: number
}

const mapRow = (row: DayRow): Day => ({
  dayId: row.day_id,
  humanTitle: row.human_title,
  contentMd: row.content_md,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const TODO_LINE_REGEX = /^\s*-\s+\[ \]/
const TAG_REGEX = /(^|[^A-Za-z0-9_])#[A-Za-z0-9_/-]+/g
const MENTION_REGEX = /(^|[^A-Za-z0-9_])@[A-Za-z0-9_/-]+/g
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

const getMatchedBlocks = (day: Day, query: string, filter: SearchFilter | null) => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const lines = day.contentMd.split('\n')
  const matches: string[] = []

  if (filter === 'headings') {
    return {
      blockKind: 'section' as const,
      matchedBlocks: collectHeadingSections(lines, normalizedQuery),
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim()) {
      continue
    }

    let isMatch = false

    if (filter === 'open-todos') {
      isMatch = TODO_LINE_REGEX.test(line) && (!normalizedQuery || includesText(line, normalizedQuery))
    } else if (filter === 'tags') {
      isMatch = hasMatchingToken(line, TAG_REGEX, normalizedQuery)
    } else if (filter === 'mentions') {
      isMatch = hasMatchingToken(line, MENTION_REGEX, normalizedQuery)
    } else if (filter === 'headings') {
      isMatch = false
    } else if (normalizedQuery) {
      isMatch = includesText(line, normalizedQuery)
    }

    if (isMatch) {
      matches.push(line)
    }
  }

  if (!filter && normalizedQuery && includesText(day.humanTitle, normalizedQuery) && matches.length === 0) {
    const fallbackLine = lines.find((line) => line.trim())
    if (fallbackLine) {
      matches.push(fallbackLine.trimEnd())
    }
  }

  return {
    blockKind: 'line' as const,
    matchedBlocks: matches,
  }
}

export const listDays = async (limit = 60) => {
  const rows = await queryAll<DayRow>(
    'SELECT day_id, human_title, content_md, created_at, updated_at FROM days ORDER BY day_id DESC LIMIT ?',
    [limit],
  )
  return rows.map(mapRow)
}

export const listDaysSince = async (cutoffDayId: string) => {
  const rows = await queryAll<DayRow>(
    `
      SELECT day_id, human_title, content_md, created_at, updated_at
      FROM days
      WHERE day_id >= ?
      ORDER BY day_id DESC
    `,
    [cutoffDayId],
  )
  return rows.map(mapRow)
}

export const listDaysBefore = async (beforeDayId: string, limit: number) => {
  const rows = await queryAll<DayRow>(
    `
      SELECT day_id, human_title, content_md, created_at, updated_at
      FROM days
      WHERE day_id < ?
      ORDER BY day_id DESC
      LIMIT ?
    `,
    [beforeDayId, limit],
  )
  return rows.map(mapRow)
}

export const hasDaysBefore = async (beforeDayId: string) => {
  const row = await queryOne<{ day_id: string }>(
    `
      SELECT day_id
      FROM days
      WHERE day_id < ?
      ORDER BY day_id DESC
      LIMIT 1
    `,
    [beforeDayId],
  )
  return Boolean(row)
}

export const getDay = async (dayId: string) => {
  const row = await queryOne<DayRow>(
    'SELECT day_id, human_title, content_md, created_at, updated_at FROM days WHERE day_id = ? LIMIT 1',
    [dayId],
  )
  return row ? mapRow(row) : null
}

export const ensureDay = async (dayId: string) => {
  const existing = await getDay(dayId)
  if (existing) {
    return existing
  }

  const now = Date.now()
  const humanTitle = formatDayTitle(dayId)
  await run(
    'INSERT OR IGNORE INTO days (day_id, human_title, content_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [dayId, humanTitle, '', now, now],
  )

  const stored = await getDay(dayId)
  if (stored) {
    await upsertFts(stored.dayId, stored.humanTitle, stored.contentMd)
    await markLocalDirty()
    return stored
  }

  await upsertFts(dayId, humanTitle, '')
  await markLocalDirty()
  return { dayId, humanTitle, contentMd: '', createdAt: now, updatedAt: now }
}

export const saveDay = async (dayId: string, contentMd: string, humanTitle?: string) => {
  const existing = await getDay(dayId)
  const now = Date.now()
  const title = humanTitle ?? existing?.humanTitle ?? formatDayTitle(dayId)

  if (existing) {
    await run('UPDATE days SET human_title = ?, content_md = ?, updated_at = ? WHERE day_id = ?', [
      title,
      contentMd,
      now,
      dayId,
    ])
  } else {
    await run(
      'INSERT INTO days (day_id, human_title, content_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [dayId, title, contentMd, now, now],
    )
  }

  await upsertFts(dayId, title, contentMd)
  await markLocalDirty()
  return getDay(dayId)
}

export const moveDay = async (fromDayId: string, toDayId: string) => {
  if (fromDayId === toDayId) {
    return { day: await getDay(fromDayId), conflict: false }
  }

  const existing = await getDay(fromDayId)
  if (!existing) {
    return { day: null, conflict: false }
  }

  const target = await getDay(toDayId)
  if (target) {
    return { day: null, conflict: true }
  }

  const now = Date.now()
  const humanTitle = formatDayTitle(toDayId)
  await run('UPDATE days SET day_id = ?, human_title = ?, updated_at = ? WHERE day_id = ?', [
    toDayId,
    humanTitle,
    now,
    fromDayId,
  ])

  if (await isFtsAvailable()) {
    await run('DELETE FROM days_fts WHERE day_id = ?', [fromDayId])
    await upsertFts(toDayId, humanTitle, existing.contentMd)
  }

  await markLocalDirty()
  return { day: await getDay(toDayId), conflict: false }
}

export const appendLineToDay = async (dayId: string, line: string) => {
  const existing = await ensureDay(dayId)
  const nextContent = existing.contentMd
    ? `${existing.contentMd.replace(/\s+$/, '')}\n${line.trim()}`
    : line.trim()
  return saveDay(dayId, nextContent, existing.humanTitle)
}

export const appendToDay = async (dayId: string, text: string) => {
  const existing = await ensureDay(dayId)
  const trimmed = text.trim()
  const nextContent = existing.contentMd
    ? `${existing.contentMd.trimStart()}\n\n${trimmed}`
    : trimmed
  return saveDay(dayId, nextContent, existing.humanTitle)
}

export const deleteDay = async (dayId: string) => {
  await run('DELETE FROM days WHERE day_id = ?', [dayId])
  if (await isFtsAvailable()) {
    await run('DELETE FROM days_fts WHERE day_id = ?', [dayId])
  }
  await markLocalDirty()
}

export const clearDays = async () => {
  await run('DELETE FROM days')
  if (await isFtsAvailable()) {
    await run('DELETE FROM days_fts')
  }
}

export const searchDays = async (
  query: string,
  options: { filter?: SearchFilter | null } = {},
  limit = 30,
) => {
  const trimmed = query.trim()
  const filter = options.filter ?? null

  if (!trimmed && !filter) {
    return []
  }

  const rows = await queryAll<DayRow>(
    `
      SELECT day_id, human_title, content_md, created_at, updated_at
      FROM days
      ORDER BY day_id DESC
    `,
  )

  const results: DaySearchResult[] = []

  for (const row of rows) {
    const day = mapRow(row)
    const { matchedBlocks, blockKind } = getMatchedBlocks(day, trimmed, filter)
    if (!matchedBlocks.length) {
      continue
    }

    results.push({ day, matchedBlocks, blockKind })
    if (results.length >= limit) {
      break
    }
  }

  return results
}
