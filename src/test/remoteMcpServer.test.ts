// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedMcpOAuthBearer } from '../../functions/_lib/mcpOAuth'
import {
  McpPersonalTokenRepository,
  type AuthenticatedMcpBearer,
} from '../../functions/_lib/mcpPersonalTokens'
import { ProviderProfileRepository } from '../../functions/_lib/providerProfiles'
import {
  authenticateRemoteMcpBearer,
  handleRemoteMcpRequest,
  type RemoteMcpDependencies,
  type RemoteMcpEnv,
} from '../../mcp/remoteServer'
import worker from '../../mcp/worker'
import { SqliteD1, closeTestDatabases } from './helpers/d1'

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
  resource: 'https://mcp.rivolo.app/mcp',
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
  new Request('https://mcp.rivolo.app/mcp', {
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
      'Bearer resource_metadata="https://mcp.rivolo.app/.well-known/oauth-protected-resource/mcp", scope="notes:read notes:write"',
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
      'Bearer resource_metadata="https://mcp.rivolo.app/.well-known/oauth-protected-resource/mcp", scope="notes:read notes:write"'

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
          new Request('https://mcp.rivolo.app/mcp', { method, headers }),
          env,
          { ...defaultDependencies(null), authenticate },
        )
        expect(response.status).toBe(401)
        expect(response.headers.get('WWW-Authenticate')).toBe(challenge)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
      }
    }

    const malformed = await handleRemoteMcpRequest(
      new Request('https://mcp.rivolo.app/mcp', {
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
        new Request('https://mcp.rivolo.app/mcp', {
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
      new Request('https://mcp.rivolo.app/mcp', {
        method: 'GET',
        headers: { Authorization: 'Bearer credential' },
      }),
      createEnv(),
      { ...defaultDependencies(dropboxAuth()), authenticate: vi.fn().mockResolvedValue(dropboxAuth()) },
    )
    expect(absentVersion.status).toBe(405)

    const unsupported = await handleRemoteMcpRequest(
      new Request('https://mcp.rivolo.app/mcp', {
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
      new Request('https://mcp.rivolo.app/mcp', {
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
      new Request('https://mcp.rivolo.app/mcp', {
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
    // A refresh token no other test uses, so the isolate token cache misses.
    const dependencies = defaultDependencies(
      { ...dropboxAuth(), providerRefreshToken: 'dropbox-refresh-read-day' },
      providerFetch,
    )
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
      'dropbox-refresh-read-day',
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

type LinkedProvider = 'dropbox' | 'google-drive'

// Each call opens its own D1 database, so profile ids (and cache keys) are unique.
const linkProfile = async (
  provider: LinkedProvider = 'dropbox',
  refreshToken = 'provider-refresh-1',
) => {
  const db = new SqliteD1()
  const env = createEnv()
  env.MCP_DB = db as unknown as D1Database
  const profiles = new ProviderProfileRepository(
    env.MCP_DB,
    env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
  )
  const profile = await profiles.createOrUpdate(
    provider === 'dropbox'
      ? {
          provider,
          providerAccountId: 'dbid:account',
          target: { path: '/inbox.md' },
          timeZone: 'Europe/Rome',
          refreshToken,
        }
      : {
          provider,
          providerAccountId: 'google-account',
          target: { fileId: 'file-1', folderId: 'folder-1', fileName: 'inbox.md' },
          timeZone: 'Europe/Rome',
          refreshToken,
        },
  )
  const tokens = new McpPersonalTokenRepository(env.MCP_DB)
  const createBearer = async (name = 'Agent') =>
    (await tokens.create(profile.profileId, name)).token
  return { env, profiles, profile, tokens, createBearer }
}

const googleMetadata = () =>
  json({
    id: 'file-1',
    name: 'inbox.md',
    mimeType: 'text/markdown',
    size: String(markdown.length),
    version: '7',
    headRevisionId: 'rev-7',
    modifiedTime: MODIFIED_AT,
    capabilities: { canDownload: true, canEdit: true, canModifyContent: true },
  })

// Routes provider HTTP by URL and answers 401 to access tokens it no longer accepts.
const providerRoutes = (acceptedTokens: Set<string>) => {
  const seen: Array<{ url: string; token: string; status: number }> = []
  const providerFetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    const token =
      new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? ''
    let response: Response
    if (!acceptedTokens.has(token)) {
      response = json({ error_summary: 'expired_access_token/' }, { status: 401 })
    } else if (url === 'https://content.dropboxapi.com/2/files/download') {
      response = dropboxDownload()
    } else if (url.startsWith('https://www.googleapis.com/drive/v3/files/file-1?fields=')) {
      response = googleMetadata()
    } else if (url === 'https://www.googleapis.com/drive/v3/files/file-1?alt=media') {
      response = new Response(markdown)
    } else {
      throw new Error(`Unexpected provider request: ${url}`)
    }
    seen.push({ url, token, status: response.status })
    return response
  })
  return { providerFetch, seen }
}

const providerGrant = (accessToken: string, extra: Record<string, unknown> = {}) => ({
  access_token: accessToken,
  expires_in: 3600,
  ...extra,
})

const getDay = (env: RemoteMcpEnv, bearer: string, dependencies: Partial<RemoteMcpDependencies>) =>
  handleRemoteMcpRequest(
    mcpRequest(
      'tools/call',
      { name: 'get_day', arguments: { day_id: '2026-07-16' } },
      { token: bearer },
    ),
    env,
    dependencies,
  )

const toolResult = async (response: Response) => {
  const payload = await responsePayload(response)
  expect(payload.result?.isError).not.toBe(true)
  return JSON.parse(payload.result?.content?.[0]?.text ?? '{}') as unknown
}

const foundDay = {
  found: true,
  day: { day_id: '2026-07-16', content_md: 'Cloud note' },
}

describe('hosted MCP provider access token cache', () => {
  afterEach(() => {
    vi.useRealTimers()
    closeTestDatabases()
  })

  it('refreshes the provider token once across consecutive agent requests', async () => {
    const { env, createBearer } = await linkProfile()
    const bearer = await createBearer()
    const { providerFetch, seen } = providerRoutes(new Set(['access-1']))
    const refreshDropbox = vi.fn().mockResolvedValue(providerGrant('access-1'))
    const dependencies = { fetch: providerFetch, refreshDropbox }

    await expect(toolResult(await getDay(env, bearer, dependencies))).resolves.toMatchObject(foundDay)
    await expect(toolResult(await getDay(env, bearer, dependencies))).resolves.toMatchObject(foundDay)

    expect(refreshDropbox).toHaveBeenCalledTimes(1)
    expect(seen.map(({ token }) => token)).toEqual(['access-1', 'access-1'])
  })

  it('shares one provider refresh between concurrent cache misses', async () => {
    const { env, createBearer } = await linkProfile()
    const bearer = await createBearer()
    const { providerFetch } = providerRoutes(new Set(['access-1']))
    let grant!: (value: ReturnType<typeof providerGrant>) => void
    const refreshDropbox = vi.fn(
      () => new Promise<ReturnType<typeof providerGrant>>((resolve) => { grant = resolve }),
    )
    const dependencies = { fetch: providerFetch, refreshDropbox }

    const first = getDay(env, bearer, dependencies)
    const second = getDay(env, bearer, dependencies)
    await vi.waitFor(() => expect(refreshDropbox).toHaveBeenCalled())
    // Give the second request time to authenticate and reach the token cache.
    await new Promise((resolve) => setTimeout(resolve, 50))
    grant(providerGrant('access-1'))

    await expect(toolResult(await first)).resolves.toMatchObject(foundDay)
    await expect(toolResult(await second)).resolves.toMatchObject(foundDay)
    expect(refreshDropbox).toHaveBeenCalledTimes(1)
  })

  it('misses the cache after Dropbox rotates the refresh token', async () => {
    const { env, profiles, profile, createBearer } = await linkProfile(
      'dropbox',
      'provider-refresh-1',
    )
    const bearer = await createBearer()
    const { providerFetch, seen } = providerRoutes(new Set(['access-1', 'access-2']))
    const refreshDropbox = vi
      .fn()
      .mockResolvedValueOnce(
        providerGrant('access-1', { refresh_token: 'provider-refresh-2' }),
      )
      .mockResolvedValueOnce(providerGrant('access-2'))
    const dependencies = { fetch: providerFetch, refreshDropbox }

    await expect(toolResult(await getDay(env, bearer, dependencies))).resolves.toMatchObject(foundDay)
    await expect(profiles.decryptCredential(profile.profileId)).resolves.toBe(
      'provider-refresh-2',
    )
    await expect(toolResult(await getDay(env, bearer, dependencies))).resolves.toMatchObject(foundDay)

    expect(refreshDropbox.mock.calls.map(([refreshToken]) => refreshToken)).toEqual([
      'provider-refresh-1',
      'provider-refresh-2',
    ])
    expect(seen.map(({ token }) => token)).toEqual(['access-1', 'access-2'])
  })

  it('rejects a revoked token or profile even while its provider token is cached', async () => {
    const { env, profiles, profile, tokens, createBearer } = await linkProfile()
    const revokedBearer = await createBearer('Revoked agent')
    const activeBearer = await createBearer('Active agent')
    const { providerFetch } = providerRoutes(new Set(['access-1']))
    const refreshDropbox = vi.fn().mockResolvedValue(providerGrant('access-1'))
    const dependencies = { fetch: providerFetch, refreshDropbox }

    await expect(toolResult(await getDay(env, revokedBearer, dependencies))).resolves.toMatchObject(foundDay)
    const [revokedToken] = (await tokens.list(profile.profileId)).filter(
      ({ name }) => name === 'Revoked agent',
    )
    await tokens.revoke(profile.profileId, revokedToken.tokenId)

    expect((await getDay(env, revokedBearer, dependencies)).status).toBe(401)
    // The other agent on the same profile still uses the cached provider token.
    await expect(toolResult(await getDay(env, activeBearer, dependencies))).resolves.toMatchObject(foundDay)

    await profiles.revoke(profile.profileId)
    expect((await getDay(env, activeBearer, dependencies)).status).toBe(401)

    expect(refreshDropbox).toHaveBeenCalledTimes(1)
    expect(providerFetch).toHaveBeenCalledTimes(2)
  })

  it('refreshes and retries once when the provider rejects a cached token', async () => {
    const { env, createBearer } = await linkProfile('google-drive')
    const bearer = await createBearer()
    const accepted = new Set(['access-1'])
    const { providerFetch, seen } = providerRoutes(accepted)
    const refreshGoogle = vi
      .fn()
      .mockResolvedValueOnce(providerGrant('access-1'))
      .mockResolvedValueOnce(providerGrant('access-2'))
    const dependencies = { fetch: providerFetch, refreshGoogle }

    await expect(toolResult(await getDay(env, bearer, dependencies))).resolves.toMatchObject(foundDay)
    // Google revokes the access token before it expires.
    accepted.delete('access-1')
    accepted.add('access-2')
    await expect(toolResult(await getDay(env, bearer, dependencies))).resolves.toMatchObject(foundDay)

    expect(refreshGoogle).toHaveBeenCalledTimes(2)
    expect(seen.map(({ token, status }) => `${status} ${token}`)).toEqual([
      '200 access-1',
      '200 access-1',
      '401 access-1',
      '200 access-2',
      '200 access-2',
    ])
  })

  it('refreshes an entry once it is within two minutes of expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const issuedAt = Date.parse('2026-07-16T12:00:00.000Z')
    vi.setSystemTime(issuedAt)
    const { env, createBearer } = await linkProfile()
    const bearer = await createBearer()
    const { providerFetch, seen } = providerRoutes(new Set(['access-1', 'access-2']))
    const refreshDropbox = vi
      .fn()
      .mockResolvedValueOnce(providerGrant('access-1'))
      .mockResolvedValueOnce(providerGrant('access-2'))
    const dependencies = { fetch: providerFetch, refreshDropbox }

    await toolResult(await getDay(env, bearer, dependencies))
    // expires_in is 3600 s: still usable 2 min 1 s before expiry...
    vi.setSystemTime(issuedAt + (3600 - 121) * 1000)
    await toolResult(await getDay(env, bearer, dependencies))
    // ...but not 1 min 59 s before it.
    vi.setSystemTime(issuedAt + (3600 - 119) * 1000)
    await toolResult(await getDay(env, bearer, dependencies))

    expect(refreshDropbox).toHaveBeenCalledTimes(2)
    expect(seen.map(({ token }) => token)).toEqual(['access-1', 'access-1', 'access-2'])
  })
})

describe('hosted MCP Worker discovery', () => {
  it('answers an unauthenticated MCP GET with the protected-resource challenge', async () => {
    const response = await worker.fetch(
      new Request('https://mcp.rivolo.app/mcp', {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      }),
      createEnv(),
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toContain(
      'resource_metadata="https://mcp.rivolo.app/.well-known/oauth-protected-resource/mcp"',
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('serves protected-resource metadata from the MCP origin', async () => {
    const response = await worker.fetch(
      new Request(
        'https://mcp.rivolo.app/.well-known/oauth-protected-resource/mcp',
      ),
      createEnv(),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      resource: 'https://mcp.rivolo.app/mcp',
      authorization_servers: ['https://rivolo.app/api/mcp/oauth'],
      scopes_supported: ['notes:read', 'notes:write'],
      bearer_methods_supported: ['header'],
      resource_name: 'Rivolo notes',
    })
  })
})
