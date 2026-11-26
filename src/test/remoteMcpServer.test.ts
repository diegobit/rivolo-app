// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedMcpOAuthBearer } from '../../functions/_lib/mcpOAuth'
import { McpPersonalTokenRepository, type AuthenticatedMcpBearer } from '../../functions/_lib/mcpPersonalTokens'
import { ProviderProfileRepository } from '../../functions/_lib/providerProfiles'
import { encodeNotebookDay, decodeNotebookDay } from '../lib/notebookDays'
import { readNotebookAuthors, writeNotebookAuthors } from '../lib/oneDriveBlame'
import { SqliteD1 } from './helpers/d1'
import { createGraphFixture } from './oneDriveGraphFixture'
import {
  authenticateRemoteMcpBearer,
  handleRemoteMcpRequest,
  type RemoteMcpDependencies,
  type RemoteMcpEnv,
} from '../../mcp/remoteServer'
import worker from '../../mcp/worker'

type OperationRow = {
  input_hash: string
  state: 'pending' | 'completed'
  result_json: string | null
}

class FakeWriteD1 {
  readonly operations = new Map<string, OperationRow>()

  prepare(sql: string) {
    return {
      bind: (...values: unknown[]) => ({
        first: async <T>() => this.first(sql, values) as T | null,
        run: async () => this.run(sql, values),
      }),
    }
  }

  private key(profileId: unknown, operationId: unknown) {
    return `${String(profileId)}:${String(operationId)}`
  }

  private first(sql: string, values: unknown[]) {
    if (!sql.includes('SELECT input_hash, state, result_json')) {
      throw new Error(`Unexpected first query: ${sql}`)
    }
    return this.operations.get(this.key(values[0], values[1])) ?? null
  }

  private async run(sql: string, values: unknown[]) {
    if (sql.includes('INSERT INTO mcp_write_operations')) {
      const [profileId, operationId, inputHash] = values
      const key = this.key(profileId, operationId)
      if (this.operations.has(key)) return { meta: { changes: 0 } }
      this.operations.set(key, {
        input_hash: String(inputHash),
        state: 'pending',
        result_json: null,
      })
      return { meta: { changes: 1 } }
    }

    if (sql.includes("SET state = 'completed'")) {
      const [resultJson, , profileId, operationId, inputHash] = values
      const key = this.key(profileId, operationId)
      const operation = this.operations.get(key)
      if (
        !operation
        || operation.state !== 'pending'
        || operation.input_hash !== inputHash
      ) {
        return { meta: { changes: 0 } }
      }
      this.operations.set(key, {
        ...operation,
        state: 'completed',
        result_json: String(resultJson),
      })
      return { meta: { changes: 1 } }
    }

    if (sql.includes('DELETE FROM mcp_write_operations')) {
      const [profileId, operationId, inputHash] = values
      const key = this.key(profileId, operationId)
      const operation = this.operations.get(key)
      if (
        !operation
        || operation.state !== 'pending'
        || operation.input_hash !== inputHash
      ) {
        return { meta: { changes: 0 } }
      }
      this.operations.delete(key)
      return { meta: { changes: 1 } }
    }

    throw new Error(`Unexpected run query: ${sql}`)
  }
}

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const MODIFIED_AT = '2026-07-16T12:00:00.000Z'
const markdown = [
  '<!-- day:2026-07-16 -->',
  'Jul 16, 2026',
  '------------',
  '',
  'Cloud note',
].join('\n')

const dropboxAuth = (
  scopes: AuthenticatedMcpBearer['token']['scopes'] = [
    'notes:read',
    'notes:write',
  ],
): AuthenticatedMcpBearer => ({
  profile: {
    profileId: PROFILE_ID,
    provider: 'dropbox',
    providerAccountId: 'dbid:account',
    providerEmail: 'user@example.com',
    providerName: 'User',
    target: { path: '/inbox.md' },
    timeZone: 'Europe/Rome',
    createdAt: MODIFIED_AT,
    updatedAt: MODIFIED_AT,
    revokedAt: null,
  },
  token: {
    tokenId: '22222222-2222-4222-8222-222222222222',
    name: 'Agent',
    prefix: 'rvl_example1',
    scopes,
    createdAt: MODIFIED_AT,
    lastUsedAt: null,
    revokedAt: null,
  },
  providerRefreshToken: 'dropbox-refresh-secret',
})

