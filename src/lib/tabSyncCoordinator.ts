const PRIMARY_LEASE_KEY = 'rivolo.sync.primary-tab'
const DATABASE_REVISION_KEY = 'rivolo.db.persisted-revision'
const DATABASE_CHANNEL_NAME = 'rivolo-db'
const PRIMARY_HEARTBEAT_MS = 5_000
const PRIMARY_LEASE_TTL_MS = 20_000

type PrimaryLease = {
  ownerId: string
  expiresAt: number
}

type DatabasePersistedMessage = {
  sourceTabId: string
  revision: number
}

export type TabSyncSnapshot = {
  isPrimary: boolean
  databaseStale: boolean
}

export const DATABASE_STALE_RELOAD_MESSAGE =
  'This tab has older local data. Reload before editing or syncing.'
export const SYNC_PAUSED_SECONDARY_MESSAGE =
  'Sync is paused in this tab because another Rivolo tab is active.'

const TAB_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`

let databaseSnapshotLoaded = false
let databaseStale = false
let databaseRevision = 0
let eventsStarted = false
let coordinatorStarted = false
let databaseChannel: BroadcastChannel | null = null

const listeners = new Set<() => void>()
const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined'

const getStorage = () => {
  if (!isBrowser()) return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const readLease = (): PrimaryLease | null => {
  try {
    const raw = getStorage()?.getItem(PRIMARY_LEASE_KEY)
    if (!raw) return null
    const lease = JSON.parse(raw) as Partial<PrimaryLease>
    if (typeof lease.ownerId !== 'string' || typeof lease.expiresAt !== 'number') return null
    return lease.expiresAt > Date.now() ? (lease as PrimaryLease) : null
  } catch {
    return null
  }
}

export const isPrimaryTab = () => {
  if (!isBrowser()) return true
  if (!getStorage()) return false
  const lease = readLease()
  return lease?.ownerId === TAB_ID
}

let snapshot: TabSyncSnapshot = {
  isPrimary: isPrimaryTab(),
  databaseStale,
}

const refreshSnapshot = () => {
  const next = { isPrimary: isPrimaryTab(), databaseStale }
  if (
    next.isPrimary === snapshot.isPrimary &&
    next.databaseStale === snapshot.databaseStale
  ) {
    return
  }
  snapshot = next
  listeners.forEach((listener) => listener())
}

const markDatabaseStale = (message: DatabasePersistedMessage) => {
  if (
    message.sourceTabId === TAB_ID ||
    typeof message.revision !== 'number' ||
    !databaseSnapshotLoaded ||
    databaseStale
  ) {
    return
  }
  databaseStale = true
  refreshSnapshot()
}

const parseDatabaseMessage = (value: unknown) => {
  if (!value || typeof value !== 'object') return
  const message = value as Partial<DatabasePersistedMessage>
  if (typeof message.sourceTabId === 'string' && typeof message.revision === 'number') {
    markDatabaseStale(message as DatabasePersistedMessage)
  }
}

const handleStorage = (event: StorageEvent) => {
  if (event.key === PRIMARY_LEASE_KEY) {
    refreshSnapshot()
    return
  }
  if (event.key !== DATABASE_REVISION_KEY || !event.newValue) return
  try {
    parseDatabaseMessage(JSON.parse(event.newValue))
  } catch {
    // Ignore malformed cross-tab state.
  }
}

const startCrossTabEvents = () => {
  if (!isBrowser() || eventsStarted) return
  eventsStarted = true
  window.addEventListener('storage', handleStorage)
  if (typeof BroadcastChannel === 'undefined') return
  try {
    databaseChannel = new BroadcastChannel(DATABASE_CHANNEL_NAME)
    databaseChannel.onmessage = (event: MessageEvent<unknown>) => parseDatabaseMessage(event.data)
  } catch {
    databaseChannel = null
  }
}

export const claimPrimaryTab = () => {
  const storage = getStorage()
  if (!isBrowser()) return true
  if (!storage) return false

  const activeLease = readLease()
  if (activeLease && activeLease.ownerId !== TAB_ID) {
    refreshSnapshot()
    return false
  }

  try {
    storage.setItem(
      PRIMARY_LEASE_KEY,
      JSON.stringify({ ownerId: TAB_ID, expiresAt: Date.now() + PRIMARY_LEASE_TTL_MS }),
    )
  } catch {
    refreshSnapshot()
    return false
  }

  const claimed = readLease()?.ownerId === TAB_ID
  refreshSnapshot()
  return claimed
}

const releasePrimaryTab = () => {
  const storage = getStorage()
  if (!storage || readLease()?.ownerId !== TAB_ID) return
  try {
    storage.removeItem(PRIMARY_LEASE_KEY)
  } catch {
    // Storage may be unavailable while the page is closing.
  }
  refreshSnapshot()
}

export const startPrimaryTabCoordinator = () => {
  if (!isBrowser() || coordinatorStarted) return
  coordinatorStarted = true
  startCrossTabEvents()

  const heartbeat = () => {
    if (document.visibilityState === 'visible') {
      claimPrimaryTab()
    } else {
      refreshSnapshot()
    }
  }
  heartbeat()
  window.setInterval(heartbeat, PRIMARY_HEARTBEAT_MS)
  document.addEventListener('visibilitychange', heartbeat)
  window.addEventListener('pagehide', releasePrimaryTab)
}

export const subscribeTabSync = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getTabSyncSnapshot = () => snapshot

export const getTabSyncBlockReason = () => {
  if (databaseStale) return DATABASE_STALE_RELOAD_MESSAGE
  return isPrimaryTab() ? null : SYNC_PAUSED_SECONDARY_MESSAGE
}

export const claimPrimaryTabForSync = () => {
  if (databaseStale) return DATABASE_STALE_RELOAD_MESSAGE
  return claimPrimaryTab() ? null : SYNC_PAUSED_SECONDARY_MESSAGE
}

export const beginDatabaseSnapshotLoad = () => {
  databaseSnapshotLoaded = true
  startCrossTabEvents()
}

export const broadcastDatabasePersisted = () => {
  const message = { sourceTabId: TAB_ID, revision: ++databaseRevision }
  startCrossTabEvents()
  try {
    databaseChannel?.postMessage(message)
  } catch {
    // localStorage below remains the fallback path.
  }
  try {
    getStorage()?.setItem(DATABASE_REVISION_KEY, JSON.stringify(message))
  } catch {
    // BroadcastChannel already handled capable browsers.
  }
}

export const assertDatabaseWritable = () => {
  if (databaseStale) throw new Error(DATABASE_STALE_RELOAD_MESSAGE)
}
