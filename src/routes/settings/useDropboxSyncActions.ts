import { disconnectActiveProvider } from '../../lib/sync'
import { startDropboxAuth } from '../../lib/dropbox'
import { pullFromSyncAndRefresh, pushToSyncAndRefresh } from '../../store/syncActions'

const REMOTE_RECOVERY_MESSAGE =
  'Dropbox file is missing or invalid. Local data is safe. Use "Restore Dropbox from local" to recreate cloud backup.'

const isRemoteRecoveryError = (message: string) =>
  message === 'Dropbox file not found. Push to create it first.' ||
  message === 'Dropbox file has no day markers. Import aborted to avoid data loss.'

type UseDropboxSyncActionsParams = {
  online: boolean
  dropboxConnected: boolean
  setDropboxStatus: (value: string | null) => void
  setSyncBusy: (value: boolean) => void
  loadDropboxState: () => Promise<void>
  loadSyncState: () => Promise<void>
}

export const useDropboxSyncActions = ({
  online,
  dropboxConnected,
  setDropboxStatus,
  setSyncBusy,
  loadDropboxState,
  loadSyncState,
}: UseDropboxSyncActionsParams) => {
  const handleConnectDropbox = async () => {
    setDropboxStatus(null)

    if (!online) {
      setDropboxStatus('Connect to the internet to link Dropbox.')
      return
    }

    try {
      await startDropboxAuth()
    } catch (error) {
      setDropboxStatus(error instanceof Error ? error.message : 'Dropbox connect failed.')
    }
  }

  const handleDisconnectDropbox = async () => {
    setDropboxStatus(null)

    try {
      await disconnectActiveProvider()
      await loadDropboxState()
      await loadSyncState()
      setDropboxStatus('Dropbox disconnected.')
    } catch (error) {
      setDropboxStatus(error instanceof Error ? error.message : 'Dropbox disconnect failed.')
    }
  }

  const handlePull = async () => {
    setDropboxStatus(null)

    if (!dropboxConnected) {
      setDropboxStatus('Connect Dropbox first.')
      return
    }

    setSyncBusy(true)
    try {
      const result = await pullFromSyncAndRefresh()
      await loadDropboxState()
      setDropboxStatus(result.status === 'noop' ? 'No changes on Dropbox.' : 'Pulled and imported.')
    } catch (error) {
      console.warn('[Dropbox] pull:failed', { error })
      const message = error instanceof Error ? error.message : 'Dropbox pull failed.'
      setDropboxStatus(isRemoteRecoveryError(message) ? REMOTE_RECOVERY_MESSAGE : message)
    } finally {
      setSyncBusy(false)
    }
  }

  const handlePush = async (force = false) => {
    setDropboxStatus(null)

    if (!dropboxConnected) {
      setDropboxStatus('Connect Dropbox first.')
      return
    }

    if (force) {
      const confirmed = window.confirm(
        'Restore Dropbox from your local data? This overwrites the Dropbox file contents.',
      )
      if (!confirmed) {
        return
      }
    }

    setSyncBusy(true)
    try {
      const result = await pushToSyncAndRefresh(force)
      await loadDropboxState()
      if (result.status === 'clean') {
        setDropboxStatus('No local changes to push.')
      } else if (result.status === 'blocked') {
        setDropboxStatus(
          result.reason === 'remote_missing'
            ? 'Dropbox file is missing. Local data is safe. Use "Restore Dropbox from local" to recreate cloud backup.'
            : 'Dropbox changed remotely. Pull first, or use "Restore Dropbox from local" to overwrite cloud backup.',
        )
      } else {
        setDropboxStatus('Uploaded to Dropbox.')
      }
    } catch (error) {
      setDropboxStatus(error instanceof Error ? error.message : 'Dropbox push failed.')
    } finally {
      setSyncBusy(false)
    }
  }

  return {
    handleConnectDropbox,
    handleDisconnectDropbox,
    handlePull,
    handlePush,
  }
}
