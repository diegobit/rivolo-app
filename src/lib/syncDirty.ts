import { markDropboxLocalDirty, markDropboxLocalDirtyInDatabase } from './dropboxState'
import { markGoogleDriveLocalDirty, markGoogleDriveLocalDirtyInDatabase } from './googleDriveState'
import type { RivoloDatabase } from './sqliteRuntime'

export const markSyncLocalDirty = async () => {
  await Promise.all([markDropboxLocalDirty(), markGoogleDriveLocalDirty()])
}

export const markSyncLocalDirtyInDatabase = (db: RivoloDatabase) => {
  markDropboxLocalDirtyInDatabase(db)
  markGoogleDriveLocalDirtyInDatabase(db)
}
