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

export const useDropboxStore = create<DropboxViewState>((set) => ({
  filePath: '',
  lastRemoteRev: null,
  lastSyncAt: null,
  localDirty: false,
  hasAuth: false,
  accountId: null,
  accountEmail: null,
  accountName: null,

  loadState: async () => {
    const state = await getDropboxState()
    set({
      filePath: state.filePath ?? '',
      lastRemoteRev: state.lastRemoteRev,
      lastSyncAt: state.lastSyncAt,
      localDirty: state.localDirty,
      hasAuth: Boolean(state.auth),
      accountId: state.accountId,
      accountEmail: state.accountEmail,
      accountName: state.accountName,
    })
  },

  updateFilePath: async (path: string) => {
    const state = await updateDropboxFilePath(path)
    set({
      filePath: state.filePath ?? '',
      lastRemoteRev: state.lastRemoteRev,
      lastSyncAt: state.lastSyncAt,
      localDirty: state.localDirty,
      hasAuth: Boolean(state.auth),
      accountId: state.accountId,
      accountEmail: state.accountEmail,
      accountName: state.accountName,
    })
  },
}))
