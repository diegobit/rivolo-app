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
  options: { openOnly?: boolean; tag?: string } = {},
  limit = 30,
) => {
  const trimmed = query.trim()
  const conditions: string[] = []
  const params: (string | number)[] = []
  const ftsEnabled = await isFtsAvailable()

  if (trimmed) {
    if (ftsEnabled) {
      conditions.push('days_fts MATCH ?')
      params.push(trimmed)
    } else {
      conditions.push('(days.human_title LIKE ? OR days.content_md LIKE ?)')
      params.push(`%${trimmed}%`, `%${trimmed}%`)
    }
  }

  if (options.openOnly) {
    conditions.push('days.content_md LIKE ?')
    params.push('%- [ ]%')
  }

  if (options.tag) {
    conditions.push('days.content_md LIKE ?')
    params.push(`%${options.tag}%`)
  }

  if (!conditions.length) {
    return []
  }

  if (trimmed && ftsEnabled) {
    const whereClause = conditions.join(' AND ')
    const rows = await queryAll<DayRow>(
      `
        SELECT days.day_id, days.human_title, days.content_md, days.created_at, days.updated_at
        FROM days_fts
        JOIN days ON days.day_id = days_fts.day_id
        WHERE ${whereClause}
        ORDER BY bm25(days_fts)
        LIMIT ?
      `,
      [...params, limit],
    )
    return rows.map(mapRow)
  }

  const whereClause = conditions.join(' AND ')
  const rows = await queryAll<DayRow>(
    `
      SELECT day_id, human_title, content_md, created_at, updated_at
      FROM days
      WHERE ${whereClause}
      ORDER BY day_id DESC
      LIMIT ?
    `,
    [...params, limit],
  )
  return rows.map(mapRow)
}
