import { startDropboxAuth } from '../../lib/dropbox'
import { prepareGoogleDriveAuth, startGoogleDriveAuth } from '../../lib/googleDriveAuth'
import { isImportSafetyError } from '../../lib/importExport'
import { disconnectProvider, type SyncProviderId } from '../../lib/sync'
import { SYNC_PROVIDER_LABELS } from '../../lib/syncState'
import { pullFromSyncAndRefresh, pushToSyncAndRefresh } from '../../store/syncActions'

type UseSyncProviderActionsParams = {
  provider: SyncProviderId
  activeProvider: SyncProviderId | null
  connected: boolean
  localDirty: boolean
  online: boolean
  setStatus: (value: string | null) => void
  loadProviderStates: () => Promise<void>
  loadSyncState: () => Promise<void>
  setActiveProvider: (providerId: SyncProviderId | null) => Promise<void>
}

export const useSyncProviderActions = ({
  provider,
  activeProvider,
  connected,
  localDirty,
  online,
  setStatus,
  loadProviderStates,
  loadSyncState,
  setActiveProvider,
}: UseSyncProviderActionsParams) => {
  const label = SYNC_PROVIDER_LABELS[provider]
  const isActive = activeProvider === provider

  const handleConnect = () => {
    setStatus(null)
    if (!online) {
      setStatus(`Connect to the internet to link ${label}.`)
      return
    }

    if (provider === 'dropbox') {
      void startDropboxAuth().catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Dropbox connect failed.')
      })
      return
    }

    try {
      void startGoogleDriveAuth()
        .then(async () => {
          await loadProviderStates()
          await setActiveProvider('google-drive')
          setStatus('Google Drive connected and activated.')
        })
        .catch((error) => {
          setStatus(error instanceof Error ? error.message : 'Google Drive connect failed.')
        })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Google Drive connect failed.')
      void prepareGoogleDriveAuth().catch(() => undefined)
    }
  }

  const handleDisconnect = async () => {
    setStatus(null)
    try {
      await disconnectProvider(provider)
      await loadProviderStates()
      await loadSyncState()
      setStatus(`${label} disconnected.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label} disconnect failed.`)
    }
  }

  const handleActivate = async () => {
    if (!connected) {
      setStatus(`Connect ${label} first.`)
      return
    }
    await setActiveProvider(provider)
    setStatus(`${label} is now the active sync provider.`)
  }

  const requireActive = () => {
    if (!connected) {
      setStatus(`Connect ${label} first.`)
      return false
    }
    if (!isActive) {
      setStatus(`Activate ${label} before syncing.`)
      return false
    }
    return true
  }

  const handlePull = async () => {
    setStatus(null)
    if (!requireActive()) return
    let force = false
    let allowDestructiveReplace = false
    if (localDirty) {
      const confirmed = window.confirm(
        `Pull from ${label} and replace local notes? Unpushed local changes and local-only days missing from ${label} will be overwritten. A rollback backup will be saved first.`,
      )
      if (!confirmed) return
      force = true
      allowDestructiveReplace = true
    }

    try {
      const result = await pullFromSyncAndRefresh({ force, allowDestructiveReplace })
      await loadProviderStates()
      setStatus(result.status === 'noop' ? `No changes on ${label}.` : 'Pulled and imported.')
    } catch (error) {
      if (isImportSafetyError(error) && error.reason === 'would-delete-local-days') {
        const deletedCount = error.deletedDayIds.length
        const confirmed = window.confirm(
          `${label} is missing ${deletedCount} local day(s). Replace local notes anyway? A rollback backup will be saved first.`,
        )
        if (!confirmed) {
          setStatus('Pull canceled. Local notes were not changed.')
          return
        }

        try {
          const result = await pullFromSyncAndRefresh({ allowDestructiveReplace: true })
          await loadProviderStates()
          setStatus(result.status === 'noop' ? `No changes on ${label}.` : 'Pulled and imported.')
        } catch (retryError) {
          setStatus(retryError instanceof Error ? retryError.message : `${label} pull failed.`)
        }
        return
      }

      setStatus(error instanceof Error ? error.message : `${label} pull failed.`)
    }
  }

  const handlePush = async (force = false) => {
    setStatus(null)
    if (!requireActive()) return
    if (force) {
      const confirmed = window.confirm(
        `Restore ${label} from local copy? This overwrites the remote file contents.`,
      )
      if (!confirmed) return
    }

    try {
      const result = await pushToSyncAndRefresh(force)
      await loadProviderStates()
      if (result.status === 'clean') {
        setStatus('No local changes to push.')
      } else if (result.status === 'blocked') {
        setStatus(
          result.reason === 'remote_missing'
            ? `${label} file is missing. Local data is safe. Use “Restore from local copy” to recreate it.`
            : `${label} changed remotely. Pull first, or use “Restore from local copy” to overwrite it.`,
        )
      } else {
        setStatus(`Uploaded to ${label}.`)
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label} push failed.`)
    }
  }

  return { handleConnect, handleDisconnect, handleActivate, handlePull, handlePush }
}
