import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncProviderActions } from './useSyncProviderActions'

const syncActions = vi.hoisted(() => ({
  pullFromSyncAndRefresh: vi.fn(),
  pushToSyncAndRefresh: vi.fn(),
  blockedPushMessage: vi.fn((reason: string) => `blocked: ${reason}`),
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
      allowUnsafeImport: true,
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

  it('confirms past an import safety block and retries the pull once', async () => {
    const safetyError = Object.assign(
      new Error('Import blocked: it would delete 2 local day(s).'),
      {
        name: 'ImportSafetyError',
        reasons: ['duplicate-day-markers', 'would-delete-local-days'],
        warnings: [],
        deletedDayIds: ['2026-06-28', '2026-06-27'],
      },
    )
    syncActions.pullFromSyncAndRefresh
      .mockRejectedValueOnce(safetyError)
      .mockResolvedValueOnce({ status: 'pulled' })
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const { handlePull, setStatus } = useActions(false)

    await handlePull()

    expect(confirm).toHaveBeenCalledWith(
      'Import blocked: it would delete 2 local day(s). Replace local notes anyway? A rollback backup will be saved first.',
    )
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenLastCalledWith({
      force: false,
      allowUnsafeImport: true,
    })
    expect(setStatus).toHaveBeenLastCalledWith('Pulled and imported.')
  })

  it('cancels the import safety override without importing', async () => {
    const safetyError = Object.assign(new Error('Import blocked: duplicates.'), {
      name: 'ImportSafetyError',
      reasons: ['duplicate-day-markers'],
      warnings: [],
      deletedDayIds: [],
    })
    syncActions.pullFromSyncAndRefresh.mockRejectedValueOnce(safetyError)
    vi.stubGlobal('confirm', vi.fn(() => false))
    const { handlePull, setStatus } = useActions(false)

    await handlePull()

    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
    expect(setStatus).toHaveBeenLastCalledWith('Pull canceled. Local notes were not changed.')
  })

  it('does not offer an override for a zero-marker remote file', async () => {
    const safetyError = Object.assign(
      new Error('Import aborted: the file contains no day markers.'),
      {
        name: 'ImportSafetyError',
        reasons: ['no-day-markers'],
        warnings: [],
        deletedDayIds: [],
      },
    )
    syncActions.pullFromSyncAndRefresh.mockRejectedValueOnce(safetyError)
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const { handlePull, setStatus } = useActions(false)

    await handlePull()

    expect(confirm).not.toHaveBeenCalled()
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
    expect(setStatus).toHaveBeenLastCalledWith('Import aborted: the file contains no day markers.')
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
