import { markDropboxLocalDirty, markDropboxLocalDirtyInDatabase } from './dropboxState'
import { markGoogleDriveLocalDirty, markGoogleDriveLocalDirtyInDatabase } from './googleDriveState'
import type { SyncProviderId } from './syncState'
import type { RivoloDatabase } from './sqliteRuntime'

export const markSyncLocalDirty = async (_dayIds?: string[], options: { excludeProvider?: SyncProviderId } = {}) => {
  // Per-day intent is captured transactionally by the SQLite journal. Other
  // providers deliberately keep their existing whole-notebook dirty flag.
  await Promise.all([
    options.excludeProvider !== 'dropbox' && markDropboxLocalDirty(),
    options.excludeProvider !== 'google-drive' && markGoogleDriveLocalDirty(),
  ])
}

// Runs inside the note write's transaction, so the dirty flag cannot be lost
// if the tab closes between the note write and a separate settings write.
export const markSyncLocalDirtyInDatabase = (db: RivoloDatabase) => {
  markDropboxLocalDirtyInDatabase(db)
  markGoogleDriveLocalDirtyInDatabase(db)
}
