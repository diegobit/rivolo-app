import { formatDayTitle, isValidDayId } from './dates'
import { isFtsAvailable, queryAll, queryOne, run, runDatabaseTransaction, upsertFts } from './db'
import { markSyncLocalDirty } from './syncDirty'
import { searchDaysInMemory, type Day, type DaySearchResult, type SearchFilter } from './notesCore'
import { isAscii, isAtLeastThreeCodePoints, quoteFtsPhrase } from './sqliteRuntime'

export type { Day, DaySearchResult, SearchFilter } from './notesCore'

type DayRow = {
  day_id: string
  human_title: string
  content_md: string
  created_at: number
  updated_at: number
}

type DayWrite = {
  dayId: string
  humanTitle: string
  contentMd: string
}

const mapRow = (row: DayRow): Day => ({
  dayId: row.day_id,
  humanTitle: row.human_title,
  contentMd: row.content_md,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const assertValidDayId = (dayId: string) => {
  if (!isValidDayId(dayId)) {
    throw new Error(`Invalid day ID: ${dayId}`)
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
  assertValidDayId(dayId)
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
    await markSyncLocalDirty()
    return stored
  }

  await upsertFts(dayId, humanTitle, '')
  await markSyncLocalDirty()
  return { dayId, humanTitle, contentMd: '', createdAt: now, updatedAt: now }
}

export const saveDay = async (
  dayId: string,
  contentMd: string,
  humanTitle?: string,
  options: { markDirty?: boolean } = {},
) => {
  assertValidDayId(dayId)
  const existing = await getDay(dayId)
  const now = Date.now()
  const title = humanTitle ?? existing?.humanTitle ?? formatDayTitle(dayId)
  const markDirty = options.markDirty ?? true

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
  if (markDirty) {
    await markSyncLocalDirty()
  }
  return getDay(dayId)
}

export const moveDay = async (fromDayId: string, toDayId: string) => {
  assertValidDayId(fromDayId)
  assertValidDayId(toDayId)

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

  await markSyncLocalDirty()
  return { day: await getDay(toDayId), conflict: false }
}

export const appendLineToDay = async (dayId: string, line: string) => {
  assertValidDayId(dayId)
  const existing = await ensureDay(dayId)
  const nextContent = existing.contentMd
    ? `${existing.contentMd.replace(/\s+$/, '')}\n${line.trim()}`
    : line.trim()
  return saveDay(dayId, nextContent, existing.humanTitle)
}

export const appendToDay = async (dayId: string, text: string) => {
  assertValidDayId(dayId)
  const existing = await ensureDay(dayId)
  const trimmed = text.trim()
  const nextContent = existing.contentMd
    ? `${existing.contentMd}\n\n${trimmed}`
    : trimmed
  return saveDay(dayId, nextContent, existing.humanTitle)
}

export const deleteDay = async (dayId: string) => {
  await run('DELETE FROM days WHERE day_id = ?', [dayId])
  if (await isFtsAvailable()) {
    await run('DELETE FROM days_fts WHERE day_id = ?', [dayId])
  }
  await markSyncLocalDirty()
}

export const clearDays = async () => {
  await run('DELETE FROM days')
  if (await isFtsAvailable()) {
    await run('DELETE FROM days_fts')
  }
}

export const replaceDays = async (days: DayWrite[], options: { markDirty?: boolean } = {}) => {
  for (const day of days) {
    assertValidDayId(day.dayId)
  }

  const markDirty = options.markDirty ?? true
  const now = Date.now()

  await runDatabaseTransaction(async () => {
    await run('DELETE FROM days')
    if (await isFtsAvailable()) {
      await run('DELETE FROM days_fts')
    }

    for (const day of days) {
      const title = day.humanTitle || formatDayTitle(day.dayId)
      await run(
        'INSERT INTO days (day_id, human_title, content_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [day.dayId, title, day.contentMd, now, now],
      )
      await upsertFts(day.dayId, title, day.contentMd)
    }

    if (markDirty) {
      await markSyncLocalDirty()
    }
  })
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

  const escapedTerms = trimmed
    .split(/\s+/)
    .filter((term) => /^[\x20-\x7e]+$/.test(term))
    .map((term) => term.replace(/[\\%_]/g, '\\$&'))
  const where = escapedTerms.length
    ? `WHERE ${escapedTerms
        .map(() => '(human_title LIKE ? ESCAPE \'\\\' OR content_md LIKE ? ESCAPE \'\\\')')
        .join(' AND ')}`
    : ''
  const termParams = escapedTerms.flatMap((term) => [`%${term}%`, `%${term}%`])
  const useFts =
    Boolean(trimmed) &&
    isAscii(trimmed) &&
    isAtLeastThreeCodePoints(trimmed) &&
    (await isFtsAvailable())
  const candidateSql = useFts
    ? `
      SELECT days.day_id, days.human_title, days.content_md, days.created_at, days.updated_at
      FROM days_fts
      INNER JOIN days ON days.day_id = days_fts.day_id
      WHERE days_fts MATCH ?
      ORDER BY days.day_id DESC
      LIMIT ? OFFSET ?
    `
    : `
      SELECT day_id, human_title, content_md, created_at, updated_at
      FROM days
      ${where}
      ORDER BY day_id DESC
      LIMIT ? OFFSET ?
    `
  const candidateParams = useFts ? [quoteFtsPhrase(trimmed)] : termParams
  const batchSize = Math.max(limit * 4, 50)
  const results: DaySearchResult[] = []
  let offset = 0

  while (results.length < limit) {
    const rows = await queryAll<DayRow>(candidateSql, [
      ...candidateParams,
      batchSize,
      offset,
    ])

    results.push(
      ...searchDaysInMemory(rows.map(mapRow), trimmed, { filter }, limit - results.length),
    )

    if (rows.length < batchSize) {
      break
    }
    offset += batchSize
  }

  return results
}
