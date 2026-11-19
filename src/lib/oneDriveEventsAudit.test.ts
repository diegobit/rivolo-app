// Regression tests from the OneDrive audit (2026-11-12): live-update outbox
// and access token refresh.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ persist: vi.fn(async () => {}), rows: [] as { item: string; value: string; entry: { context: string; event: object } }[], fetch: vi.fn() }))
vi.mock('./oneDriveDailyState', () => ({
  assertTarget: async () => {}, persistDailyCheckpoint: state.persist,
  readDailyOutbox: async () => [...state.rows],
  acknowledgeDailyEvent: async (_context: string, item: string) => { state.rows = state.rows.filter((row) => row.item !== item) },
}))
const target = { folder: '/drives/d/items/notebook', account: 'alice', generation: 1 }
const row = (item: string, dayId: string) => ({ item, value: dayId, entry: { context: 'c', event: { type: 'day-changed', dayId, item, revision: 'v2' } } })

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); state.persist.mockClear(); state.fetch.mockReset(); state.rows = [] })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock('./oneDriveAuth'); vi.doUnmock('./dropboxAuth') })

describe('daily event outbox', () => {
  beforeEach(() => { vi.doMock('./oneDriveAuth', () => ({ authorizedOneDriveFetch: state.fetch })) })

  it('does not save the whole database when there is nothing to publish', async () => {
    await (await import('./oneDriveEvents')).flushDailyOneDriveEvents(target)
    expect(state.persist).not.toHaveBeenCalled() // measured: 2 saves after every push and pull
  })

  it('a notification the relay permanently rejects does not block the ones queued after it', async () => {
    state.rows = [row('/drives/d/items/moved', '2026-09-30'), row('/drives/d/items/today', '2026-10-01')]
    state.fetch.mockImplementation(async (_url: string, init: RequestInit) => String(init.body).includes('/items/moved')
      ? Response.json({ message: 'This file is outside the notebook day hierarchy.' }, { status: 403 })
      : new Response(null, { status: 204 }))
    await (await import('./oneDriveEvents')).flushDailyOneDriveEvents(target)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(state.rows.map((entry) => entry.item)).not.toContain('/drives/d/items/today')
  })
})

// The outbox dispatcher owns keeping the same provider and account guard
// across a scheduled retry after a transient relay outage.
it('retries a Dropbox notice with the Dropbox provider and original guard', async () => {
  vi.doMock('./dropboxAuth', () => ({ authorizedDropboxFetch: state.fetch }))
  state.rows = [row('id:today', '2026-10-01')]
  state.fetch.mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 204 }))
  const dropbox = { provider: 'dropbox' as const, account: 'alice', folder: 'id:notebook', generation: 1 }
  const guard = vi.fn(async () => {})
  await (await import('./oneDriveEvents')).flushDailyEvents(dropbox, guard)
  expect(state.rows).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(state.rows).toHaveLength(0)
  expect(state.fetch).toHaveBeenCalledTimes(2)
  expect(state.fetch).toHaveBeenLastCalledWith('/api/sync/daily-events',
    expect.objectContaining({ body: expect.stringContaining('"provider":"dropbox"') }))
  expect(guard.mock.calls.length).toBeGreaterThan(1)
})

describe('access token refresh', () => {
  it('shares one refresh between requests that start together', async () => {
    vi.doMock('./oneDriveState', () => ({ getOneDriveState: vi.fn(), updateOneDriveState: vi.fn() }))
    const tokenFetch = vi.fn(async () => Response.json({ accessToken: 'token', expiresAt: Date.now() + 3_600_000 }))
    vi.stubGlobal('fetch', tokenFetch)
    const { getOneDriveAccessToken } = await import('./oneDriveAuth')
    await Promise.all([getOneDriveAccessToken(), getOneDriveAccessToken(), getOneDriveAccessToken()])
    expect(tokenFetch).toHaveBeenCalledTimes(1) // measured: 3
  })
})