const googleAuth = (): AuthenticatedMcpBearer => ({
  ...dropboxAuth(),
  profile: {
    ...dropboxAuth().profile,
    provider: 'google-drive',
    providerAccountId: 'google-account',
    target: {
      fileId: 'file-1',
      folderId: 'folder-1',
      fileName: 'inbox.md',
    },
  },
  providerRefreshToken: 'google-refresh-secret',
})

const oauthAuth = (
  scopes: AuthenticatedMcpOAuthBearer['scopes'] = ['notes:read', 'notes:write'],
): AuthenticatedMcpOAuthBearer => ({
  profile: dropboxAuth().profile,
  providerRefreshToken: 'dropbox-refresh-secret',
  clientId: 'rvc_oauth-client-example',
  scopes,
  expiresAt: 1_800_000_000,
  resource: 'https://mcp.aitlab.it/mcp',
})

const createEnv = (db = new FakeWriteD1()): RemoteMcpEnv => ({
  MCP_DB: db as unknown as D1Database,
  MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: 'profile-encryption-secret',
  MCP_ALLOWED_ORIGINS: 'https://trusted.example',
  DROPBOX_CLIENT_ID: 'dropbox-client',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
})

const mcpRequest = (
  method: string,
  params?: Record<string, unknown>,
  options: { origin?: string; token?: string } = {},
) =>
  new Request('https://mcp.aitlab.it/mcp', {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${options.token ?? 'rvl_test'}`,
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-06-18',
      ...(options.origin ? { Origin: options.origin } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      ...(params ? { params } : {}),
    }),
  })

const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init)

const dropboxDownload = (content = markdown, rev = 'rev-1') =>
  new Response(content, {
    headers: {
      'Dropbox-API-Result': JSON.stringify({
        rev,
        server_modified: MODIFIED_AT,
        size: content.length,
      }),
    },
  })

const defaultDependencies = (
  auth: AuthenticatedMcpBearer | null,
  providerFetch = vi.fn<typeof fetch>(),
): Partial<RemoteMcpDependencies> => ({
  authenticate: vi.fn().mockResolvedValue(auth),
  fetch: providerFetch,
  refreshDropbox: vi.fn().mockResolvedValue({
    access_token: 'dropbox-access',
    expires_in: 14400,
  }),
  refreshGoogle: vi.fn().mockResolvedValue({
    access_token: 'google-access',
    expires_in: 3600,
  }),
})

const responsePayload = async (response: Response) => {
  expect(response.headers.get('Content-Type')).toContain('application/json')
  return response.json() as Promise<{
    result?: {
      tools?: Array<{ name: string }>
      content?: Array<{ type: string; text: string }>
      isError?: boolean
    }
    error?: unknown
  }>
}

describe('hosted MCP Streamable HTTP endpoint', () => {
  it('dispatches PAT and OAuth bearer prefixes without trial authentication', async () => {
    const personal = vi.fn().mockResolvedValue(dropboxAuth())
    const oauth = vi.fn().mockResolvedValue(oauthAuth())
    const env = createEnv()

    await expect(
      authenticateRemoteMcpBearer(
        mcpRequest('tools/list', undefined, { token: `rvl_${'A'.repeat(43)}` }),
        env,
        { personal, oauth },
      ),
    ).resolves.toMatchObject({ token: { prefix: 'rvl_example1' } })
    expect(personal).toHaveBeenCalledTimes(1)
    expect(oauth).not.toHaveBeenCalled()

    await expect(
      authenticateRemoteMcpBearer(
        mcpRequest('tools/list', undefined, { token: `rva_${'B'.repeat(43)}` }),
        env,
        { personal, oauth },
      ),
    ).resolves.toMatchObject({ clientId: 'rvc_oauth-client-example' })
    expect(personal).toHaveBeenCalledTimes(1)
    expect(oauth).toHaveBeenCalledTimes(1)
  })

  it('rejects missing bearer auth and disallowed browser origins before auth', async () => {
    const authenticate = vi.fn().mockResolvedValue(null)
    const env = createEnv()

    const unauthorized = await handleRemoteMcpRequest(
      mcpRequest('tools/list'),
      env,
      { ...defaultDependencies(null), authenticate },
    )
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="https://mcp.aitlab.it/.well-known/oauth-protected-resource/mcp", scope="notes:read notes:write"',
    )

    const rejectedOrigin = await handleRemoteMcpRequest(
      mcpRequest('tools/list', undefined, { origin: 'https://evil.example' }),
      env,
      { ...defaultDependencies(dropboxAuth()), authenticate },
    )
    expect(rejectedOrigin.status).toBe(403)
    expect(authenticate).toHaveBeenCalledTimes(1)
  })

  it('challenges unauthenticated GET and POST before treating them as healthy', async () => {
    const authenticate = vi.fn().mockResolvedValue(null)
    const env = createEnv()
    const challenge =
      'Bearer resource_metadata="https://mcp.aitlab.it/.well-known/oauth-protected-resource/mcp", scope="notes:read notes:write"'

    for (const accept of [
      'text/event-stream',
      'application/json',
      'application/json, text/event-stream',
      null,
    ]) {
      for (const method of ['GET', 'POST']) {
        const headers = new Headers()
        if (accept) headers.set('Accept', accept)
        const response = await handleRemoteMcpRequest(
          new Request('https://mcp.aitlab.it/mcp', { method, headers }),
          env,
          { ...defaultDependencies(null), authenticate },
        )
        expect(response.status).toBe(401)
        expect(response.headers.get('WWW-Authenticate')).toBe(challenge)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
      }
    }

    const malformed = await handleRemoteMcpRequest(
      new Request('https://mcp.aitlab.it/mcp', {
        method: 'GET',
        headers: { Authorization: 'Bearer not-a-token' },
      }),
      env,
      { ...defaultDependencies(null), authenticate },
    )
    expect(malformed.status).toBe(401)
    expect(malformed.headers.get('WWW-Authenticate')).toBe(challenge)
  })

  it('returns 405 for an authenticated GET without opening a stream', async () => {
    const refreshDropbox = vi.fn()
    const providerFetch = vi.fn<typeof fetch>()
    for (const authorization of [dropboxAuth(), oauthAuth()]) {
      const authenticate = vi.fn().mockResolvedValue(authorization)
      const response = await handleRemoteMcpRequest(
        new Request('https://mcp.aitlab.it/mcp', {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            Authorization: 'Bearer credential',
            'Last-Event-ID': 'event-1',
            'MCP-Protocol-Version': '2025-06-18',
          },
        }),
        createEnv(),
        {
          authenticate,
          fetch: providerFetch,
          refreshDropbox,
          refreshGoogle: vi.fn(),
        },
      )
      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('POST')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('Content-Type')).not.toContain('text/event-stream')
      expect(authenticate).toHaveBeenCalledTimes(1)
    }
    expect(refreshDropbox).not.toHaveBeenCalled()
    expect(providerFetch).not.toHaveBeenCalled()

    const absentVersion = await handleRemoteMcpRequest(
      new Request('https://mcp.aitlab.it/mcp', {
        method: 'GET',
        headers: { Authorization: 'Bearer credential' },
      }),
      createEnv(),
      { ...defaultDependencies(dropboxAuth()), authenticate: vi.fn().mockResolvedValue(dropboxAuth()) },
    )
    expect(absentVersion.status).toBe(405)

    const unsupported = await handleRemoteMcpRequest(
      new Request('https://mcp.aitlab.it/mcp', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer credential',
          'MCP-Protocol-Version': '1999-01-01',
        },
      }),
      createEnv(),
      {
        ...defaultDependencies(dropboxAuth()),
        authenticate: vi.fn().mockResolvedValue(dropboxAuth()),
        refreshDropbox,
      },
    )
    expect(unsupported.status).toBe(400)
    expect(refreshDropbox).not.toHaveBeenCalled()

    const unsupportedPost = await handleRemoteMcpRequest(
      new Request('https://mcp.aitlab.it/mcp', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer credential',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '1999-01-01',
        },
        body: '{}',
      }),
      createEnv(),
      {
        ...defaultDependencies(dropboxAuth()),
        authenticate: vi.fn().mockResolvedValue(dropboxAuth()),
        fetch: providerFetch,
      },
    )
    expect(unsupportedPost.status).toBe(400)
    expect(providerFetch).not.toHaveBeenCalled()

    const blockedAuthenticate = vi.fn().mockResolvedValue(dropboxAuth())
    const disallowed = await handleRemoteMcpRequest(
      new Request('https://mcp.aitlab.it/mcp', {
        method: 'GET',
        headers: { Origin: 'https://evil.example', Authorization: 'Bearer credential' },
      }),
      createEnv(),
      {
        ...defaultDependencies(dropboxAuth()),
        authenticate: blockedAuthenticate,
      },
    )
    expect(disallowed.status).toBe(403)
    expect(blockedAuthenticate).not.toHaveBeenCalled()
  })

  it('uses the configured MCP resource origin without trusting upstream browser origins', async () => {
    const env = {
      ...createEnv(),
      MCP_RESOURCE_URL: 'https://mcp-dev.aitlab.it/mcp',
      MCP_ALLOWED_ORIGINS: '',
    }
    const authenticate = vi.fn().mockResolvedValue(null)
    const dependencies = { ...defaultDependencies(null), authenticate }

    const allowed = await handleRemoteMcpRequest(
      mcpRequest('tools/list', undefined, { origin: 'https://mcp-dev.aitlab.it' }),
      env,
      dependencies,
    )
    expect(allowed.status).toBe(401)
    expect(allowed.headers.get('WWW-Authenticate')).toContain('https://mcp-dev.aitlab.it/')

    const rejected = await handleRemoteMcpRequest(
      mcpRequest('tools/list', undefined, { origin: 'https://mcp.rivolo.app' }),
      env,
      dependencies,
    )
    expect(rejected.status).toBe(403)
    expect(authenticate).toHaveBeenCalledOnce()
  })

  it('lists only tools allowed by PAT scopes', async () => {
    const response = await handleRemoteMcpRequest(
      mcpRequest('tools/list'),
      createEnv(),
      defaultDependencies(dropboxAuth(['notes:read'])),
    )
    const payload = await responsePayload(response)
    const names = payload.result?.tools?.map((tool) => tool.name) ?? []

    expect(response.status).toBe(200)
    expect(names).toContain('list_days')
    expect(names).not.toContain('add_to_day')
    expect(names).not.toContain('add_to_today')
  })

  it('lists both additive write tools for the default read-write PAT', async () => {
    const response = await handleRemoteMcpRequest(
      mcpRequest('tools/list'),
      createEnv(),
      defaultDependencies(dropboxAuth()),
    )
    const payload = await responsePayload(response)
    const names = payload.result?.tools?.map((tool) => tool.name) ?? []

    expect(names).toContain('list_days')
    expect(names).toContain('add_to_day')
    expect(names).toContain('add_to_today')
  })

  it('normalizes OAuth grants into the same scope-gated tool boundary', async () => {
    const response = await handleRemoteMcpRequest(
      mcpRequest('tools/list', undefined, { token: `rva_${'A'.repeat(43)}` }),
      createEnv(),
      defaultDependencies(oauthAuth(['notes:write'])),
    )
    const payload = await responsePayload(response)
    const names = payload.result?.tools?.map((tool) => tool.name) ?? []

    expect(response.status).toBe(200)
    expect(names).not.toContain('list_days')
    expect(names).toContain('add_to_day')
    expect(names).toContain('add_to_today')
  })

  it('reads a representative Dropbox day with a refreshed provider token', async () => {
    const providerFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      dropboxDownload(),
    )
    const dependencies = defaultDependencies(dropboxAuth(), providerFetch)
    const response = await handleRemoteMcpRequest(
      mcpRequest('tools/call', {
        name: 'get_day',
        arguments: { day_id: '2026-07-16' },
      }),
      createEnv(),
      dependencies,
    )
    const payload = await responsePayload(response)
    const toolResult = JSON.parse(payload.result?.content?.[0]?.text ?? '{}')

    expect(toolResult).toMatchObject({
      found: true,
      day: { day_id: '2026-07-16', content_md: 'Cloud note' },
    })
    expect(dependencies.refreshDropbox).toHaveBeenCalledWith(
      'dropbox-refresh-secret',
      expect.anything(),
    )
    expect(
      new Headers(providerFetch.mock.calls[0]?.[1]?.headers).get('Authorization'),
    ).toBe('Bearer dropbox-access')
  })

  it('selects the configured Google Drive target', async () => {
    const providerFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          id: 'file-1',
          name: 'inbox.md',
          mimeType: 'text/markdown',
          size: String(markdown.length),
          version: '7',
          headRevisionId: 'rev-7',
          modifiedTime: MODIFIED_AT,
          capabilities: {
            canDownload: true,
            canEdit: true,
            canModifyContent: true,
          },
        }),
      )
      .mockResolvedValueOnce(new Response(markdown))
    const dependencies = defaultDependencies(googleAuth(), providerFetch)
    const response = await handleRemoteMcpRequest(
      mcpRequest('tools/call', {
        name: 'list_days',
        arguments: { include_content: true },
      }),
      createEnv(),
      dependencies,
    )
    const payload = await responsePayload(response)
    const toolResult = JSON.parse(payload.result?.content?.[0]?.text ?? '{}')

    expect(toolResult).toMatchObject({
      source: { provider: 'google-drive', fileId: 'file-1' },
      count: 1,
    })
    expect(String(providerFetch.mock.calls[0]?.[0])).toContain('/files/file-1')
    expect(dependencies.refreshGoogle).toHaveBeenCalledWith(
      'google-refresh-secret',
      expect.anything(),
    )
  })

  it('replays a durable compact write result without a second provider write', async () => {
    const providerFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(dropboxDownload())
      .mockResolvedValueOnce(
        json({
          rev: 'rev-2',
          server_modified: MODIFIED_AT,
          size: markdown.length + 20,
        }),
      )
    const env = createEnv()
    const dependencies = defaultDependencies(dropboxAuth(), providerFetch)
    const request = () =>
      mcpRequest('tools/call', {
        name: 'add_to_day',
        arguments: {
          day_id: '2026-07-16',
          content_md: 'Agent addition',
          operation_id: 'operation-replay-1',
        },
      })

    const first = await responsePayload(
      await handleRemoteMcpRequest(request(), env, dependencies),
    )
    const replay = await responsePayload(
      await handleRemoteMcpRequest(request(), env, dependencies),
    )
    const firstResult = JSON.parse(first.result?.content?.[0]?.text ?? '{}')
    const replayResult = JSON.parse(replay.result?.content?.[0]?.text ?? '{}')

    expect(replayResult).toEqual(firstResult)
    expect(replayResult).toMatchObject({
      day_id: '2026-07-16',
      operation_id: 'operation-replay-1',
      source: { provider: 'dropbox', rev: 'rev-2' },
    })
    expect(replayResult).not.toHaveProperty('day')
    expect(replayResult).not.toHaveProperty('content_md')
    expect(providerFetch).toHaveBeenCalledTimes(2)
  })

  it('releases only provably not-applied writes and sanitizes unknown failures', async () => {
    const db = new FakeWriteD1()
    const providerFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('provider leaked secret'))
    const env = createEnv(db)
    const dependencies = defaultDependencies(dropboxAuth(), providerFetch)
    const response = await handleRemoteMcpRequest(
      mcpRequest('tools/call', {
        name: 'add_to_day',
        arguments: {
          day_id: '2026-07-16',
          content_md: 'Agent addition',
          operation_id: 'operation-safe-failure',
        },
      }),
      env,
      dependencies,
    )
    const payload = await responsePayload(response)
    const text = payload.result?.content?.[0]?.text ?? ''

    expect(payload.result?.isError).toBe(true)
    expect(text).toContain('Dropbox download request failed.')
    expect(text).not.toContain('provider leaked secret')
    expect(db.operations.size).toBe(0)
  })

  it('keeps an upload-network failure pending because its outcome is ambiguous', async () => {
    const db = new FakeWriteD1()
    const providerFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(dropboxDownload())
      .mockRejectedValueOnce(new Error('upload transport secret'))
    const env = createEnv(db)
    const response = await handleRemoteMcpRequest(
      mcpRequest('tools/call', {
        name: 'add_to_day',
        arguments: {
          day_id: '2026-07-16',
          content_md: 'Agent addition',
          operation_id: 'operation-ambiguous-upload',
        },
      }),
      env,
      defaultDependencies(dropboxAuth(), providerFetch),
    )
    const payload = await responsePayload(response)
    const text = payload.result?.content?.[0]?.text ?? ''
    const operation = [...db.operations.values()][0]

    expect(payload.result?.isError).toBe(true)
    expect(text).toContain('provider write outcome is unknown')
    expect(text).not.toContain('upload transport secret')
    expect(operation).toMatchObject({ state: 'pending', result_json: null })
  })

  it('does not reflect authentication storage failures', async () => {
    const response = await handleRemoteMcpRequest(
      mcpRequest('tools/list'),
      createEnv(),
      {
        ...defaultDependencies(dropboxAuth()),
        authenticate: vi.fn().mockRejectedValue(new Error('secret database detail')),
      },
    )
    const text = await response.text()

    expect(response.status).toBe(503)
    expect(text).not.toContain('secret database detail')
  })
})

describe('hosted MCP on a OneDrive notebook', () => {
  const dayId = '2026-07-16'
  const doc = (contentMd: string) => encodeNotebookDay({ dayId, humanTitle: 'Jul 16, 2026', contentMd })

  async function fixture() {
    const graph = createGraphFixture()
    const db = new SqliteD1()
    const env = {
      ...createEnv(),
      MCP_DB: db as unknown as D1Database,
      ONEDRIVE_CLIENT_ID: 'onedrive-client',
      ONEDRIVE_CLIENT_SECRET: 'onedrive-fixture-secret',
    }
    const profiles = new ProviderProfileRepository(env.MCP_DB, env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY)
    const profile = await profiles.createOrUpdate({
      provider: 'onedrive',
      providerAccountId: 'fixture-account',
      providerName: 'Ari',
      target: { folder: graph.folder, folderName: 'Fixture' },
      timeZone: 'UTC',
      refreshToken: 'fixture-refresh',
    })
    const tokens = new McpPersonalTokenRepository(env.MCP_DB)
    const { token } = await tokens.create(profile.profileId, 'Fixture agent')
    const dependency = {
      fetch: vi.fn<typeof fetch>(async (url, init) => {
        const isGraph = String(url).startsWith('https://graph.microsoft.com/v1.0/')
        expect(new Headers(init?.headers).get('Authorization')).toBe(isGraph ? 'Bearer fixture-access' : null)
        return graph.fetch(url, init)
      }),
      refreshOneDrive: vi.fn<RemoteMcpDependencies['refreshOneDrive']>().mockResolvedValue({
        access_token: 'fixture-access', expires_in: 3600, refresh_token: 'rotated-refresh',
      }),
    }
    const relay = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: publish })),
    }
    const publish = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockImplementation(async () => new Response(null, { status: 204 }))
    const call = async (name: string, args: Record<string, unknown>) =>
      (await responsePayload(await handleRemoteMcpRequest(
        mcpRequest('tools/call', { name, arguments: args }, { token }),
        { ...env, ONEDRIVE_EVENTS: relay as unknown as DurableObjectNamespace },
        dependency,
      ))).result
    return { graph, db, profiles, profile, dependency, relay, publish, call }
  }

  // The hosted HTTP owner checks conditional append and relay output together.
  // The migrated SQLite repository is the source of truth for replay and rotation.
  it('rereads after a concurrent edit, preserves attribution, and publishes one committed revision across replay', async () => {
    const { graph, db, profiles, profile, dependency, relay, publish, call } = await fixture()
    try {
      const base = await writeNotebookAuthors(doc('Original'), new Map([[dayId, ['Casey']]]))
      const race = await writeNotebookAuthors(doc('Original\nConcurrent addition'), new Map([[dayId, ['Casey', 'Sam']]]))
      graph.addDay(dayId, base)
      graph.addDay('2026-07-17', 'Unrelated day')

      const read = await call('get_day', { day_id: dayId })
      expect(JSON.parse(read!.content![0].text)).toMatchObject({
        source: { provider: 'onedrive', folderId: graph.folder, format: 'daily' },
        day: { content_md: 'Original' },
      })
      expect(graph.counters.downloads).toEqual([`file-${dayId}`])
      expect(await profiles.decryptCredential(profile.profileId)).toBe('rotated-refresh')
      expect((await profiles.getMetadata(profile.profileId))?.updatedAt).toBe(profile.updatedAt)

      graph.afterBytes(async () => { graph.addDay(dayId, race, 'v2') })
      const args = { day_id: dayId, content_md: 'Agent addition', operation_id: 'onedrive-replay' }
      const written = await call('add_to_day', args)
      expect(written?.isError, written?.content?.[0].text).not.toBe(true)
      const compact = JSON.parse(written!.content![0].text)
      expect(compact).toMatchObject({ day_id: dayId, conflictRetries: 1, operation_id: 'onedrive-replay' })
      const saved = graph.texts.get(`file-${dayId}`)!
      expect(decodeNotebookDay(saved, dayId).contentMd).toBe('Original\nConcurrent addition\n\nAgent addition')
      expect((await readNotebookAuthors(saved)).get(dayId)).toEqual(['Casey', 'Sam', 'Agent · Ari', 'Agent · Ari'])
      expect(graph.texts.get('file-2026-07-17')).toBe('Unrelated day')
      expect(graph.counters.commits).toEqual([dayId])
      expect(dependency.refreshOneDrive).toHaveBeenCalledTimes(2)
      expect(dependency.refreshOneDrive).toHaveBeenLastCalledWith('rotated-refresh', expect.anything())

      expect(await call('add_to_day', args)).toEqual(written)
      expect(dependency.refreshOneDrive).toHaveBeenCalledTimes(2)
      expect(graph.counters.commits).toEqual([dayId])
      expect(relay.idFromName).toHaveBeenCalledExactlyOnceWith(
        [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`daily:${graph.folder}`)))]
          .map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      )
      expect(publish).toHaveBeenCalledTimes(1)
      expect(publish.mock.calls[0][0]).toBe('https://channel/publish')
      expect(JSON.parse(String(publish.mock.calls[0][1].body))).toEqual({
        type: 'day-changed', dayId, item: `/drives/drive/items/file-${dayId}`, revision: 'v3', sender: '',
      })
    } finally {
      db.close()
    }
  })

  it('releases a rejected refresh for retry and keeps an append replayable when the relay fails', async () => {
    const { graph, db, dependency, publish, call } = await fixture()
    try {
      const args = { day_id: dayId, content_md: 'New day', operation_id: 'onedrive-retry' }
      dependency.refreshOneDrive.mockRejectedValueOnce(Object.assign(new Error('fixture private details'), { code: 'invalid_grant' }))
      const failed = await call('add_to_day', args)
      expect(failed?.isError).toBe(true)
      expect(failed?.content?.[0].text).toContain('Reconnect OneDrive')
      expect(failed?.content?.[0].text).not.toContain('fixture private details')
      expect(dependency.fetch).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()

      publish.mockRejectedValueOnce(new Error('Fixture relay unavailable'))
      const written = await call('add_to_day', args)
      expect(written?.isError, written?.content?.[0].text).not.toBe(true)
      expect(await call('add_to_day', args)).toEqual(written)
      expect(graph.counters.commits).toEqual([dayId])
      expect(decodeNotebookDay(graph.texts.get(`file-${dayId}`)!, dayId).contentMd).toBe('New day')
      expect(publish).toHaveBeenCalledTimes(1)
    } finally {
      db.close()
    }
  })

  it.each([404, 412])('does not restore a day when its conditional commit returns %i after deletion', async (status) => {
    const { graph, db, dependency, publish, call } = await fixture()
    try {
      graph.addDay(dayId, doc('This day will be deleted'))
      const itemUrl = `https://graph.microsoft.com/v1.0/drives/drive/items/file-${dayId}`
      const providerFetch = dependency.fetch.getMockImplementation()!
      dependency.fetch.mockImplementation(async (url, init) => {
        const response = await providerFetch(url, init)
        return String(url) === itemUrl && init?.method === 'PUT' && response.status === 404
          ? new Response(null, { status })
          : response
      })
      graph.afterBytes(async () => {
        const deleted = await graph.fetch(itemUrl, { method: 'DELETE', headers: { 'If-Match': 'v1' } })
        expect(deleted.status).toBe(204)
      })
      const args = { day_id: dayId, content_md: 'Racing agent addition', operation_id: 'onedrive-delete-race' }
      expect((await call('add_to_day', args))?.isError).toBe(true)
      expect((await call('add_to_day', args))?.isError).toBe(true)
      expect(graph.texts.has(`file-${dayId}`)).toBe(false)
      expect(graph.counters.commits).toHaveLength(0)
      expect(publish).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })
})

describe('hosted MCP Worker discovery', () => {
  it('answers an unauthenticated MCP GET with the protected-resource challenge', async () => {
    const response = await worker.fetch(
      new Request('https://mcp.aitlab.it/mcp', {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      }),
      createEnv(),
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toContain(
      'resource_metadata="https://mcp.aitlab.it/.well-known/oauth-protected-resource/mcp"',
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('serves protected-resource metadata from the MCP origin', async () => {
    const response = await worker.fetch(
      new Request(
        'https://mcp.aitlab.it/.well-known/oauth-protected-resource/mcp',
      ),
      createEnv(),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      resource: 'https://mcp.aitlab.it/mcp',
      authorization_servers: ['https://rivolo.aitlab.it/api/mcp/oauth'],
      scopes_supported: ['notes:read', 'notes:write'],
      bearer_methods_supported: ['header'],
      resource_name: 'Rivolo notes',
    })
  })
})
