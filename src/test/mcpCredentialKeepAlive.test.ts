// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshIdleOneDriveCredentials } from '../../functions/_lib/mcpCredentialKeepAlive'
import { ProviderProfileRepository, type ProviderProfileInput } from '../../functions/_lib/providerProfiles'
import { SqliteD1, closeTestDatabases } from './helpers/d1'

// Owner: Agent access must outlive Microsoft's 90-day idle expiry while an
// agent uses it, and abandoned OneDrive credentials must still lapse.
const SECRET = 'keepalive-secret'
const NOW = new Date('2026-06-01T03:00:00.000Z')
const daysBefore = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

const setup = async () => {
  const db = new SqliteD1()
  const create = async (account: string, created: Date, input: Partial<ProviderProfileInput> = {}) => {
    const profiles = new ProviderProfileRepository(db as unknown as D1Database, SECRET, () => created)
    return profiles.createOrUpdate({
      provider: 'onedrive',
      providerAccountId: account,
      target: { folder: `/drives/d/items/${account}`, folderName: 'Rivolo' },
      timeZone: 'UTC',
      refreshToken: `${account}-refresh`,
      ...input,
    } as ProviderProfileInput)
  }
  const personalToken = (profileId: string, lastUsed: Date | null, created = daysBefore(200)) => db.database.prepare(`
    INSERT INTO mcp_personal_tokens (token_id, profile_id, name, token_hash, token_prefix, created_at, last_used_at)
    VALUES (?, ?, 'Agent', ?, 'rvl_test', ?, ?)`).run(
    crypto.randomUUID(), profileId, crypto.randomUUID().replace(/-/g, '').padEnd(64, '0'), created.toISOString(), lastUsed?.toISOString() ?? null)
  const oauthGrant = (profileId: string, created: Date) => {
    const family = crypto.randomUUID()
    db.database.prepare(`INSERT OR IGNORE INTO mcp_oauth_clients (client_id, registration_hash, redirect_uris, created_at)
      VALUES ('client', '${'f'.repeat(64)}', '[]', '2026-01-01T00:00:00.000Z')`).run()
    db.database.prepare(`INSERT INTO mcp_oauth_token_families (family_id, profile_id, client_id, resource, created_at)
      VALUES (?, ?, 'client', 'https://mcp', ?)`).run(family, profileId, created.toISOString())
    db.database.prepare(`INSERT INTO mcp_oauth_token_grants (grant_id, family_id, access_token_hash, refresh_token_hash, scopes, created_at, access_expires_at, refresh_expires_at)
      VALUES (?, ?, ?, ?, 'notes:read', ?, ?, ?)`).run(crypto.randomUUID(), family,
      crypto.randomUUID().replace(/-/g, '').padEnd(64, '1'), crypto.randomUUID().replace(/-/g, '').padEnd(64, '2'),
      created.toISOString(), created.toISOString(), created.toISOString())
  }
  const credential = (profileId: string) =>
    new ProviderProfileRepository(db as unknown as D1Database, SECRET).decryptCredential(profileId)
  return { db, create, personalToken, oauthGrant, credential }
}

afterEach(closeTestDatabases)

