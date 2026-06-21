import { markDropboxLocalDirty } from './dropboxState'
import { markGoogleDriveLocalDirty } from './googleDriveState'

export const markSyncLocalDirty = async () => {
  await Promise.all([markDropboxLocalDirty(), markGoogleDriveLocalDirty()])
}
