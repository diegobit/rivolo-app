import { exportMarkdown, parseMarkdown } from './markdown'
import { listDays, replaceDays, saveDay } from './dayRepository'
import { runBulkDatabaseMutation } from './db'
import { formatDayTitle } from './dates'
import { del, get, set } from 'idb-keyval'

export const IMPORT_ROLLBACK_BACKUPS_KEY = 'rivolo.import.rollbackBackups'
// Legacy single-entry key, folded into the retention list on the next backup write.
export const IMPORT_ROLLBACK_BACKUP_KEY = 'rivolo.import.latestRollbackBackup'

export type ImportBackupReason = 'auto-pull' | 'manual-pull' | 'destructive-replace'

export type ImportRollbackBackup = {
  createdAt: number
  contentMd: string
  dayCount: number
  reason: ImportBackupReason
}

const MAX_RECENT_ROLLBACK_BACKUPS = 3
const MAX_ROLLBACK_BACKUPS = 5

const isRollbackBackup = (value: unknown): value is ImportRollbackBackup =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ImportRollbackBackup).createdAt === 'number' &&
  typeof (value as ImportRollbackBackup).contentMd === 'string' &&
  typeof (value as ImportRollbackBackup).dayCount === 'number' &&
  typeof (value as ImportRollbackBackup).reason === 'string'

const readLegacyRollbackBackup = async (): Promise<ImportRollbackBackup | null> => {
  const legacy = (await get(IMPORT_ROLLBACK_BACKUP_KEY)) as Partial<ImportRollbackBackup> | undefined
  if (!legacy || typeof legacy.contentMd !== 'string') return null
  return {
    createdAt: typeof legacy.createdAt === 'number' ? legacy.createdAt : 0,
    contentMd: legacy.contentMd,
    dayCount: typeof legacy.dayCount === 'number' ? legacy.dayCount : 0,
    // The legacy entry may be the pre-destructive-pull backup, so keep it with
    // the reason that survives pruning longest.
    reason: 'destructive-replace',
  }
}

export const listRollbackBackups = async (): Promise<ImportRollbackBackup[]> => {
  const stored = await get(IMPORT_ROLLBACK_BACKUPS_KEY)
  const backups = Array.isArray(stored) ? stored.filter(isRollbackBackup) : []
  const legacy = await readLegacyRollbackBackup()
  if (legacy) backups.push(legacy)
  return backups.sort((a, b) => b.createdAt - a.createdAt)
}

// Keep the most recent backups, but never prune away the newest
// destructive-replace entry: it is the safety net for the last confirmed
// destructive pull and must survive routine auto-pull backups.
const pruneRollbackBackups = (backups: ImportRollbackBackup[]) => {
  const pruned = backups.slice(0, MAX_RECENT_ROLLBACK_BACKUPS)
  const newestDestructive = backups.find((backup) => backup.reason === 'destructive-replace')
  if (newestDestructive && !pruned.includes(newestDestructive)) {
    pruned.push(newestDestructive)
  }
  return pruned.slice(0, MAX_ROLLBACK_BACKUPS)
}

const appendRollbackBackup = async (entry: ImportRollbackBackup) => {
  const backups = pruneRollbackBackups([entry, ...(await listRollbackBackups())])
  await set(IMPORT_ROLLBACK_BACKUPS_KEY, backups)
  await del(IMPORT_ROLLBACK_BACKUP_KEY)
}

export type ImportSafetyReason = 'duplicate-day-markers' | 'would-delete-local-days'

export class ImportSafetyError extends Error {
  reason: ImportSafetyReason
  warnings: string[]
  deletedDayIds: string[]

  constructor(
    message: string,
    options: {
      reason: ImportSafetyReason
      warnings?: string[]
      deletedDayIds?: string[]
    },
  ) {
    super(message)
    this.name = 'ImportSafetyError'
    this.reason = options.reason
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

export const importMarkdownToDb = async (
  source: string,
  options: {
    replace?: boolean
    markDirty?: boolean
    allowDestructiveReplace?: boolean
    backupReason?: ImportBackupReason
  } = {},
) => {
  const { days, warnings } = parseMarkdown(source)
  const markDirty = options.markDirty ?? true
  const hasNoMarkersWarning = warnings.some((warning) =>
    warning.toLowerCase().includes('no day markers'),
  )
  const hasDuplicateDayMarkersWarning = warnings.some((warning) =>
    warning.toLowerCase().includes('duplicate day marker'),
  )

  if (days.length === 0 && hasNoMarkersWarning) {
    return { imported: 0, warnings }
  }

  if (hasDuplicateDayMarkersWarning) {
    throw new ImportSafetyError('Import aborted because the Markdown file contains duplicate day markers.', {
      reason: 'duplicate-day-markers',
      warnings,
    })
  }

  const normalizedDays = days.map((day) => ({
    ...day,
    humanTitle: day.humanTitle || formatDayTitle(day.dayId),
  }))

  if (options.replace) {
    const currentDays = await listDays(10000)
    const nextDayIds = new Set(normalizedDays.map((day) => day.dayId))
    const deletedDayIds = currentDays
      .map((day) => day.dayId)
      .filter((dayId) => !nextDayIds.has(dayId))

    if (deletedDayIds.length > 0 && !options.allowDestructiveReplace) {
      throw new ImportSafetyError(
        `Import aborted because it would delete ${deletedDayIds.length} local day(s).`,
        {
          reason: 'would-delete-local-days',
          warnings,
          deletedDayIds,
        },
      )
    }

    await appendRollbackBackup({
      createdAt: Date.now(),
      contentMd: exportMarkdown(currentDays),
      dayCount: currentDays.length,
      reason: options.allowDestructiveReplace
        ? 'destructive-replace'
        : options.backupReason ?? 'manual-pull',
    })

    await runBulkDatabaseMutation(async () => {
      await replaceDays(normalizedDays, { markDirty })
    })

    return { imported: days.length, warnings }
  }

  await runBulkDatabaseMutation(async () => {
    for (const day of normalizedDays) {
      await saveDay(day.dayId, day.contentMd, day.humanTitle, { markDirty })
    }
  })

  return { imported: days.length, warnings }
}

export const exportMarkdownFromDb = async () => {
  const days = await listDays(10000)
  return exportMarkdown(days)
}
