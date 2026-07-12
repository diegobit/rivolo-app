import { startDropboxAuth } from '../../lib/dropbox'
import { prepareGoogleDriveAuth, startGoogleDriveAuth } from '../../lib/googleDriveAuth'
import { isImportSafetyError } from '../../lib/importExport'
import { disconnectProvider, type SyncProviderId } from '../../lib/sync'
import { SYNC_PROVIDER_LABELS } from '../../lib/syncState'
import { claimPrimaryTabForSync } from '../../lib/tabSyncCoordinator'
import { blockedPushMessage, pullFromSyncAndRefresh, pushToSyncAndRefresh } from '../../store/syncActions'

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

  const requireSafeSyncTab = () => {
    const reason = claimPrimaryTabForSync()
    if (reason) setStatus(reason)
    return !reason
  }

  const handleConnect = () => {
    setStatus(null)
    if (!online) {
      setStatus(`Connect to the internet to link ${label}.`)
      return
    }
    if (!requireSafeSyncTab()) return

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
    if (!requireSafeSyncTab()) return
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
    setStatus(null)
    if (!requireSafeSyncTab()) return
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
    if (!requireSafeSyncTab()) return

    const pullOptions = { force: false, allowUnsafeImport: false }
    if (localDirty) {
      const confirmed = window.confirm(
        `Pull from ${label} and replace local notes? Unpushed local changes and local-only days missing from ${label} will be overwritten. A rollback backup will be saved first.`,
      )
      if (!confirmed) return
      pullOptions.force = true
      pullOptions.allowUnsafeImport = true
    }

    const runPull = async (options: typeof pullOptions) => {
      const result = await pullFromSyncAndRefresh(options)
      await loadProviderStates()
      setStatus(result.status === 'noop' ? `No changes on ${label}.` : 'Pulled and imported.')
    }

    try {
      await runPull(pullOptions)
    } catch (error) {
      if (
        isImportSafetyError(error) &&
        !pullOptions.allowUnsafeImport &&
        !error.reasons.includes('no-day-markers')
      ) {
        const confirmed = window.confirm(
          `${error.message} Replace local notes anyway? A rollback backup will be saved first.`,
        )
        if (!confirmed) {
          setStatus('Pull canceled. Local notes were not changed.')
          return
        }
        try {
          await runPull({ ...pullOptions, allowUnsafeImport: true })
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
    if (!requireSafeSyncTab()) return

    try {
      const result = await pushToSyncAndRefresh(force)
      await loadProviderStates()
      if (result.status === 'clean') {
        setStatus('No local changes to push.')
      } else if (result.status === 'blocked') {
        setStatus(blockedPushMessage(result.reason))
      } else {
        setStatus(`Uploaded to ${label}.`)
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label} push failed.`)
    }
  }

  return { handleConnect, handleDisconnect, handleActivate, handlePull, handlePush }
}
