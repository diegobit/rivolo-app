import { exportMarkdown, parseMarkdown } from './markdown'
import { listDays, replaceDays, saveDay } from './dayRepository'
import { runBulkDatabaseMutation } from './db'
import { formatDayTitle } from './dates'
import { set } from 'idb-keyval'

export const IMPORT_ROLLBACK_BACKUP_KEY = 'rivolo.import.latestRollbackBackup'

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
  options: { replace?: boolean; markDirty?: boolean; allowDestructiveReplace?: boolean } = {},
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

    await set(IMPORT_ROLLBACK_BACKUP_KEY, {
      createdAt: Date.now(),
      contentMd: exportMarkdown(currentDays),
      dayCount: currentDays.length,
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
