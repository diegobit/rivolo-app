// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  ProviderProfileRepository,
  ProviderProfileValidationError,
  validateProviderProfileInput,
} from '../../functions/_lib/providerProfiles'

type StoredRow = {
  profile_id: string
  provider: 'dropbox' | 'google-drive'
  provider_account_id: string
  provider_email: string | null
  provider_name: string | null
  dropbox_path: string | null
  google_file_id: string | null
  google_folder_id: string | null
  google_file_name: string | null
  time_zone: string
  encrypted_refresh_token: string
  created_at: string
  updated_at: string
  revoked_at: string | null
}

class FakeD1 {
  readonly rows = new Map<string, StoredRow>()

  prepare(sql: string) {
    return {
      bind: (...values: unknown[]) => ({
        first: async <T>() => this.first(sql, values) as T | null,
        run: async () => this.run(sql, values),
      }),
    }
  }

  private first(sql: string, values: unknown[]) {
    if (sql.includes('INSERT INTO mcp_provider_profiles')) {
      const [
        profileId,
        provider,
        providerAccountId,
        providerEmail,
        providerName,
        dropboxPath,
        googleFileId,
        googleFolderId,
        googleFileName,
        timeZone,
        encryptedRefreshToken,
        createdAt,
        updatedAt,
      ] = values as [
        string,
        StoredRow['provider'],
        string,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string,
        string,
        string,
        string,
      ]
      const existing = [...this.rows.values()].find(
        (row) =>
          row.provider === provider && row.provider_account_id === providerAccountId,
      )
      const row: StoredRow = existing
        ? {
            ...existing,
            provider_email: providerEmail,
            provider_name: providerName,
            dropbox_path: dropboxPath,
            google_file_id: googleFileId,
            google_folder_id: googleFolderId,
            google_file_name: googleFileName,
            time_zone: timeZone,
            encrypted_refresh_token: encryptedRefreshToken,
            updated_at: updatedAt,
            revoked_at: null,
          }
        : {
            profile_id: profileId,
            provider,
            provider_account_id: providerAccountId,
            provider_email: providerEmail,
            provider_name: providerName,
            dropbox_path: dropboxPath,
            google_file_id: googleFileId,
            google_folder_id: googleFolderId,
            google_file_name: googleFileName,
            time_zone: timeZone,
            encrypted_refresh_token: encryptedRefreshToken,
            created_at: createdAt,
            updated_at: updatedAt,
            revoked_at: null,
          }
      this.rows.set(row.profile_id, row)
      return row
    }

    const row = this.rows.get(String(values[0]))
    if (!row) return null
    if (sql.includes('SELECT encrypted_refresh_token')) {
      return row.revoked_at ? null : { encrypted_refresh_token: row.encrypted_refresh_token }
    }
    return row
  }

  private async run(sql: string, values: unknown[]) {
    if (!sql.includes('UPDATE mcp_provider_profiles')) {
      throw new Error(`Unexpected query: ${sql}`)
    }
    if (sql.includes('SET encrypted_refresh_token = ?')) {
      const [encryptedRefreshToken, updatedAt, profileId] = values as [
        string,
        string,
        string,
      ]
      const row = this.rows.get(profileId)
      if (!row || row.revoked_at) return { meta: { changes: 0 } }
      this.rows.set(profileId, {
        ...row,
        encrypted_refresh_token: encryptedRefreshToken,
        updated_at: updatedAt,
      })
      return { meta: { changes: 1 } }
    }
    const [updatedAt, revokedAt, profileId] = values as [string, string, string]
    const row = this.rows.get(profileId)
    if (!row || row.revoked_at) return { meta: { changes: 0 } }
    this.rows.set(profileId, {
      ...row,
      encrypted_refresh_token: '',
      updated_at: updatedAt,
      revoked_at: revokedAt,
    })
    return { meta: { changes: 1 } }
  }
}

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
    const db = new FakeD1()
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
    expect(db.rows.get(created.profileId)?.encrypted_refresh_token).not.toContain(
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
    const db = new FakeD1()
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
