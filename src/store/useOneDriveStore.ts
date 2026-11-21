import { create } from 'zustand'
import { getOneDriveState, updateOneDriveFilePath } from '../lib/oneDriveState'
import { getOneDriveStatus } from '../lib/oneDrive'
import { getNotebookProgress, targetFromState } from '../lib/oneDriveDailyState'

export type OneDriveViewState = {
  filePath: string
  lastRemoteRev: string | null
  lastSyncAt: number | null
  localDirty: boolean
  hasAuth: boolean
  accountId: string | null
  accountEmail: string | null
  accountName: string | null
  migrationMessage: string | null
  notebookFolder: string | null
  offlineProgress: string | null
  loadState: () => Promise<void>
  updateFilePath: (path: string) => Promise<void>
}

const stateToView = async (state: Awaited<ReturnType<typeof getOneDriveState>>) => {
  const target = targetFromState(state)
  const progress = target ? await getNotebookProgress(target) : null
  const status = await getOneDriveStatus()
  return ({
  filePath: state.filePath ?? '',
  lastRemoteRev: state.lastRemoteRev,
  lastSyncAt: state.lastSyncAt,
  localDirty: status.localDirty,
  hasAuth: state.connected,
  accountId: state.accountId,
  accountEmail: state.accountEmail,
  accountName: state.accountName,
  migrationMessage: state.migrationMessage,
  notebookFolder: state.migrationStatus === 'complete' ? state.folderId : null,
  offlineProgress: progress && !progress.inventoryComplete ? `Loading notebook for offline use: ${progress.loaded} of ${progress.total} days. Keep Rivolo open to finish.` : null,
}) }

export const useOneDriveStore = create<OneDriveViewState>((set) => ({
  filePath: '',
  lastRemoteRev: null,
  lastSyncAt: null,
  localDirty: false,
  hasAuth: false,
  accountId: null,
  accountEmail: null,
  accountName: null,
  migrationMessage: null,
  notebookFolder: null,
  offlineProgress: null,

  loadState: async () => set(await stateToView(await getOneDriveState())),
  updateFilePath: async (path: string) => set(await stateToView(await updateOneDriveFilePath(path))),
}))
