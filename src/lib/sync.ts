import { dropboxProvider } from './dropbox'
import { googleDriveProvider } from './googleDrive'
import { getSyncState, updateSyncState } from './syncState'
import type { ImportBackupReason } from './importExport'
import type { SyncProviderId } from './syncState'

export type { SyncProviderId } from './syncState'

export type SyncStatus = {
  connected: boolean
  targetName: string | null
  lastRemoteVersion: string | null
  lastSyncAt: number | null
  localDirty: boolean
  accountName: string | null
  accountEmail: string | null
}

export type SyncPullResult = {
  status: 'noop' | 'pulled'
}

export type SyncPullOptions = {
  force?: boolean
  allowDestructiveReplace?: boolean
  allowDuplicateDayMarkers?: boolean
  backupReason?: ImportBackupReason
}

export type SyncPushResult =
  | {
      status: 'clean'
    }
  | {
      status: 'blocked'
      reason: 'remote_missing' | 'remote_changed'
    }
  | {
      status: 'pushed'
    }

export type SyncProvider = {
  id: SyncProviderId
  getStatus: () => Promise<SyncStatus>
  pull: (options?: SyncPullOptions) => Promise<SyncPullResult>
  push: (force?: boolean) => Promise<SyncPushResult>
  disconnect: () => Promise<void>
}

let pushInFlight: Promise<SyncPushResult> | null = null
let queuedForcePush: Promise<SyncPushResult> | null = null

const EMPTY_STATUS: SyncStatus = {
  connected: false,
  targetName: null,
  lastRemoteVersion: null,
  lastSyncAt: null,
  localDirty: false,
  accountName: null,
  accountEmail: null,
}

const providers: Record<SyncProviderId, SyncProvider> = {
  dropbox: dropboxProvider,
  'google-drive': googleDriveProvider,
}

export const getProviderStatus = async (providerId: SyncProviderId) => providers[providerId].getStatus()

export const getActiveProviderId = async () => {
  const state = await getSyncState()
  return state.activeProvider
}

export const setActiveProviderId = async (providerId: SyncProviderId | null) => {
  const state = await updateSyncState({ activeProvider: providerId })
  return state.activeProvider
}

const getActiveProvider = async () => {
  const providerId = await getActiveProviderId()
  return providerId ? providers[providerId] : null
}

export const getActiveProviderStatus = async () => {
  const provider = await getActiveProvider()
  if (!provider) return EMPTY_STATUS
  return provider.getStatus()
}

export const pullFromSync = async (options: SyncPullOptions = {}) => {
  const provider = await getActiveProvider()
  if (!provider) {
    throw new Error('No sync provider connected.')
  }
  return provider.pull(options)
}

export const pushToSync = async (force = false) => {
  const provider = await getActiveProvider()
  if (!provider) {
    throw new Error('No sync provider connected.')
  }

  const trackPush = (pushPromise: Promise<SyncPushResult>) => {
    pushInFlight = pushPromise
    pushPromise.then(
      () => {
        if (pushInFlight === pushPromise) {
          pushInFlight = null
        }
        if (queuedForcePush === pushPromise) {
          queuedForcePush = null
        }
      },
      () => {
        if (pushInFlight === pushPromise) {
          pushInFlight = null
        }
        if (queuedForcePush === pushPromise) {
          queuedForcePush = null
        }
      },
    )
    return pushPromise
  }

  if (pushInFlight) {
    if (force && !queuedForcePush) {
      console.info('[Sync] push:force-queued')
      const currentPush = pushInFlight
      queuedForcePush = currentPush.then(
        () => provider.push(true),
        () => provider.push(true),
      )
      return trackPush(queuedForcePush)
    }

    console.info(force ? '[Sync] push:force-coalesced' : '[Sync] push:coalesced')
    return pushInFlight
  }

  return trackPush(provider.push(force))
}

export const disconnectProvider = async (providerId: SyncProviderId) => {
  await providers[providerId].disconnect()
  if ((await getActiveProviderId()) === providerId) {
    await setActiveProviderId(null)
  }
}

export const getEmptySyncStatus = () => EMPTY_STATUS
