import { create } from 'zustand'
import { getDropboxState, updateDropboxFilePath } from '../lib/dropboxState'

export type DropboxViewState = {
  filePath: string
  lastRemoteRev: string | null
  lastSyncAt: number | null
  localDirty: boolean
  hasAuth: boolean
  accountId: string | null
  accountEmail: string | null
  accountName: string | null
  loadState: () => Promise<void>
  updateFilePath: (path: string) => Promise<void>
}

const stateToView = (state: Awaited<ReturnType<typeof getDropboxState>>) => ({
  filePath: state.filePath ?? '',
  lastRemoteRev: state.lastRemoteRev,
  lastSyncAt: state.lastSyncAt,
  localDirty: state.localDirty,
  hasAuth: state.connected,
  accountId: state.accountId,
  accountEmail: state.accountEmail,
  accountName: state.accountName,
})

export const useDropboxStore = create<DropboxViewState>((set) => ({
  filePath: '',
  lastRemoteRev: null,
  lastSyncAt: null,
  localDirty: false,
  hasAuth: false,
  accountId: null,
  accountEmail: null,
  accountName: null,

  loadState: async () => set(stateToView(await getDropboxState())),
  updateFilePath: async (path: string) => set(stateToView(await updateDropboxFilePath(path))),
}))
