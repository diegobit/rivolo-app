import { dayPath, type DailyRemoteFile } from './notebookDays'
import { childAtPath, GraphConflict, itemAddress, type DriveItem, type OneDriveGraph } from './oneDriveGraphApi'

export type OneDriveFile = DailyRemoteFile & { item: DriveItem }

const remoteFile = (item: DriveItem): OneDriveFile => ({
  get ref() { return itemAddress(item) },
  revision: item.eTag,
  modifiedAt: item.lastModifiedDateTime,
  item,
})

export const createOneDriveDailyRemote = ({
  inventoryDays, getItem, downloadItem, ensureDayParent, uploadDay,
}: Pick<OneDriveGraph, 'inventoryDays' | 'getItem' | 'downloadItem' | 'ensureDayParent' | 'uploadDay'>) => ({
  inventory: async (folder: string) => new Map(
    [...await inventoryDays(folder)].map(([dayId, item]) => [dayId, remoteFile(item)]),
  ),
  stat: async (folder: string, dayId: string) => {
    const item = await getItem(childAtPath(folder, dayPath(dayId)), true)
    return item ? remoteFile(item) : null
  },
  download: (file: OneDriveFile, dayId: string) => {
    const { item } = file
    if (!item.file || item.name !== `${dayId}.md` || !item.eTag) {
      throw new Error(`OneDrive ${dayId}: file renamed or invalid. Check its folder and name.`)
    }
    return downloadItem(item)
  },
  prepareWrite: async (folder: string, dayId: string, current: OneDriveFile | null) => {
    // An existing file already identifies its month folder.
    const parent = current?.item.parentReference
    const address = parent?.id
      ? `/drives/${encodeURIComponent(parent.driveId)}/items/${encodeURIComponent(parent.id)}`
      : await ensureDayParent(folder, dayId)
    return async (content: string, beforeCommit: () => Promise<void>) => remoteFile(await uploadDay(address, dayId, current?.item ?? null, content, beforeCommit))
  },
  isConflict: (error: unknown) => error instanceof GraphConflict,
})
