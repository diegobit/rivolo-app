import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncProviderActions } from './useSyncProviderActions'

const syncActions = vi.hoisted(() => ({
  pullFromSyncAndRefresh: vi.fn(),
  pushToSyncAndRefresh: vi.fn(),
}))

vi.mock('../../store/syncActions', () => syncActions)
vi.mock('../../lib/dropbox', () => ({ startDropboxAuth: vi.fn() }))
vi.mock('../../lib/googleDriveAuth', () => ({
  prepareGoogleDriveAuth: vi.fn(),
  startGoogleDriveAuth: vi.fn(),
}))
vi.mock('../../lib/sync', () => ({ disconnectProvider: vi.fn() }))

const useActions = (localDirty: boolean) => {
  const setStatus = vi.fn()
  const loadProviderStates = vi.fn(async () => undefined)
  const loadSyncState = vi.fn(async () => undefined)
  const setActiveProvider = vi.fn(async () => undefined)
  const actions = useSyncProviderActions({
    provider: 'dropbox',
    activeProvider: 'dropbox',
    connected: true,
    localDirty,
    online: true,
    setStatus,
    loadProviderStates,
    loadSyncState,
    setActiveProvider,
  })

  return { ...actions, loadProviderStates, setStatus }
}

describe('useSyncProviderActions', () => {
  beforeEach(() => {
    syncActions.pullFromSyncAndRefresh.mockReset()
    syncActions.pushToSyncAndRefresh.mockReset()
    syncActions.pullFromSyncAndRefresh.mockResolvedValue({ status: 'pulled' })
    vi.restoreAllMocks()
  })

  it('passes force after confirming a dirty manual pull', async () => {
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const { handlePull, loadProviderStates, setStatus } = useActions(true)

    await handlePull()

    expect(confirm).toHaveBeenCalledWith(
      'Pull from Dropbox and replace local notes? Unpushed local changes and local-only days missing from Dropbox will be overwritten. A rollback backup will be saved first.',
    )
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledWith({
      force: true,
      allowDestructiveReplace: true,
    })
    expect(loadProviderStates).toHaveBeenCalledOnce()
    expect(setStatus).toHaveBeenLastCalledWith('Pulled and imported.')
  })

  it('does not pull dirty local notes when confirmation is canceled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const { handlePull } = useActions(true)

    await handlePull()

    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
  })
})
