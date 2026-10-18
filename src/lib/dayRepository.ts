import { formatDayTitle, isValidDayId } from './dates'
import {
  acknowledgePendingDayDraft,
  getCommittedDayDraftGeneration,
  getPendingDayDraft,
  isDayDraftGenerationStale,
  isFtsAvailable,
  markNewDayForRecovery,
  queryAll,
  queryOne,
  registerDayDraftRecoveryHandler,
  runAtomicDatabaseMutation,
} from './db'
import type { PendingDayDraft } from './db'
import { executeSql, queryFirstRow, type RivoloDatabase } from './sqliteRuntime'
import { markSyncLocalDirtyInDatabase } from './syncDirty'
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

const readDayFromDatabase = (db: RivoloDatabase, dayId: string) => {
  const row = queryFirstRow<DayRow>(
    db,
    'SELECT day_id, human_title, content_md, created_at, updated_at FROM days WHERE day_id = ? LIMIT 1',
    [dayId],
  )
  return row ? mapRow(row) : null
}

const replaceFtsEntry = (db: RivoloDatabase, dayId: string, humanTitle: string, contentMd: string) => {
  executeSql(db, 'DELETE FROM days_fts WHERE day_id = ?', [dayId])
  executeSql(db, 'INSERT INTO days_fts (day_id, human_title, content_md) VALUES (?, ?, ?)', [
    dayId,
    humanTitle,
    contentMd,
  ])
}

const writeDayContentInDatabase = (
  db: RivoloDatabase,
  dayId: string,
  contentMd: string,
  humanTitle?: string,
  markDirty = true,
) => {
  const existing = readDayFromDatabase(db, dayId)
  const now = Date.now()
  const title = humanTitle ?? existing?.humanTitle ?? formatDayTitle(dayId)
  if (existing) {
    executeSql(db, 'UPDATE days SET human_title = ?, content_md = ?, updated_at = ? WHERE day_id = ?', [
      title,
      contentMd,
      now,
      dayId,
    ])
  } else {
    executeSql(db, 'INSERT INTO days (day_id, human_title, content_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
      dayId,
      title,
      contentMd,
      now,
      now,
    ])
  }
  replaceFtsEntry(db, dayId, title, contentMd)
  if (markDirty) markSyncLocalDirtyInDatabase(db)
  return readDayFromDatabase(db, dayId)
}

export const commitDayDraftInDatabase = (db: RivoloDatabase, draft: PendingDayDraft) => {
  writeDayContentInDatabase(db, draft.dayId, draft.contentMd)
}

registerDayDraftRecoveryHandler((db, drafts) => {
  let changed = false
  const appliedDayIds: string[] = []
  const completedDayIds: string[] = []
  const conflictDayIds: string[] = []

  for (const draft of drafts) {
    if (!isValidDayId(draft.dayId)) {
      conflictDayIds.push(draft.dayId)
      continue
    }

    const existing = readDayFromDatabase(db, draft.dayId)
    if (existing?.contentMd === draft.contentMd) {
      completedDayIds.push(draft.dayId)
      continue
    }

    const matchesDraftBaseline = existing
      ? existing.contentMd === draft.baseContentMd && existing.updatedAt === draft.baseUpdatedAt
      : draft.baseRowWasUnsaved
    if (!matchesDraftBaseline) {
      conflictDayIds.push(draft.dayId)
      continue
    }

    writeDayContentInDatabase(db, draft.dayId, draft.contentMd)
    changed = true
    appliedDayIds.push(draft.dayId)
    completedDayIds.push(draft.dayId)
  }

  return { changed, appliedDayIds, completedDayIds, conflictDayIds }
})

export const listDays = async (limit = 60) => {
  const rows = await queryAll<DayRow>(
    'SELECT day_id, human_title, content_md, created_at, updated_at FROM days ORDER BY day_id DESC LIMIT ?',
    [limit],
  )
  return rows.map(mapRow)
}

export const listAllDays = async () => {
  const rows = await queryAll<DayRow>(
    'SELECT day_id, human_title, content_md, created_at, updated_at FROM days ORDER BY day_id DESC',
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
  return runAtomicDatabaseMutation((db) => {
    const existing = readDayFromDatabase(db, dayId)
    if (existing) return { day: existing, changed: false, created: false }
    const now = Date.now()
    const humanTitle = formatDayTitle(dayId)
    executeSql(db, 'INSERT OR IGNORE INTO days (day_id, human_title, content_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
      dayId,
      humanTitle,
      '',
      now,
      now,
    ])
    const stored = readDayFromDatabase(db, dayId) ?? {
      dayId,
      humanTitle,
      contentMd: '',
      createdAt: now,
      updatedAt: now,
    }
    replaceFtsEntry(db, stored.dayId, stored.humanTitle, stored.contentMd)
    markSyncLocalDirtyInDatabase(db)
    return { day: stored, changed: true, created: true }
  }, {
    shouldMarkChanged: (result) => result.changed,
    onCommit: (result) => {
      if (result.created) markNewDayForRecovery(dayId)
    },
  }).then((result) => result.day)
}

