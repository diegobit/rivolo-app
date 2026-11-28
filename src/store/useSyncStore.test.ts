import { beforeEach, describe, expect, it, vi } from 'vitest'
const sync = vi.hoisted(() => ({ getActiveProviderId: vi.fn(), getActiveProviderStatus: vi.fn(),
  getEmptySyncStatus: vi.fn(() => ({ connected: false, localDirty: false })), setActiveProviderId: vi.fn() }))
vi.mock('../lib/sync', () => sync)
import { useSyncStore } from './useSyncStore'

describe('sync notification lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSyncStore.setState({ activeProvider: 'dropbox',
      status: { connected: true, localDirty: false, targetName: '/old-notes.md', lastRemoteVersion: null, lastSyncAt: null, accountName: null, accountEmail: null }, syncIssues: {},
      syncAttention: { operation: 'push', message: 'Dropbox changed remotely.', at: 1 } })
    sync.getActiveProviderStatus.mockResolvedValue({ connected: true, localDirty: false, targetName: '/old-notes.md' })
  })
  it('clears Dropbox attention when disconnecting the active provider', async () => {
    sync.getActiveProviderId.mockResolvedValue(null)
    await useSyncStore.getState().loadState()
    expect(useSyncStore.getState().syncAttention).toBeNull()
  })
  it('clears old attention when activating another provider', async () => {
    await useSyncStore.getState().setActiveProvider('google-drive')
    expect(useSyncStore.getState().syncAttention).toBeNull()
  })
  it('preserves an unresolved issue during an ordinary state refresh', async () => {
    sync.getActiveProviderId.mockResolvedValue('dropbox')
    await useSyncStore.getState().loadState()
    expect(useSyncStore.getState().syncAttention?.message).toBe('Dropbox changed remotely.')
  })
  it('removes errors from the previous target after changing the target, while preserving separate current issues', async () => {
    const store = useSyncStore.getState()
    store.setSyncIssue('dropbox:/old-notes.md:files', { operation: 'push', message: 'Owner must finish migration.', at: 1 })
    store.setSyncIssue('dropbox:/old-notes.md:upgrade', { operation: 'pull', message: 'Upgrade paused.', at: 2 })
    sync.getActiveProviderId.mockResolvedValue('dropbox')
    sync.getActiveProviderStatus.mockResolvedValue({ connected: true, localDirty: false, targetName: '/Rivolo' })
    await store.loadState()
    expect(useSyncStore.getState().syncAttention).toBeNull()
    expect(useSyncStore.getState().syncIssues).toEqual({})
    store.setSyncIssue('dropbox:/Rivolo:files', { operation: 'push', message: 'Day malformed.', at: 3 })
    store.setSyncIssue('dropbox:/Rivolo:upgrade', { operation: 'pull', message: 'Upgrade paused.', at: 4 })
    store.setSyncIssue('dropbox:/Rivolo:upgrade', null)
    expect(useSyncStore.getState().syncAttention?.message).toBe('Day malformed.')
  })
})