describe('OneDrive credential keep-alive', () => {
  it('refreshes stale credentials of profiles an agent still uses, and leaves the rest to expire', async () => {
    const { db, create, personalToken, oauthGrant, credential } = await setup()
    const personal = await create('personal', daysBefore(45))
    personalToken(personal.profileId, daysBefore(60))
    const oauth = await create('oauth', daysBefore(45))
    oauthGrant(oauth.profileId, daysBefore(10))
    const abandoned = await create('abandoned', daysBefore(45))
    personalToken(abandoned.profileId, daysBefore(120))
    const fresh = await create('fresh', daysBefore(5))
    personalToken(fresh.profileId, daysBefore(1))
    const revoked = await create('revoked', daysBefore(45))
    personalToken(revoked.profileId, daysBefore(1))
    await new ProviderProfileRepository(db as unknown as D1Database, SECRET, () => daysBefore(40)).revoke(revoked.profileId)
    const dropbox = await create('dropbox', daysBefore(45), { provider: 'dropbox', target: { path: '/inbox.md' } })
    personalToken(dropbox.profileId, daysBefore(1))

    const refresh = vi.fn(async (token: string) => ({ refresh_token: `${token}-next` }))
    const stats = await refreshIdleOneDriveCredentials(db as unknown as D1Database, SECRET, refresh, { now: () => NOW })

    expect(stats).toEqual({ due: 2, refreshed: 2, failed: 0 })
    expect(refresh.mock.calls.map(([token]) => token).sort()).toEqual(['oauth-refresh', 'personal-refresh'])
    expect(await credential(personal.profileId)).toBe('personal-refresh-next')
    expect(await credential(oauth.profileId)).toBe('oauth-refresh-next')
    expect(await credential(abandoned.profileId)).toBe('abandoned-refresh')
    expect(await credential(fresh.profileId)).toBe('fresh-refresh')
    // Refreshing is not a Settings change.
    expect(db.get('SELECT updated_at, credential_refreshed_at FROM mcp_provider_profiles WHERE profile_id = ?', personal.profileId))
      .toEqual({ updated_at: daysBefore(45).toISOString(), credential_refreshed_at: NOW.toISOString() })

    // The next run finds nothing due.
    refresh.mockClear()
    expect(await refreshIdleOneDriveCredentials(db as unknown as D1Database, SECRET, refresh, { now: () => NOW }))
      .toEqual({ due: 0, refreshed: 0, failed: 0 })
  })

  it('takes the stalest profiles first within the per-run limit and survives a failed refresh', async () => {
    const { db, create, personalToken, credential } = await setup()
    const older = await create('older', daysBefore(80))
    const middle = await create('middle', daysBefore(60))
    const newer = await create('newer', daysBefore(40))
    for (const profile of [older, middle, newer]) personalToken(profile.profileId, null, daysBefore(70))
    const refresh = vi.fn(async (token: string) => {
      if (token === 'older-refresh') throw Object.assign(new Error('expired'), { code: 'invalid_grant' })
      return {}
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const stats = await refreshIdleOneDriveCredentials(db as unknown as D1Database, SECRET, refresh, { now: () => NOW, limit: 2 })

    expect(stats).toEqual({ due: 2, refreshed: 1, failed: 1 })
    expect(refresh.mock.calls.map(([token]) => token)).toEqual(['older-refresh', 'middle-refresh'])
    // A response without a new token still records the refresh.
    expect(await credential(middle.profileId)).toBe('middle-refresh')
    expect(db.get('SELECT credential_refreshed_at FROM mcp_provider_profiles WHERE profile_id = ?', middle.profileId)?.credential_refreshed_at)
      .toBe(NOW.toISOString())
    expect(await credential(older.profileId)).toBe('older-refresh')
  })

  it('does not let a rejected grant hold its slot ahead of healthy credentials on later runs', async () => {
    const { db, create, personalToken, credential } = await setup()
    const dead = await create('dead', daysBefore(80))
    const healthy = await create('healthy', daysBefore(60))
    for (const profile of [dead, healthy]) personalToken(profile.profileId, daysBefore(10))
    const refresh = vi.fn(async (token: string) => {
      if (token === 'dead-refresh') throw Object.assign(new Error('expired'), { code: 'invalid_grant' })
      return { refresh_token: `${token}-next` }
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const run = (now: Date) => refreshIdleOneDriveCredentials(db as unknown as D1Database, SECRET, refresh, { now: () => now, limit: 1 })

    expect(await run(NOW)).toEqual({ due: 1, refreshed: 0, failed: 1 })
    expect(await run(new Date(NOW.getTime() + 24 * 60 * 60 * 1000))).toEqual({ due: 1, refreshed: 1, failed: 0 })

    expect(refresh.mock.calls.map(([token]) => token)).toEqual(['dead-refresh', 'healthy-refresh'])
    expect(await credential(healthy.profileId)).toBe('healthy-refresh-next')
  })
})