export const saveDay = async (
  dayId: string,
  contentMd: string,
  humanTitle?: string,
  options: { markDirty?: boolean; draftGeneration?: number } = {},
) => {
  assertValidDayId(dayId)
  const markDirty = options.markDirty ?? true
  let committedGeneration: number | null = null
  const result = await runAtomicDatabaseMutation((db) => {
    let contentToWrite = contentMd
    const titleToWrite = humanTitle
    if (options.draftGeneration !== undefined) {
      const pending = getPendingDayDraft(dayId)
      if (
        isDayDraftGenerationStale(dayId, options.draftGeneration) ||
        getCommittedDayDraftGeneration(dayId) >= options.draftGeneration
      ) {
        return { day: readDayFromDatabase(db, dayId), changed: false }
      }
      if (pending && pending.generation >= options.draftGeneration) {
        contentToWrite = pending.contentMd
        committedGeneration = pending.generation
      }
    }
    const day = writeDayContentInDatabase(db, dayId, contentToWrite, titleToWrite, markDirty)
    return { day, changed: true }
  }, {
    shouldMarkChanged: (value) => value.changed,
    persistImmediately: options.draftGeneration !== undefined,
    onCommit: () => {
      if (committedGeneration !== null) acknowledgePendingDayDraft(dayId, committedGeneration)
    },
  })
  return result.changed ? result.day : null
}

export const moveDay = async (fromDayId: string, toDayId: string) => {
  assertValidDayId(fromDayId)
  assertValidDayId(toDayId)

  if (fromDayId === toDayId) {
    return { day: await getDay(fromDayId), conflict: false }
  }

  return runAtomicDatabaseMutation((db) => {
    const existing = readDayFromDatabase(db, fromDayId)
    if (!existing) return { result: { day: null, conflict: false }, changed: false }
    if (readDayFromDatabase(db, toDayId)) {
      return { result: { day: null, conflict: true }, changed: false }
    }
    const now = Date.now()
    const humanTitle = formatDayTitle(toDayId)
    executeSql(db, 'UPDATE days SET day_id = ?, human_title = ?, updated_at = ? WHERE day_id = ?', [
      toDayId,
      humanTitle,
      now,
      fromDayId,
    ])
    executeSql(db, 'DELETE FROM days_fts WHERE day_id = ?', [fromDayId])
    replaceFtsEntry(db, toDayId, humanTitle, existing.contentMd)
    markSyncLocalDirtyInDatabase(db)
    return { result: { day: readDayFromDatabase(db, toDayId), conflict: false }, changed: true }
  }, { shouldMarkChanged: (value) => value.changed }).then((value) => value.result)
}

const appendQueues = new Map<string, Promise<void>>()

const enqueueDayAppend = async <T>(dayId: string, operation: () => Promise<T>): Promise<T> => {
  const previous = appendQueues.get(dayId) ?? Promise.resolve()

  const current = previous.then(operation)
  const tail = current
    .then(() => {}, () => {})
    .finally(() => {
      if (appendQueues.get(dayId) === tail) {
        appendQueues.delete(dayId)
      }
    })

  appendQueues.set(dayId, tail)
  return current
}

export const appendLineToDay = async (dayId: string, line: string) => {
  assertValidDayId(dayId)
  return enqueueDayAppend(dayId, async () => {
    const existing = await ensureDay(dayId)
    const nextContent = existing.contentMd
      ? `${existing.contentMd.replace(/\s+$/, '')}\n${line.trim()}`
      : line.trim()
    return saveDay(dayId, nextContent, existing.humanTitle)
  })
}

export const appendToDay = async (dayId: string, text: string) => {
  assertValidDayId(dayId)
  return enqueueDayAppend(dayId, async () => {
    const existing = await ensureDay(dayId)
    const trimmed = text.trim()
    const nextContent = existing.contentMd
      ? `${existing.contentMd}\n\n${trimmed}`
      : trimmed
    return saveDay(dayId, nextContent, existing.humanTitle)
  })
}

export const deleteDay = async (dayId: string) => {
  await runAtomicDatabaseMutation((db) => {
    executeSql(db, 'DELETE FROM days WHERE day_id = ?', [dayId])
    executeSql(db, 'DELETE FROM days_fts WHERE day_id = ?', [dayId])
    markSyncLocalDirtyInDatabase(db)
  })
}

export const clearDays = async () => {
  await runAtomicDatabaseMutation((db) => {
    executeSql(db, 'DELETE FROM days')
    executeSql(db, 'DELETE FROM days_fts')
  })
}

export const replaceDays = async (days: DayWrite[], options: { markDirty?: boolean } = {}) => {
  for (const day of days) {
    assertValidDayId(day.dayId)
  }

  const markDirty = options.markDirty ?? true
  const now = Date.now()

  await runAtomicDatabaseMutation((db) => {
    executeSql(db, 'DELETE FROM days')
    executeSql(db, 'DELETE FROM days_fts')

    for (const day of days) {
      const title = day.humanTitle || formatDayTitle(day.dayId)
      executeSql(db, 'INSERT INTO days (day_id, human_title, content_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
        day.dayId,
        title,
        day.contentMd,
        now,
        now,
      ])
      executeSql(db, 'INSERT INTO days_fts (day_id, human_title, content_md) VALUES (?, ?, ?)', [
        day.dayId,
        title,
        day.contentMd,
      ])
    }

    if (markDirty) markSyncLocalDirtyInDatabase(db)
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
