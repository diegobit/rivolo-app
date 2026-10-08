// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import type { D1Database, ExecutionContext, ScheduledController } from '@cloudflare/workers-types'
import { describe, expect, it, vi } from 'vitest'
import { runMcpD1Cleanup } from '../../functions/_lib/mcpCleanup'
import worker, { type RemoteMcpEnv } from '../../mcp/worker'

class SqliteD1Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new SqliteD1Statement(this.db, this.sql, params)
  }

  async run() {
    const statement = this.db.prepare(this.sql)
    const result = statement.run(...(this.params as (string | number | bigint | null)[]))
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    }
  }

  async all<T>() {
    const statement = this.db.prepare(this.sql)
    const results = statement.all(...(this.params as (string | number | bigint | null)[])) as T[]
    return {
      success: true,
      results,
    }
  }

  async first<T>() {
    const statement = this.db.prepare(this.sql)
    const result = statement.get(...(this.params as (string | number | bigint | null)[])) as T | undefined
    return result ?? null
  }
}

class SqliteD1 {
  readonly database = new DatabaseSync(':memory:')

  constructor() {
    this.database.exec('PRAGMA foreign_keys = ON;')
  }

  prepare(sql: string) {
    return new SqliteD1Statement(this.database, sql)
  }
}

const createFixtures = (db: SqliteD1) => {
  db.database.exec(`
    CREATE TABLE mcp_provider_profiles (
      profile_id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_email TEXT,
      account_display_name TEXT,
      dropbox_path TEXT,
      google_file_id TEXT,
      google_file_name TEXT,
      encrypted_refresh_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE mcp_oauth_clients (
      client_id TEXT PRIMARY KEY NOT NULL,
      registration_hash TEXT NOT NULL UNIQUE,
      redirect_uris TEXT NOT NULL,
      client_name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE mcp_oauth_authorization_codes (
      code_hash TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      scopes TEXT NOT NULL,
      resource TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY (profile_id) REFERENCES mcp_provider_profiles(profile_id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE
    );

    CREATE TABLE mcp_oauth_token_families (
      family_id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (profile_id) REFERENCES mcp_provider_profiles(profile_id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE
    );

    CREATE TABLE mcp_oauth_token_grants (
      grant_id TEXT PRIMARY KEY NOT NULL,
      family_id TEXT NOT NULL,
      access_token_hash TEXT NOT NULL UNIQUE,
      refresh_token_hash TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      access_expires_at TEXT NOT NULL,
      refresh_expires_at TEXT NOT NULL,
      access_revoked_at TEXT,
      refresh_used_at TEXT,
      FOREIGN KEY (family_id) REFERENCES mcp_oauth_token_families(family_id) ON DELETE CASCADE
    );

    CREATE TABLE mcp_write_operations (
      profile_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile_id, operation_id)
    );

    -- Insert mock profile and client
    INSERT INTO mcp_provider_profiles (
      profile_id, provider, account_id, account_email, account_display_name,
      dropbox_path, encrypted_refresh_token, created_at, revoked_at
    ) VALUES (
      '11111111-1111-4111-8111-111111111111', 'dropbox', 'dbid:123',
      'user@example.com', 'Test User', '/Notes', 'encrypted-secret',
      '2026-01-01T00:00:00.000Z', NULL
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

  it('purges revoked and fully expired token families and cascades to grants', async () => {
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

  it('runs cleanly via Worker scheduled handler with execution context', async () => {
    const db = new SqliteD1()
    createFixtures(db)

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
