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
    localStorage.removeItem('rivolo.sync.primary-tab')
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
      allowDuplicateDayMarkers: false,
      backupReason: 'manual-pull',
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

  it('confirms past duplicate day markers and retries the pull', async () => {
    const duplicateError = Object.assign(new Error('Import aborted because of duplicates.'), {
      name: 'ImportSafetyError',
      reason: 'duplicate-day-markers',
      warnings: [],
      deletedDayIds: [],
    })
    syncActions.pullFromSyncAndRefresh
      .mockRejectedValueOnce(duplicateError)
      .mockResolvedValueOnce({ status: 'pulled' })
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const { handlePull, setStatus } = useActions(false)

    await handlePull()

    expect(confirm).toHaveBeenCalledWith(
      'The Dropbox file contains duplicate day markers. Import anyway? The last block for each day is kept, and a rollback backup will be saved first.',
    )
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenLastCalledWith({
      force: false,
      allowDestructiveReplace: false,
      allowDuplicateDayMarkers: true,
      backupReason: 'manual-pull',
    })
    expect(setStatus).toHaveBeenLastCalledWith('Pulled and imported.')
  })

  it('cancels the duplicate day marker override without importing', async () => {
    const duplicateError = Object.assign(new Error('Import aborted because of duplicates.'), {
      name: 'ImportSafetyError',
      reason: 'duplicate-day-markers',
      warnings: [],
      deletedDayIds: [],
    })
    syncActions.pullFromSyncAndRefresh.mockRejectedValueOnce(duplicateError)
    vi.stubGlobal('confirm', vi.fn(() => false))
    const { handlePull, setStatus } = useActions(false)

    await handlePull()

    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
    expect(setStatus).toHaveBeenLastCalledWith('Pull canceled. Local notes were not changed.')
  })

  it('blocks manual pull when another tab owns the primary lease', async () => {
    localStorage.setItem(
      'rivolo.sync.primary-tab',
      JSON.stringify({
        ownerId: 'another-tab',
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 20_000,
      }),
    )
    const { handlePull, setStatus } = useActions(false)

    await handlePull()

    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
    expect(setStatus).toHaveBeenLastCalledWith(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )
  })
})
