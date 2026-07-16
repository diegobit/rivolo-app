import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncProviderId } from '../../lib/sync'
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

const setupActions = (localDirty: boolean) => {
  const setStatus = vi.fn()
  const loadProviderStates = vi.fn(async () => undefined)
  const loadSyncState = vi.fn(async () => undefined)
  const setActiveProvider = vi.fn(async () => undefined)
  const { result, rerender } = renderHook(
    ({ provider }: { provider: SyncProviderId }) =>
      useSyncProviderActions({
        provider,
        activeProvider: provider,
        connected: true,
        localDirty,
        online: true,
        setStatus,
        loadProviderStates,
        loadSyncState,
        setActiveProvider,
      }),
    { initialProps: { provider: 'dropbox' as SyncProviderId } },
  )

  return { result, rerender, loadProviderStates, setStatus }
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
    const { result, setStatus } = setupActions(true)

    await act(() => result.current.handlePull())

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
    const { result, setStatus } = setupActions(false)

    await act(() => result.current.handlePull())

    expect(confirm).not.toHaveBeenCalled()
    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledExactlyOnceWith({
      force: false,
      allowUnsafeImport: false,
    })
    expect(setStatus).toHaveBeenLastCalledWith(
      'Import blocked: it would delete 2 local day(s). Use “Force pull (overwrite local)” to replace local notes anyway — a rollback backup is saved first.',
    )
    // The refusal is real state, so the Advanced panel can reveal Force pull.
    expect(result.current.pullRefused).toBe(true)
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
    const { result, setStatus } = setupActions(false)

    await act(() => result.current.handlePull())

    expect(confirm).not.toHaveBeenCalled()
    expect(setStatus).toHaveBeenLastCalledWith('Import aborted: the file contains no day markers.')
    expect(result.current.pullRefused).toBe(false)
  })

  it('marks the pull refused on a dirty pull and clears it once the force pull succeeds', async () => {
    const { result } = setupActions(true)
    expect(result.current.pullRefused).toBe(false)

    await act(() => result.current.handlePull())
    expect(result.current.pullRefused).toBe(true)

    await act(() => result.current.handleForcePull())
    expect(result.current.pullRefused).toBe(false)
  })

  it.each(['remote_changed', 'remote_missing'] as const)(
    'marks the push blocked on %s and clears it once a push succeeds',
    async (reason) => {
      syncActions.pushToSyncAndRefresh.mockResolvedValueOnce({ status: 'blocked', reason })
      const { result, setStatus } = setupActions(false)
      expect(result.current.pushBlocked).toBe(false)

      await act(() => result.current.handlePush())
      expect(result.current.pushBlocked).toBe(true)
      expect(setStatus).toHaveBeenLastCalledWith(`blocked: ${reason}`)

      syncActions.pushToSyncAndRefresh.mockResolvedValueOnce({ status: 'pushed' })
      await act(() => result.current.handlePush(true))
      expect(result.current.pushBlocked).toBe(false)
    },
  )

  it('a successful pull clears a prior blocked-push reveal', async () => {
    syncActions.pushToSyncAndRefresh.mockResolvedValueOnce({
      status: 'blocked',
      reason: 'remote_changed',
    })
    const { result } = setupActions(false)

    await act(() => result.current.handlePush())
    expect(result.current.pushBlocked).toBe(true)

    await act(() => result.current.handlePull())
    expect(result.current.pushBlocked).toBe(false)
  })

  it('forgets refusals when the panel switches provider', async () => {
    const { result, rerender } = setupActions(true)

    await act(() => result.current.handlePull())
    expect(result.current.pullRefused).toBe(true)

    rerender({ provider: 'google-drive' })
    expect(result.current.pullRefused).toBe(false)
  })

  it('force pull passes force and allowUnsafeImport even while dirty', async () => {
    const { result, loadProviderStates, setStatus } = setupActions(true)

    await act(() => result.current.handleForcePull())

    expect(syncActions.pullFromSyncAndRefresh).toHaveBeenCalledExactlyOnceWith({
      force: true,
      allowUnsafeImport: true,
    })
    expect(loadProviderStates).toHaveBeenCalledOnce()
    expect(setStatus).toHaveBeenLastCalledWith('Pulled and imported.')
  })

  it('force pull also works with a clean local copy', async () => {
    const { result, setStatus } = setupActions(false)

    await act(() => result.current.handleForcePull())

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
    const dirty = setupActions(true)
    const clean = setupActions(false)

    await act(() => dirty.result.current.handlePull())
    await act(() => dirty.result.current.handleForcePull())
    await act(() => clean.result.current.handlePull())
    await act(() => clean.result.current.handlePush())
    await act(() => clean.result.current.handlePush(true))

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
    const { result, setStatus } = setupActions(false)

    await act(() => result.current.handlePull())

    expect(syncActions.pullFromSyncAndRefresh).not.toHaveBeenCalled()
    expect(setStatus).toHaveBeenLastCalledWith(
      'Sync is paused in this tab because another Rivolo tab is active.',
    )
  })
})
