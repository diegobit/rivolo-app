import { disconnectActiveProvider } from '../../lib/sync'
import { startDropboxAuth } from '../../lib/dropbox'
import { pullFromSyncAndRefresh, pushToSyncAndRefresh } from '../../store/syncActions'

const REMOTE_RECOVERY_MESSAGE =
  'Dropbox file is missing or invalid. Local data is safe. Use "Restore Dropbox from local copy" to recreate cloud backup.'

const isRemoteRecoveryError = (message: string) =>
  message === 'Dropbox file not found. Push to create it first.' ||
  message === 'Dropbox file has no day markers. Import aborted to avoid data loss.'

type UseDropboxSyncActionsParams = {
  online: boolean
  dropboxConnected: boolean
  localDirty: boolean
  setDropboxStatus: (value: string | null) => void
  loadDropboxState: () => Promise<void>
  loadSyncState: () => Promise<void>
}

export const useDropboxSyncActions = ({
  online,
  dropboxConnected,
  localDirty,
  setDropboxStatus,
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

    if (localDirty) {
      const confirmed = window.confirm(
        'Pull from Dropbox and replace local notes? Unpushed local changes will be overwritten.',
      )
      if (!confirmed) {
        return
      }
    }

    try {
      const result = await pullFromSyncAndRefresh()
      await loadDropboxState()
      await loadSyncState()
      setDropboxStatus(result.status === 'noop' ? 'No changes on Dropbox.' : 'Pulled and imported.')
    } catch (error) {
      console.warn('[Dropbox] pull:failed', { error })
      const message = error instanceof Error ? error.message : 'Dropbox pull failed.'
      setDropboxStatus(isRemoteRecoveryError(message) ? REMOTE_RECOVERY_MESSAGE : message)
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
        'Restore Dropbox from local copy? This overwrites the Dropbox file contents.',
      )
      if (!confirmed) {
        return
      }
    }

    try {
      const result = await pushToSyncAndRefresh(force)
      await loadDropboxState()
      await loadSyncState()
      if (result.status === 'clean') {
        setDropboxStatus('No local changes to push.')
      } else if (result.status === 'blocked') {
        setDropboxStatus(
          result.reason === 'remote_missing'
            ? 'Dropbox file is missing. Local data is safe. Use "Restore Dropbox from local copy" to recreate cloud backup.'
            : 'Dropbox changed remotely. Pull first, or use "Restore Dropbox from local copy" to overwrite cloud backup.',
        )
      } else {
        setDropboxStatus('Uploaded to Dropbox.')
      }
    } catch (error) {
      setDropboxStatus(error instanceof Error ? error.message : 'Dropbox push failed.')
    }
  }

  return {
    handleConnectDropbox,
    handleDisconnectDropbox,
    handlePull,
    handlePush,
  }
}
