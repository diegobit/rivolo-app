// @vitest-environment node
import { McpPersonalTokenRepository, authenticateMcpBearer } from '../../functions/_lib/mcpPersonalTokens'
import type { ProviderProfileInput } from '../../functions/_lib/providerProfiles'
import { SqliteD1, closeTestDatabases } from './helpers/d1'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ProviderProfileRepository,
  ProviderProfileValidationError,
  validateProviderProfileInput,
} from '../../functions/_lib/providerProfiles'

describe('provider profile persistence', () => {
  it('normalizes typed provider targets and rejects invalid inputs', () => {
    expect(
      validateProviderProfileInput({
        provider: 'google-drive',
        providerAccountId: ' account-1 ',
        providerEmail: 'user@example.com',
        providerName: '',
        target: { fileId: 'file-1', fileName: 'inbox.md' },
        timeZone: 'Europe/Rome',
        refreshToken: 'refresh-token',
      }),
    ).toMatchObject({
      providerAccountId: 'account-1',
      providerName: null,
      target: { fileId: 'file-1', folderId: null, fileName: 'inbox.md' },
    })

    expect(() =>
      validateProviderProfileInput({
        provider: 'dropbox',
        providerAccountId: 'account-1',
        target: { path: 'relative/inbox.md' },
        timeZone: 'Europe/Rome',
        refreshToken: 'refresh-token',
      }),
    ).toThrow(ProviderProfileValidationError)
    expect(() =>
      validateProviderProfileInput({
        provider: 'dropbox',
        providerAccountId: 'account-1',
        target: { path: '/inbox.md' },
        timeZone: 'Local/Rivolo',
        refreshToken: 'refresh-token',
      }),
    ).toThrow('timeZone must be an IANA time zone.')
  })

  it('updates and reactivates one profile per provider account', async () => {
    const db = new SqliteD1()
    const timestamps = [
      new Date('2026-07-16T08:00:00.000Z'),
      new Date('2026-07-16T09:00:00.000Z'),
      new Date('2026-07-16T10:00:00.000Z'),
    ]
    const repository = new ProviderProfileRepository(
      db as unknown as D1Database,
      'test-encryption-secret',
      () => timestamps.shift() ?? new Date('2026-07-16T11:00:00.000Z'),
      () => crypto.randomUUID(),
    )

    const created = await repository.createOrUpdate({
      provider: 'dropbox',
      providerAccountId: 'dbid:account-1',
      providerEmail: 'first@example.com',
      target: { path: '/inbox.md' },
      timeZone: 'Europe/Rome',
      refreshToken: 'first-refresh-token',
    })

    expect(created.target).toEqual({ path: '/inbox.md' })
    expect(await repository.decryptCredential(created.profileId)).toBe(
      'first-refresh-token',
    )
    expect(db.get('SELECT encrypted_refresh_token FROM mcp_provider_profiles WHERE profile_id = ?', created.profileId)?.encrypted_refresh_token).not.toContain(
      'first-refresh-token',
    )
    await repository.updateCredential(created.profileId, 'rotated-refresh-token')
    expect(await repository.decryptCredential(created.profileId)).toBe(
      'rotated-refresh-token',
    )
    expect(await repository.revoke(created.profileId)).toBe(true)
    expect(await repository.decryptCredential(created.profileId)).toBeNull()

    const reenabled = await repository.createOrUpdate({
      provider: 'dropbox',
      providerAccountId: 'dbid:account-1',
      providerEmail: 'updated@example.com',
      target: { path: '/journal/inbox.md' },
      timeZone: 'Europe/London',
      refreshToken: 'replacement-refresh-token',
    })

    expect(reenabled).toMatchObject({
      profileId: created.profileId,
      providerEmail: 'updated@example.com',
      target: { path: '/journal/inbox.md' },
      timeZone: 'Europe/London',
      revokedAt: null,
      createdAt: '2026-07-16T08:00:00.000Z',
      updatedAt: '2026-07-16T11:00:00.000Z',
    })
    expect(await repository.decryptCredential(created.profileId)).toBe(
      'replacement-refresh-token',
    )
    expect(await repository.getMetadata(created.profileId)).toEqual(reenabled)
  })

  it('returns typed Google Drive metadata without exposing the stored credential', async () => {
    const db = new SqliteD1()
    const repository = new ProviderProfileRepository(
      db as unknown as D1Database,
      'test-encryption-secret',
      () => new Date('2026-07-16T08:00:00.000Z'),
      () => '11111111-1111-4111-8111-111111111111',
    )

    const profile = await repository.createOrUpdate({
      provider: 'google-drive',
      providerAccountId: 'google-account-1',
      target: {
        fileId: 'drive-file-1',
        folderId: 'drive-folder-1',
        fileName: 'inbox.md',
      },
      timeZone: 'Europe/Rome',
      refreshToken: 'google-refresh-token',
    })

    expect(profile).toMatchObject({
      provider: 'google-drive',
      target: {
        fileId: 'drive-file-1',
        folderId: 'drive-folder-1',
        fileName: 'inbox.md',
      },
    })
    expect(profile).not.toHaveProperty('refreshToken')
    expect(profile).not.toHaveProperty('encryptedRefreshToken')
    expect(await repository.decryptCredential(profile.profileId)).toBe(
      'google-refresh-token',
    )
  })
})

afterEach(closeTestDatabases)

it.each(['dropbox', 'google-drive'] as const)(
  '%s requires disabling access before retargeting and keeps old tokens revoked',
  async (provider) => {
    const db = new SqliteD1()
    try {
      const env = { MCP_DB: db as unknown as D1Database, MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: 'review-test-secret' }
      const profiles = new ProviderProfileRepository(db as unknown as D1Database, env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY)
      const base = {
        providerAccountId: 'account-1',
        timeZone: 'Europe/Rome',
        refreshToken: 'review-refresh-token',
      }
      const input: ProviderProfileInput = provider === 'dropbox'
        ? { ...base, provider, target: { path: '/inbox.md' } }
        : { ...base, provider, target: { fileId: 'file-1', fileName: 'inbox.md' } }
      const nextInput: ProviderProfileInput = provider === 'dropbox'
        ? { ...base, provider, target: { path: '/private.md' } }
        : { ...base, provider, target: { fileName: 'inbox.md', fileId: 'private-file' } }
      const profile = await profiles.createOrUpdate(input)
      const token = await new McpPersonalTokenRepository(db as unknown as D1Database).create(profile.profileId, 'First browser agent')
      const request = new Request('https://mcp.rivolo.app/mcp', {
        headers: { Authorization: `Bearer ${token.token}` },
      })

      await expect(profiles.createOrUpdate(nextInput)).rejects.toThrow('Disable Agent access')
      expect((await profiles.getMetadata(profile.profileId))?.target).toMatchObject(input.target)
      // Reconnecting to the same file remains harmless and keeps grants valid.
      await profiles.createOrUpdate({ ...input, refreshToken: 'refreshed-credential' })
      expect(await authenticateMcpBearer(request, env)).not.toBeNull()

      await profiles.revoke(profile.profileId)
      const retargeted = await profiles.createOrUpdate(nextInput)
      expect(retargeted.target).toMatchObject(nextInput.target)
      expect(await authenticateMcpBearer(request, env)).toBeNull()
    } finally {
      db.close()
    }
  },
)
