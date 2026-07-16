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

  it('never force-imports on a dirty manual pull; points at Force pull instead', async () => {
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const { handlePull, setStatus } = useActions(true)

    await handlePull()

    expect(confirm).not.toHaveBeenCalled()
    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
    expect(setStatus).toHaveBeenLastCalledWith(
      'You have unsynced local edits here. Use “Force pull (overwrite local)” to replace them with the Dropbox copy — a rollback backup is saved first.',
    )
  })

  it('points a safety-blocked pull at Force pull instead of a browser confirm', async () => {
    const safetyError = Object.assign(
      new Error('Import blocked: it would delete 2 local day(s).'),
      {
        name: 'ImportSafetyError',
        reasons: ['duplicate-day-markers', 'would-delete-local-days'],
        warnings: [],
        deletedDayIds: ['2026-06-28', '2026-06-27'],
      },
    )
    syncActions.pullFromSyncAndRefresh.mockRejectedValueOnce(safetyError)
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const { handlePull, setStatus } = useActions(false)

    await handlePull()

    expect(confirm).not.toHaveBeenCalled()
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledExactlyOnceWith({
      force: false,
      allowUnsafeImport: false,
    })
    expect(setStatus).toHaveBeenLastCalledWith(
      'Import blocked: it would delete 2 local day(s). Use “Force pull (overwrite local)” to replace local notes anyway — a rollback backup is saved first.',
    )
  })

  it('does not point a zero-marker remote file at Force pull', async () => {
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
    expect(setStatus).toHaveBeenLastCalledWith('Import aborted: the file contains no day markers.')
  })

  it('force pull passes force and allowUnsafeImport even while dirty', async () => {
    const { handleForcePull, loadProviderStates, setStatus } = useActions(true)

    await handleForcePull()

    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledExactlyOnceWith({
      force: true,
      allowUnsafeImport: true,
    })
    expect(loadProviderStates).toHaveBeenCalledOnce()
    expect(setStatus).toHaveBeenLastCalledWith('Pulled and imported.')
  })

  it('force pull also works with a clean local copy', async () => {
    const { handleForcePull, setStatus } = useActions(false)

    await handleForcePull()

    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledExactlyOnceWith({
      force: true,
      allowUnsafeImport: true,
    })
    expect(setStatus).toHaveBeenLastCalledWith('Pulled and imported.')
  })

  it('no sync flow ever opens a window.confirm dialog', async () => {
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    syncActions.pushToSyncAndRefresh.mockResolvedValue({ status: 'pushed' })
    const dirty = useActions(true)
    const clean = useActions(false)

    await dirty.handlePull()
    await dirty.handleForcePull()
    await clean.handlePull()
    await clean.handlePush()
    await clean.handlePush(true)

    expect(confirm).not.toHaveBeenCalled()
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
