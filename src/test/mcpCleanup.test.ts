// @vitest-environment node
import { SqliteD1, closeTestDatabases } from './helpers/d1'
import type { D1Database, ExecutionContext, ScheduledController } from '@cloudflare/workers-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runMcpD1Cleanup } from '../../functions/_lib/mcpCleanup'
import worker, { type RemoteMcpEnv } from '../../mcp/worker'

const createFixtures = (db: SqliteD1) => {
  db.database.exec(`
    -- Insert mock profile and client
    INSERT INTO mcp_provider_profiles (
      profile_id, provider, provider_account_id, provider_email, provider_name,
      dropbox_path, time_zone, encrypted_refresh_token, created_at, updated_at, revoked_at
    ) VALUES (
      '11111111-1111-4111-8111-111111111111', 'dropbox', 'dbid:123',
      'user@example.com', 'Test User', '/Notes', 'UTC', 'encrypted-secret',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
    );

    INSERT INTO mcp_oauth_clients (
      client_id, registration_hash, redirect_uris, client_name, created_at
    ) VALUES (
      'client-1', '0000000000000000000000000000000000000000000000000000000000000001',
      '["https://client.example.com/cb"]', 'Test Client', '2026-01-01T00:00:00.000Z'
    );
  `)
}

describe('runMcpD1Cleanup', () => {
  it('purges expired authorization codes older than cutoff', async () => {
    const db = new SqliteD1()
    createFixtures(db)
    const now = new Date('2026-06-01T12:00:00.000Z')

    // Expired 48 hours ago (older than 24h default) -> should be purged
    // Expired 2 hours ago (within 24h retention) -> should be kept
    // Valid for 2 hours -> should be kept
    db.database.exec(`
      INSERT INTO mcp_oauth_authorization_codes (
        code_hash, profile_id, client_id, redirect_uri, code_challenge,
        scopes, resource, created_at, expires_at, used_at
      ) VALUES
      (
        '1111111111111111111111111111111111111111111111111111111111111111',
        '11111111-1111-4111-8111-111111111111', 'client-1',
        'https://client.example.com/cb', 'challenge1', 'notes:read',
        'https://mcp.rivolo.app/mcp', '2026-05-30T10:00:00.000Z',
        '2026-05-30T10:10:00.000Z', NULL
      ),
      (
        '2222222222222222222222222222222222222222222222222222222222222222',
        '11111111-1111-4111-8111-111111111111', 'client-1',
        'https://client.example.com/cb', 'challenge2', 'notes:read',
        'https://mcp.rivolo.app/mcp', '2026-06-01T09:00:00.000Z',
        '2026-06-01T09:10:00.000Z', NULL
      ),
      (
        '3333333333333333333333333333333333333333333333333333333333333333',
        '11111111-1111-4111-8111-111111111111', 'client-1',
        'https://client.example.com/cb', 'challenge3', 'notes:read',
        'https://mcp.rivolo.app/mcp', '2026-06-01T11:55:00.000Z',
        '2026-06-01T12:05:00.000Z', NULL
      );
    `)

    const stats = await runMcpD1Cleanup(db as unknown as D1Database, { now })

    expect(stats.deletedAuthorizationCodes).toBe(1)

    const remaining = (
      db.database
        .prepare('SELECT code_hash FROM mcp_oauth_authorization_codes ORDER BY code_hash')
        .all() as { code_hash: string }[]
    ).map((r) => r.code_hash)

    expect(remaining).toEqual([
      '2222222222222222222222222222222222222222222222222222222222222222',
      '3333333333333333333333333333333333333333333333333333333333333333',
    ])
  })

  it('purges revoked and fully expired token families with their grants', async () => {
    const db = new SqliteD1()
    createFixtures(db)
    const now = new Date('2026-06-01T12:00:00.000Z')

    // 1. Revoked family older than 30 days (revoked 45 days ago) -> should be purged
    db.database.exec(`
      INSERT INTO mcp_oauth_token_families (
        family_id, profile_id, client_id, resource, created_at, revoked_at
      ) VALUES (
        'family-old-revoked', '11111111-1111-4111-8111-111111111111',
        'client-1', 'https://mcp.rivolo.app/mcp',
        '2026-04-10T00:00:00.000Z', '2026-04-15T00:00:00.000Z'
      );

      INSERT INTO mcp_oauth_token_grants (
        grant_id, family_id, access_token_hash, refresh_token_hash,
        scopes, created_at, access_expires_at, refresh_expires_at
      ) VALUES (
        'grant-1', 'family-old-revoked',
        '1111111111111111111111111111111111111111111111111111111111111111',
        '2222222222222222222222222222222222222222222222222222222222222222',
        'notes:read', '2026-04-10T00:00:00.000Z',
        '2026-04-10T01:00:00.000Z', '2026-05-10T00:00:00.000Z'
      );
    `)

    // 2. Revoked family within retention window (revoked 5 days ago) -> should be kept
    db.database.exec(`
      INSERT INTO mcp_oauth_token_families (
        family_id, profile_id, client_id, resource, created_at, revoked_at
      ) VALUES (
        'family-recent-revoked', '11111111-1111-4111-8111-111111111111',
        'client-1', 'https://mcp.rivolo.app/mcp',
        '2026-05-20T00:00:00.000Z', '2026-05-27T00:00:00.000Z'
      );

      INSERT INTO mcp_oauth_token_grants (
        grant_id, family_id, access_token_hash, refresh_token_hash,
        scopes, created_at, access_expires_at, refresh_expires_at
      ) VALUES (
        'grant-2', 'family-recent-revoked',
        '3333333333333333333333333333333333333333333333333333333333333333',
        '4444444444444444444444444444444444444444444444444444444444444444',
        'notes:read', '2026-05-20T00:00:00.000Z',
        '2026-05-20T01:00:00.000Z', '2026-06-20T00:00:00.000Z'
      );
    `)

    // 3. Unrevoked family where refresh token expired 40 days ago (> 30 days) -> should be purged
    db.database.exec(`
      INSERT INTO mcp_oauth_token_families (
        family_id, profile_id, client_id, resource, created_at, revoked_at
      ) VALUES (
        'family-old-expired', '11111111-1111-4111-8111-111111111111',
        'client-1', 'https://mcp.rivolo.app/mcp',
        '2026-04-01T00:00:00.000Z', NULL
      );

      INSERT INTO mcp_oauth_token_grants (
        grant_id, family_id, access_token_hash, refresh_token_hash,
        scopes, created_at, access_expires_at, refresh_expires_at
      ) VALUES (
        'grant-3', 'family-old-expired',
        '5555555555555555555555555555555555555555555555555555555555555555',
        '6666666666666666666666666666666666666666666666666666666666666666',
        'notes:read', '2026-04-01T00:00:00.000Z',
        '2026-04-01T01:00:00.000Z', '2026-04-20T00:00:00.000Z'
      );
    `)

    // 4. Active family (unrevoked, refresh token valid until next month) -> should be kept
    db.database.exec(`
      INSERT INTO mcp_oauth_token_families (
        family_id, profile_id, client_id, resource, created_at, revoked_at
      ) VALUES (
        'family-active', '11111111-1111-4111-8111-111111111111',
        'client-1', 'https://mcp.rivolo.app/mcp',
        '2026-05-25T00:00:00.000Z', NULL
      );

      INSERT INTO mcp_oauth_token_grants (
        grant_id, family_id, access_token_hash, refresh_token_hash,
        scopes, created_at, access_expires_at, refresh_expires_at
      ) VALUES (
        'grant-4', 'family-active',
        '7777777777777777777777777777777777777777777777777777777777777777',
        '8888888888888888888888888888888888888888888888888888888888888888',
        'notes:read', '2026-05-25T00:00:00.000Z',
        '2026-05-25T01:00:00.000Z', '2026-06-25T00:00:00.000Z'
      );
    `)

    const stats = await runMcpD1Cleanup(db as unknown as D1Database, { now })

    expect(stats.deletedTokenFamilies).toBe(2)
    expect(stats.deletedTokenGrants).toBe(2)

    const remainingFamilies = (
      db.database
        .prepare('SELECT family_id FROM mcp_oauth_token_families ORDER BY family_id')
        .all() as { family_id: string }[]
    ).map((r) => r.family_id)

    expect(remainingFamilies).toEqual(['family-active', 'family-recent-revoked'])

    const remainingGrants = (
      db.database
        .prepare('SELECT grant_id FROM mcp_oauth_token_grants ORDER BY grant_id')
        .all() as { grant_id: string }[]
    ).map((r) => r.grant_id)

    expect(remainingGrants).toEqual(['grant-2', 'grant-4'])
  })

  it('purges expired token families even when created recently with different retention thresholds', async () => {
    const db = new SqliteD1()
    createFixtures(db)
    const now = new Date('2026-06-01T12:00:00.000Z')

    // Family created 10 days ago (more recent than revokedRetention 30 days)
    // but its refresh token expired 6 days ago (older than expiredRetention 5 days)
    db.database.exec(`
      INSERT INTO mcp_oauth_token_families (
        family_id, profile_id, client_id, resource, created_at, revoked_at
      ) VALUES (
        'family-recently-created-expired', '11111111-1111-4111-8111-111111111111',
        'client-1', 'https://mcp.rivolo.app/mcp',
        '2026-05-22T00:00:00.000Z', NULL
      );

      INSERT INTO mcp_oauth_token_grants (
        grant_id, family_id, access_token_hash, refresh_token_hash,
        scopes, created_at, access_expires_at, refresh_expires_at
      ) VALUES (
        'grant-recent-family-expired', 'family-recently-created-expired',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'notes:read', '2026-05-22T00:00:00.000Z',
        '2026-05-22T01:00:00.000Z', '2026-05-26T00:00:00.000Z'
      );
    `)

    const stats = await runMcpD1Cleanup(db as unknown as D1Database, {
      now,
      revokedTokenFamiliesRetentionDays: 30,
      expiredTokenFamiliesRetentionDays: 5,
    })

    expect(stats.deletedTokenFamilies).toBe(1)
    expect(stats.deletedTokenGrants).toBe(1)

    const remainingFamilies = (
      db.database
        .prepare('SELECT family_id FROM mcp_oauth_token_families')
        .all() as { family_id: string }[]
    ).map((r) => r.family_id)

    expect(remainingFamilies).toEqual([])
  })

  it('purges empty expired families across multiple batches without deleting recent families', async () => {
    const db = new SqliteD1()
    createFixtures(db)
    const insert = db.database.prepare(`INSERT INTO mcp_oauth_token_families
      (family_id, profile_id, client_id, resource, created_at, revoked_at)
      VALUES (?, '11111111-1111-4111-8111-111111111111', 'client-1', 'https://mcp.rivolo.app/mcp', ?, NULL)`)
    for (let index = 0; index < 101; index++) insert.run(`old-${index}`, '2026-01-01T00:00:00.000Z')
    insert.run('recent-empty', '2026-06-01T00:00:00.000Z')
    const result = await runMcpD1Cleanup(db as unknown as D1Database, { now: new Date('2026-06-01T12:00:00.000Z') })
    expect(result.deletedTokenFamilies).toBe(101)
    expect(db.all('SELECT family_id FROM mcp_oauth_token_families')).toEqual([{ family_id: 'recent-empty' }])
  })

  it('purges old completed and stale pending write operations', async () => {
    const db = new SqliteD1()
    createFixtures(db)
    const now = new Date('2026-06-01T12:00:00.000Z')

    // Completed 40 days ago -> purge
    // Completed 10 days ago -> keep
    // Pending 10 days ago (> 7 days) -> purge
    // Pending 2 days ago (<= 7 days) -> keep
    db.database.exec(`
      INSERT INTO mcp_write_operations (
        profile_id, operation_id, input_hash, state, result_json, created_at, updated_at
      ) VALUES
      (
        '11111111-1111-4111-8111-111111111111', 'op-old-completed',
        '0000000000000000000000000000000000000000000000000000000000000001',
        'completed', '{"ok":true}', '2026-04-20T00:00:00.000Z', '2026-04-20T00:00:00.000Z'
      ),
      (
        '11111111-1111-4111-8111-111111111111', 'op-recent-completed',
        '0000000000000000000000000000000000000000000000000000000000000002',
        'completed', '{"ok":true}', '2026-05-22T00:00:00.000Z', '2026-05-22T00:00:00.000Z'
      ),
      (
        '11111111-1111-4111-8111-111111111111', 'op-stale-pending',
        '0000000000000000000000000000000000000000000000000000000000000003',
        'pending', NULL, '2026-05-20T00:00:00.000Z', '2026-05-20T00:00:00.000Z'
      ),
      (
        '11111111-1111-4111-8111-111111111111', 'op-recent-pending',
        '0000000000000000000000000000000000000000000000000000000000000004',
        'pending', NULL, '2026-05-30T00:00:00.000Z', '2026-05-30T00:00:00.000Z'
      );
    `)

    const stats = await runMcpD1Cleanup(db as unknown as D1Database, { now })

    expect(stats.deletedWriteOperations).toBe(2)

    const remaining = (
      db.database
        .prepare('SELECT operation_id FROM mcp_write_operations ORDER BY operation_id')
        .all() as { operation_id: string }[]
    ).map((r) => r.operation_id)

    expect(remaining).toEqual(['op-recent-completed', 'op-recent-pending'])
  })

  it('purges obsolete records via scheduled work while preserving live records', async () => {
    const db = new SqliteD1()
    createFixtures(db)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'))
    db.database.exec(`
      INSERT INTO mcp_write_operations (profile_id, operation_id, input_hash, state, result_json, created_at, updated_at)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'obsolete-write', '${'a'.repeat(64)}', 'completed', '{}', '2026-01-01', '2026-01-01'),
        ('11111111-1111-4111-8111-111111111111', 'live-write', '${'b'.repeat(64)}', 'completed', '{}', '2026-06-01', '2026-06-01');
    `)

    const waitUntilPromises: Promise<unknown>[] = []
    const ctx = {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise)
      }),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    const env = {
      MCP_DB: db as unknown as D1Database,
      MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: 'test-key',
      DROPBOX_CLIENT_ID: 'test-client',
      GOOGLE_CLIENT_ID: 'test-google-id',
      GOOGLE_CLIENT_SECRET: 'test-google-secret',
    } as RemoteMcpEnv

    const controller = {
      scheduledTime: Date.now(),
      cron: '0 3 * * *',
      noRetry: vi.fn(),
    } as unknown as ScheduledController

    await worker.scheduled!(controller, env, ctx)

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
    await Promise.all(waitUntilPromises)
    expect(db.all('SELECT operation_id FROM mcp_write_operations')).toEqual([{ operation_id: 'live-write' }])

  })
it("logs errors when runMcpD1Cleanup rejects in Worker scheduled handler", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const rejectingDb = {
      prepare: vi.fn(() => {
        throw new Error("D1 connection failed")
      }),
    } as unknown as D1Database

    const waitUntilPromises: Promise<unknown>[] = []
    const ctx = {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise)
      }),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    const env = {
      MCP_DB: rejectingDb,
      MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: "test-key",
      DROPBOX_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_ID: "test-google-id",
      GOOGLE_CLIENT_SECRET: "test-google-secret",
    } as RemoteMcpEnv

    const controller = {
      scheduledTime: Date.now(),
      cron: "0 3 * * *",
      noRetry: vi.fn(),
    } as unknown as ScheduledController

    await worker.scheduled!(controller, env, ctx)

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
    await Promise.all(waitUntilPromises)

    expect(errorSpy).toHaveBeenCalledWith(
      "[mcp-d1-cleanup] failed",
      expect.any(Error),
    )

    errorSpy.mockRestore()
  })
});

afterEach(() => {
  vi.useRealTimers()
  closeTestDatabases()
})
