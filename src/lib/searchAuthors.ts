import { getDropboxDailyTarget } from './dropbox'
import { getGoogleDriveDailyTarget } from './googleDrive'
import { getOneDriveState } from './oneDriveState'
import { targetFromState } from './oneDriveDailyState'
import { listDailyStates } from './dailySyncState'
import { listAllDays } from './dayRepository'
import { parseMarkdown } from './markdown'
import { alignLineAuthors, readNotebookAuthors, type NotebookAuthors } from './oneDriveBlame'
import { textLines } from './sequenceDiff'
import type { SyncProviderId } from './syncState'

export const loadSearchAuthors = async (provider: SyncProviderId, accountName: string | null) => {
  const oneDrive = provider === 'onedrive' ? await getOneDriveState() : null
  const target = provider === 'dropbox' ? await getDropboxDailyTarget()
    : provider === 'google-drive' ? await getGoogleDriveDailyTarget()
      : oneDrive ? targetFromState(oneDrive) : null
  const legacy = oneDrive?.mergeBaseContent ?? ''
  const days = target || legacy ? await listAllDays() : []
  const checkpoints = target ? await listDailyStates(target) : []
  const baselines = new Map(checkpoints
    .filter((state) => !state.deleted && state.baseline !== null)
    .map((state) => [state.dayId, state.baseline!]))
  const legacyDays = new Map(parseMarkdown(legacy).days.map((day) => [day.dayId, day.contentMd]))
  const legacyAuthors = await readNotebookAuthors(legacy)
  const names = new Set<string>()
  const byDay: NotebookAuthors = new Map()
  const currentAuthor = oneDrive?.accountName ?? accountName
  for (const day of days) {
    const baseline = baselines.get(day.dayId)
    const baseContent = baseline === undefined ? legacyDays.get(day.dayId)
      : parseMarkdown(baseline).days.find((item) => item.dayId === day.dayId)?.contentMd
    const baseAuthors = baseline === undefined ? legacyAuthors.get(day.dayId)
      : (await readNotebookAuthors(baseline, day.dayId)).get(day.dayId)
    // Like the editor gutter, keep unchanged rows attributed to their saved
    // authors and attribute lines changed locally to the current account.
    const authors = alignLineAuthors(baseContent ?? '', day.contentMd, baseAuthors ?? [], currentAuthor)
    const lines = textLines(day.contentMd)
    authors.forEach((author, index) => {
      if (author && lines[index]?.trim()) names.add(author)
    })
    if (authors.some(Boolean)) byDay.set(day.dayId, authors)
  }
  return { days, byDay, names: [...names].sort((a, b) => a.localeCompare(b)) }
}
