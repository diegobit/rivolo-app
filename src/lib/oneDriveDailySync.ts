import { createDailySync, type DailySyncDriver } from './dailySync'
import { dayPath } from './notebookDays'
import { createOneDriveDailyRemote, type OneDriveFile } from './oneDriveDailyRemote'
import { assertTarget, assertTargetInDatabase, type NotebookTarget } from './oneDriveDailyState'
import {
  childAtPath, deleteItem, downloadItem, ensureDayParent, getItem,
  inventoryDays, itemAddress, uploadDay, type DriveItem,
} from './oneDriveGraph'
import { getOneDriveState, updateOneDriveSyncSummary } from './oneDriveState'

const oneDriveDriver: DailySyncDriver<OneDriveFile> = {
  ...createOneDriveDailyRemote({ inventoryDays, getItem, downloadItem, ensureDayParent, uploadDay }),
  provider: 'onedrive',
  assertTarget,
  assertTargetInDatabase,
  accountName: async () => (await getOneDriveState()).accountName,
  updateSummary: (localDirty) => updateOneDriveSyncSummary({ localDirty, lastSyncAt: Date.now(), lastRemoteRev: null }),
  exists: async (ref) => Boolean(await getItem(ref, true)),
  assertFolder: async (folder) => { await getItem(folder) },
  remove: (file, beforeCommit) => deleteItem(file.item, beforeCommit),
}

export const verifyDailyItem = async (target: NotebookTarget, item: DriveItem, id: string) => {
  const atPath = await getItem(childAtPath(target.folder, dayPath(id)), true)
  if (!atPath || itemAddress(atPath) !== itemAddress(item)) throw new Error(`OneDrive ${id}: the tracked file was moved or renamed. Restore its path before syncing.`)
  return atPath
}
export const { pullDailyNotebook, pushDailyNotebook } = createDailySync(oneDriveDriver)
