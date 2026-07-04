import { create } from 'zustand'
import {
  DEFAULT_GOOGLE_DRIVE_FILE_NAME,
  getGoogleDriveState,
  updateGoogleDriveFileName,
} from '../lib/googleDriveState'

export type GoogleDriveViewState = {
  connected: boolean
  fileId: string | null
  folderId: string | null
  fileName: string
  lastRemoteVersion: string | null
  lastSyncAt: number | null
  localDirty: boolean
  accountId: string | null
  accountEmail: string | null
  accountName: string | null
  loadState: () => Promise<void>
  updateFileName: (fileName: string) => Promise<void>
}

const stateToView = (state: Awaited<ReturnType<typeof getGoogleDriveState>>) => ({
  connected: state.connected,
  fileId: state.fileId,
  folderId: state.folderId,
  fileName: state.fileName,
  lastRemoteVersion: state.lastRemoteVersion,
  lastSyncAt: state.lastSyncAt,
  localDirty: state.localDirty,
  accountId: state.accountId,
  accountEmail: state.accountEmail,
  accountName: state.accountName,
})

export const useGoogleDriveStore = create<GoogleDriveViewState>((set) => ({
  connected: false,
  fileId: null,
  folderId: null,
  fileName: DEFAULT_GOOGLE_DRIVE_FILE_NAME,
  lastRemoteVersion: null,
  lastSyncAt: null,
  localDirty: false,
  accountId: null,
  accountEmail: null,
  accountName: null,

  loadState: async () => set(stateToView(await getGoogleDriveState())),
  updateFileName: async (fileName) => set(stateToView(await updateGoogleDriveFileName(fileName))),
}))
