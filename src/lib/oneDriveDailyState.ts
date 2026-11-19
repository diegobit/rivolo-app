import type { NotebookTarget } from './dailySyncState'
import { getOneDriveState, type OneDriveState } from './oneDriveState'
import { queryFirstRow, type RivoloDatabase } from './sqliteRuntime'

export {
  acknowledgeDailyEvent, getDailyState, getDayChange, getNotebookProgress, listDirtyDays,
  persistDailyCheckpoint, readDailyOutbox, targetKey, writeDailyState, writeDailyStateInDatabase,
  writeDayInDatabase, type DailyEvent, type NotebookTarget,
} from './dailySyncState'

export const targetFromState = (state: OneDriveState): NotebookTarget | null => state.folderId ?
  { provider: 'onedrive', folder: state.folderId, account: state.accountId, generation: state.targetGeneration } : null
export const assertTarget = async (target: NotebookTarget) => {
  const state = await getOneDriveState()
  if (target.provider !== 'onedrive' || !state.connected || state.folderId !== target.folder || state.accountId !== target.account || state.targetGeneration !== target.generation) {
    throw new Error('OneDrive account or notebook changed during sync. The previous operation was stopped.')
  }
}
export const assertTargetInDatabase = (db: RivoloDatabase, target: NotebookTarget) => {
  const row = queryFirstRow<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', ['onedrive.state'])
  const state = row ? JSON.parse(row.value) as OneDriveState : null
  if (target.provider !== 'onedrive' || !state?.connected || state.accountId !== target.account || state.folderId !== target.folder || state.targetGeneration !== target.generation) {
    throw new Error('OneDrive account or notebook changed during sync. The previous operation was stopped.')
  }
}
