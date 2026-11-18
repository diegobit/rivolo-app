import { createDailySync, type DailySyncDriver } from './dailySync'
import { dayPath, type DailyRemoteFile } from './notebookDays'
import { assertTarget, assertTargetInDatabase, type NotebookTarget } from './oneDriveDailyState'
import {
  childAtPath, deleteItem, downloadItem, ensureDayParent, getItem, GraphConflict,
  inventoryDays, itemAddress, uploadDay, type DriveItem,
} from './oneDriveGraph'
import { getOneDriveState, updateOneDriveSyncSummary } from './oneDriveState'

type OneDriveFile = DailyRemoteFile & { item: DriveItem }

const remoteFile = (item: DriveItem): OneDriveFile => ({
  get ref() { return itemAddress(item) },
  revision: item.eTag,
  item,
})

const oneDriveDriver: DailySyncDriver<OneDriveFile> = {
  provider: 'onedrive',
  assertTarget,
  assertTargetInDatabase,
  accountName: async () => (await getOneDriveState()).accountName,
  updateSummary: (localDirty) => updateOneDriveSyncSummary({ localDirty, lastSyncAt: Date.now(), lastRemoteRev: null }),
  inventory: async (folder) => new Map(
    [...await inventoryDays(folder)].map(([dayId, item]) => [dayId, remoteFile(item)]),
  ),
  stat: async (folder, dayId) => {
    const item = await getItem(childAtPath(folder, dayPath(dayId)), true)
    return item ? remoteFile(item) : null
  },
  exists: async (ref) => Boolean(await getItem(ref, true)),
  assertFolder: async (folder) => { await getItem(folder) },
  download: (file, dayId) => {
    const { item } = file
    if (!item.file || item.name !== `${dayId}.md` || !item.eTag) {
      throw new Error(`OneDrive ${dayId}: file renamed or invalid. Check its folder and name.`)
    }
    return downloadItem(item)
  },
  prepareWrite: async (folder, dayId, current) => {
    // An existing file already identifies its month folder.
    const parent = current?.item.parentReference
    const address = parent?.id
      ? `/drives/${encodeURIComponent(parent.driveId)}/items/${encodeURIComponent(parent.id)}`
      : await ensureDayParent(folder, dayId)
    return async (content, beforeCommit) => remoteFile(await uploadDay(address, dayId, current?.item ?? null, content, beforeCommit))
  },
  remove: (file, beforeCommit) => deleteItem(file.item, beforeCommit),
  isConflict: (error) => error instanceof GraphConflict,
}

export const verifyDailyItem = async (target: NotebookTarget, item: DriveItem, id: string) => {
  const atPath = await getItem(childAtPath(target.folder, dayPath(id)), true)
  if (!atPath || itemAddress(atPath) !== itemAddress(item)) throw new Error(`OneDrive ${id}: the tracked file was moved or renamed. Restore its path before syncing.`)
  return atPath
}
export const { pullDailyNotebook, pushDailyNotebook } = createDailySync(oneDriveDriver)
