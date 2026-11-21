// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

// Owner: migration 0006 rebuilds the profiles table. Dropping a parent table
// cascades into every child table, so a wrong rebuild silently revokes every
// agent's tokens and grants, or loses the revoke triggers.
const directory = fileURLToPath(new URL('../../migrations/', import.meta.url))
const migrations = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
const apply = (db: DatabaseSync, predicate: (name: string) => boolean) => {
  for (const name of migrations.filter(predicate)) db.exec(readFileSync(`${directory}/${name}`, 'utf8'))
}
const profileId = '11111111-1111-4111-8111-111111111111'
const count = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count

describe('migration 0006', () => {
  it('keeps existing tokens, grants and write records, and still revokes them with the profile', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    apply(db, (name) => name < '0006')
    db.exec(`
      INSERT INTO mcp_provider_profiles (
        profile_id, provider, provider_account_id, dropbox_path, time_zone,
        encrypted_refresh_token, created_at, updated_at, daily_folder_id
      ) VALUES ('${profileId}', 'dropbox', 'dbid:1', '/inbox.md', 'UTC', 'secret',
        '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 'id:daily');
      INSERT INTO mcp_personal_tokens (token_id, profile_id, name, token_hash, token_prefix, created_at)
      VALUES ('token-1', '${profileId}', 'Laptop', '${'a'.repeat(64)}', 'rvl_abcd', '2026-01-02T00:00:00.000Z');
      INSERT INTO mcp_write_operations (profile_id, operation_id, input_hash, state, result_json, created_at, updated_at)
      VALUES ('${profileId}', 'op-1', 'hash', 'completed', '{}', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z');
      INSERT INTO mcp_oauth_clients (client_id, registration_hash, redirect_uris, created_at)
      VALUES ('client-1', '${'b'.repeat(64)}', '[]', '2026-01-01T00:00:00.000Z');
      INSERT INTO mcp_oauth_authorization_codes (code_hash, profile_id, client_id, redirect_uri, code_challenge, scopes, resource, created_at, expires_at)
      VALUES ('${'c'.repeat(64)}', '${profileId}', 'client-1', 'https://cb', 'challenge', 'notes:read', 'https://mcp', '2026-01-01T00:00:00.000Z', '2026-01-01T00:05:00.000Z');
      INSERT INTO mcp_oauth_token_families (family_id, profile_id, client_id, resource, created_at)
      VALUES ('family-1', '${profileId}', 'client-1', 'https://mcp', '2026-01-01T00:00:00.000Z');
      INSERT INTO mcp_oauth_token_grants (grant_id, family_id, access_token_hash, refresh_token_hash, scopes, created_at, access_expires_at, refresh_expires_at)
      VALUES ('grant-1', 'family-1', '${'d'.repeat(64)}', '${'e'.repeat(64)}', 'notes:read', '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z', '2026-01-31T00:00:00.000Z');
    `)

    apply(db, (name) => name >= '0006')

    for (const table of ['mcp_provider_profiles', 'mcp_personal_tokens', 'mcp_write_operations',
      'mcp_oauth_authorization_codes', 'mcp_oauth_token_families', 'mcp_oauth_token_grants']) {
      expect(count(db, table), table).toBe(1)
    }
    expect(db.prepare('SELECT daily_folder_id, updated_at, credential_refreshed_at FROM mcp_provider_profiles').get())
      .toEqual({ daily_folder_id: 'id:daily', updated_at: '2026-02-01T00:00:00.000Z', credential_refreshed_at: '2026-02-01T00:00:00.000Z' })
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'mcp_v6_%' OR name LIKE '%_v6'").all()).toEqual([])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])

    db.exec(`UPDATE mcp_provider_profiles SET revoked_at = '2026-03-01T00:00:00.000Z' WHERE profile_id = '${profileId}'`)
    expect(db.prepare('SELECT revoked_at FROM mcp_personal_tokens').get()).toEqual({ revoked_at: '2026-03-01T00:00:00.000Z' })
    expect(db.prepare('SELECT revoked_at FROM mcp_oauth_token_families').get()).toEqual({ revoked_at: '2026-03-01T00:00:00.000Z' })
    // Deleting the profile still cascades into the restored child tables.
    db.exec(`DELETE FROM mcp_provider_profiles WHERE profile_id = '${profileId}'`)
    expect(count(db, 'mcp_personal_tokens') + count(db, 'mcp_oauth_token_grants')).toBe(0)
    db.close()
  })

  it('accepts a OneDrive profile only with its folder and name, and no file target', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    apply(db, () => true)
    const insert = (columns: string, values: string) => db.exec(`
      INSERT INTO mcp_provider_profiles (
        profile_id, provider, provider_account_id, time_zone, encrypted_refresh_token, created_at, updated_at, ${columns}
      ) VALUES ('${crypto.randomUUID()}', 'onedrive', '${crypto.randomUUID()}', 'UTC', 'secret', 'now', 'now', ${values})`)

    insert('daily_folder_id, onedrive_folder_name', "'/drives/d/items/i', 'Rivolo'")
    expect(() => insert('daily_folder_id', "'/drives/d/items/i'")).toThrow(/CHECK/)
    expect(() => insert('daily_folder_id, onedrive_folder_name, dropbox_path', "'/drives/d/items/i', 'Rivolo', '/x.md'")).toThrow(/CHECK/)
    db.close()
  })
})
