import { disconnectActiveProvider } from '../../lib/sync'
import { startDropboxAuth } from '../../lib/dropbox'
import { pullFromSyncAndRefresh, pushToSyncAndRefresh } from '../../store/syncActions'

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
      setDropboxStatus(error instanceof Error ? error.message : 'Dropbox pull failed.')
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

    setSyncBusy(true)
    try {
      const result = await pushToSyncAndRefresh(force)
      await loadDropboxState()
      if (result.status === 'clean') {
        setDropboxStatus('No local changes to push.')
      } else if (result.status === 'blocked') {
        setDropboxStatus('Remote changed. Pull first or force overwrite.')
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
