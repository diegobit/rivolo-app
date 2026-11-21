// The app's Graph client: the shared implementation bound to the browser's
// OneDrive session.
import { authorizedOneDriveFetch } from './oneDriveAuth'
import { getOneDriveState } from './oneDriveState'
import { createOneDriveGraph } from './oneDriveGraphApi'

export {
  GRAPH, DEFAULT_ONEDRIVE_PATH, GraphConflict, GraphError, childAtPath, itemAddress,
  requireFolder, validItemAddress, validateOneDriveTarget, type DriveItem,
} from './oneDriveGraphApi'

const graph = createOneDriveGraph({
  authorizedFetch: (input, init) => authorizedOneDriveFetch(input, init),
  accountKey: async () => (await getOneDriveState()).accountId,
})

export const {
  graphRequest, getItem, resolveTarget, downloadItem, ensureFolder, listChildren,
  inventoryDays, ensureDayParent, uploadDay, deleteItem,
} = graph
