import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PRIMARY_LEASE_KEY = 'rivolo.sync.primary-tab'
const DATABASE_REVISION_KEY = 'rivolo.db.persisted-revision'

const loadTab = async (tabId: string) => {
  vi.stubGlobal('crypto', { randomUUID: () => tabId } as Crypto)
  vi.resetModules()
  return import('./tabSyncCoordinator')
}

describe('tab sync coordinator', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T10:00:00Z'))
    vi.stubGlobal('BroadcastChannel', undefined)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reads the block reason without claiming or rewriting the lease', async () => {
    const tabA = await loadTab('tab-a')
    expect(tabA.getTabSyncBlockReason()).toBe(tabA.SYNC_PAUSED_SECONDARY_MESSAGE)
    expect(localStorage.getItem(PRIMARY_LEASE_KEY)).toBeNull()

    expect(tabA.claimPrimaryTab()).toBe(true)
    const activeLease = localStorage.getItem(PRIMARY_LEASE_KEY)
    const tabB = await loadTab('tab-b')

    expect(tabB.getTabSyncBlockReason()).toBe(tabB.SYNC_PAUSED_SECONDARY_MESSAGE)
    expect(localStorage.getItem(PRIMARY_LEASE_KEY)).toBe(activeLease)
  })

  it('does not treat a hidden tab with an expired lease as primary', async () => {
    const visibilityState = vi.spyOn(document, 'visibilityState', 'get')
    visibilityState.mockReturnValue('visible')
    const tabA = await loadTab('tab-a')
    tabA.startPrimaryTabCoordinator()
    expect(tabA.isPrimaryTab()).toBe(true)

    visibilityState.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(20_001)

    expect(tabA.isPrimaryTab()).toBe(false)
    expect(tabA.getTabSyncSnapshot().isPrimary).toBe(false)
    expect(tabA.getTabSyncBlockReason()).toBe(tabA.SYNC_PAUSED_SECONDARY_MESSAGE)
  })

  it('allows only one tab to hold the primary lease and recovers after expiry', async () => {
    const tabA = await loadTab('tab-a')
    expect(tabA.claimPrimaryTab()).toBe(true)

    const tabB = await loadTab('tab-b')
    expect(tabB.claimPrimaryTab()).toBe(false)
    expect(tabB.isPrimaryTab()).toBe(false)

    vi.advanceTimersByTime(20_001)

    expect(tabB.claimPrimaryTab()).toBe(true)
    expect(tabA.isPrimaryTab()).toBe(false)
    expect(JSON.parse(localStorage.getItem(PRIMARY_LEASE_KEY) ?? '{}')).toMatchObject({
      ownerId: 'tab-b',
    })
  })

  it('marks a loaded snapshot stale when another tab persists', async () => {
    const tabA = await loadTab('tab-a')
    tabA.beginDatabaseSnapshotLoad()

    const tabB = await loadTab('tab-b')
    tabB.beginDatabaseSnapshotLoad()
    expect(tabB.getTabSyncSnapshot().databaseStale).toBe(false)

    tabA.broadcastDatabasePersisted()
    const persistedMessage = localStorage.getItem(DATABASE_REVISION_KEY)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: DATABASE_REVISION_KEY,
        newValue: persistedMessage,
        storageArea: localStorage,
      }),
    )

    expect(tabB.getTabSyncSnapshot().databaseStale).toBe(true)
    expect(() => tabB.assertDatabaseWritable()).toThrow(tabB.DATABASE_STALE_RELOAD_MESSAGE)
  })
})
