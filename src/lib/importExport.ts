import { exportMarkdown, parseMarkdown } from './markdown'
import { listDays, replaceDays, saveDay } from './dayRepository'
import { runBulkDatabaseMutation } from './db'
import { formatDayTitle } from './dates'
import { del, get, set } from 'idb-keyval'
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'

export const IMPORT_ROLLBACK_BACKUPS_KEY = 'rivolo.import.rollbackBackups'
// Legacy single-entry key, folded into the retention list on the next backup write.
export const IMPORT_ROLLBACK_BACKUP_KEY = 'rivolo.import.latestRollbackBackup'

export type ImportRollbackBackup = {
  createdAt: number
  contentMd: string
  dayCount: number
}

// Stored form: contentMd is deflated to keep IndexedDB usage down. The plain
// contentMd variant is kept readable so backups written before compression
// was added still load correctly.
type StoredRollbackBackup =
  | { createdAt: number; dayCount: number; contentMd: string }
  | { createdAt: number; dayCount: number; contentMdGz: Uint8Array }

const MAX_ROLLBACK_BACKUPS = 10

const isStoredRollbackBackup = (value: unknown): value is StoredRollbackBackup => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  if (typeof entry.createdAt !== 'number' || typeof entry.dayCount !== 'number') return false
  return typeof entry.contentMd === 'string' || entry.contentMdGz instanceof Uint8Array
}

const inflateBackup = (stored: StoredRollbackBackup): ImportRollbackBackup | null => {
  if ('contentMd' in stored) return stored
  try {
    return {
      createdAt: stored.createdAt,
      dayCount: stored.dayCount,
      contentMd: strFromU8(inflateSync(stored.contentMdGz)),
    }
  } catch {
    // An entry that no longer decompresses is unrecoverable; drop it so the
    // remaining backups and future imports keep working.
    return null
  }
}

const deflateBackup = (entry: ImportRollbackBackup): StoredRollbackBackup => ({
  createdAt: entry.createdAt,
  dayCount: entry.dayCount,
  contentMdGz: deflateSync(strToU8(entry.contentMd)),
})

const readLegacyRollbackBackup = async (): Promise<ImportRollbackBackup | null> => {
  const legacy = (await get(IMPORT_ROLLBACK_BACKUP_KEY)) as Partial<ImportRollbackBackup> | undefined
  if (!legacy || typeof legacy.contentMd !== 'string') return null
  return {
    createdAt: typeof legacy.createdAt === 'number' ? legacy.createdAt : 0,
    contentMd: legacy.contentMd,
    dayCount: typeof legacy.dayCount === 'number' ? legacy.dayCount : 0,
  }
}

export const listRollbackBackups = async (): Promise<ImportRollbackBackup[]> => {
  const stored = await get(IMPORT_ROLLBACK_BACKUPS_KEY)
  const backups = Array.isArray(stored)
    ? stored
        .filter(isStoredRollbackBackup)
        .map(inflateBackup)
        .filter((entry) => entry !== null)
    : []
  const legacy = await readLegacyRollbackBackup()
  if (legacy) backups.push(legacy)
  return backups.sort((a, b) => b.createdAt - a.createdAt)
}

const appendRollbackBackup = async (entry: ImportRollbackBackup) => {
  const backups = [entry, ...(await listRollbackBackups())].slice(0, MAX_ROLLBACK_BACKUPS)
  await set(IMPORT_ROLLBACK_BACKUPS_KEY, backups.map(deflateBackup))
  await del(IMPORT_ROLLBACK_BACKUP_KEY)
}

export const saveRollbackBackup = async (contentMd: string) => {
  await appendRollbackBackup({
    createdAt: Date.now(),
    contentMd,
    dayCount: parseMarkdown(contentMd).days.length,
  })
}

export type ImportSafetyReason = 'no-day-markers' | 'duplicate-day-markers' | 'would-delete-local-days'

export class ImportSafetyError extends Error {
  reasons: ImportSafetyReason[]
  warnings: string[]
  deletedDayIds: string[]

  constructor(
    message: string,
    options: {
      reasons: ImportSafetyReason[]
      warnings?: string[]
      deletedDayIds?: string[]
    },
  ) {
    super(message)
    this.name = 'ImportSafetyError'
    this.reasons = options.reasons
    this.warnings = options.warnings ?? []
    this.deletedDayIds = options.deletedDayIds ?? []
  }
}

export const isImportSafetyError = (error: unknown): error is ImportSafetyError =>
  error instanceof ImportSafetyError ||
  (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'ImportSafetyError'
  )

const DUPLICATE_MARKERS_PROBLEM = 'the file contains duplicate day markers (the last block for each day wins)'

export const importMarkdownToDb = async (
  source: string,
  options: { replace?: boolean; markDirty?: boolean; allowUnsafeImport?: boolean } = {},
) => {
  const { days, warnings } = parseMarkdown(source)
  const markDirty = options.markDirty ?? true
  const hasNoMarkers =
    days.length === 0 && warnings.some((warning) => warning.toLowerCase().includes('no day markers'))
  const hasDuplicates = warnings.some((warning) =>
    warning.toLowerCase().includes('duplicate day marker'),
  )

  const normalizedDays = days.map((day) => ({
    ...day,
    humanTitle: day.humanTitle || formatDayTitle(day.dayId),
  }))

  if (!options.replace) {
    if (hasNoMarkers) {
      return { imported: 0, warnings }
    }
    if (hasDuplicates && !options.allowUnsafeImport) {
      throw new ImportSafetyError(`Import blocked: ${DUPLICATE_MARKERS_PROBLEM}.`, {
        reasons: ['duplicate-day-markers'],
        warnings,
      })
    }

    await runBulkDatabaseMutation(async () => {
      for (const day of normalizedDays) {
        await saveDay(day.dayId, day.contentMd, day.humanTitle, { markDirty })
      }
    })

    return { imported: days.length, warnings }
  }

  // Replacing everything with nothing is never allowed, not even confirmed.
  if (hasNoMarkers) {
    throw new ImportSafetyError('Import aborted: the file contains no day markers.', {
      reasons: ['no-day-markers'],
      warnings,
    })
  }

  const currentDays = await listDays(10000)
  const nextDayIds = new Set(normalizedDays.map((day) => day.dayId))
  const deletedDayIds = currentDays
    .map((day) => day.dayId)
    .filter((dayId) => !nextDayIds.has(dayId))

  const reasons: ImportSafetyReason[] = []
  const problems: string[] = []
  if (hasDuplicates) {
    reasons.push('duplicate-day-markers')
    problems.push(DUPLICATE_MARKERS_PROBLEM)
  }
  if (deletedDayIds.length > 0) {
    reasons.push('would-delete-local-days')
    problems.push(`it would delete ${deletedDayIds.length} local day(s)`)
  }

  if (reasons.length > 0 && !options.allowUnsafeImport) {
    throw new ImportSafetyError(`Import blocked: ${problems.join(' and ')}.`, {
      reasons,
      warnings,
      deletedDayIds,
    })
  }

  await saveRollbackBackup(exportMarkdown(currentDays))

  await runBulkDatabaseMutation(async () => {
    await replaceDays(normalizedDays, { markDirty })
  })

  return { imported: days.length, warnings }
}

export const exportMarkdownFromDb = async () => {
  const days = await listDays(10000)
  return exportMarkdown(days)
}
