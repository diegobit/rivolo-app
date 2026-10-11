// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpOAuthRepository } from '../../functions/_lib/mcpOAuth'
import { McpPersonalTokenRepository } from '../../functions/_lib/mcpPersonalTokens'
import { ProviderProfileRepository } from '../../functions/_lib/providerProfiles'
import worker, { type RemoteMcpEnv } from '../../mcp/worker'
import { SqliteD1, closeTestDatabases } from './helpers/d1'

const RESOURCE = 'https://mcp.rivolo.app/mcp'
const MODIFIED_AT = '2026-07-16T12:00:00.000Z'
const initialMarkdown = '<!-- day:2026-07-16 -->\nJul 16, 2026\n------------\n\nCloud note'
const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()))
  vi.unstubAllGlobals()
  closeTestDatabases()
})

const fixture = async (provider: 'dropbox' | 'google-drive' = 'dropbox') => {
  const db = new SqliteD1()
  const env: RemoteMcpEnv = {
    MCP_DB: db as unknown as D1Database,
    MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: 'profile-secret',
    MCP_ALLOWED_ORIGINS: 'https://trusted.example',
    DROPBOX_CLIENT_ID: 'dropbox-client',
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
  }
  const profile = await new ProviderProfileRepository(env.MCP_DB, env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY)
    .createOrUpdate({
      providerAccountId: 'account-1', timeZone: 'Europe/Rome', refreshToken: 'provider-refresh-secret',
      ...(provider === 'dropbox'
        ? { provider, target: { path: '/inbox.md' } }
        : { provider, target: { fileId: 'file-1', fileName: 'inbox.md', folderId: 'folder-1' } }),
    })
  const personal = await new McpPersonalTokenRepository(env.MCP_DB).create(profile.profileId, 'SDK agent')
  const state = { markdown: initialMarkdown, rev: 'rev-1', uploads: 0 }
  const providerFetch = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname.endsWith('/token')) {
      const body = new URLSearchParams(await request.text())
      expect(body.get('refresh_token')).toBe('provider-refresh-secret')
      expect(body.get('client_id')).toBe(provider === 'dropbox' ? 'dropbox-client' : 'google-client')
      return Response.json({ access_token: 'provider-access', expires_in: 3600 })
    }
    expect(request.headers.get('Authorization')).toBe('Bearer provider-access')
    if (url.hostname === 'content.dropboxapi.com') {
      const args = JSON.parse(request.headers.get('Dropbox-API-Arg') ?? '{}')
      expect(args.path).toBe('/inbox.md')
      if (url.pathname.endsWith('/download')) {
        return new Response(state.markdown, {
          headers: { 'Dropbox-API-Result': JSON.stringify({ rev: state.rev, server_modified: MODIFIED_AT, size: state.markdown.length }) },
        })
      }
      if (url.pathname.endsWith('/upload')) {
        if (args.mode?.['.tag'] !== 'update' || args.mode.update !== state.rev) {
          return Response.json({ error_summary: 'path/conflict/file/..' }, { status: 409 })
        }
        state.markdown = await request.text()
        state.rev = `rev-${++state.uploads + 1}`
        return Response.json({ rev: state.rev, server_modified: MODIFIED_AT, size: state.markdown.length })
      }
    }
    if (url.hostname === 'www.googleapis.com' && url.pathname === '/drive/v3/files/file-1') {
      if (url.searchParams.get('alt') === 'media') return new Response(state.markdown)
      return Response.json({ id: 'file-1', name: 'inbox.md', mimeType: 'text/markdown', size: String(state.markdown.length), version: '7', headRevisionId: 'rev-7', modifiedTime: MODIFIED_AT })
    }
    throw new Error(`Unexpected provider request ${request.method} ${request.url}`)
  })
  vi.stubGlobal('fetch', providerFetch)
  const requestFetch = vi.fn<typeof fetch>(async (input, init) => worker.fetch(new Request(input, init), env))
  const connect = async (token = personal.token) => {
    const client = new Client({ name: 'integration-sdk-client', version: '1.0.0' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(RESOURCE), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: requestFetch,
    }))
    return client
  }
  const oauth = async (scope: string) => {
    const repository = new McpOAuthRepository(env.MCP_DB)
    const client = await repository.registerClient({ redirectUris: ['https://client.example/callback'] })
    const verifier = 'v'.repeat(64)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const challenge = Buffer.from(digest).toString('base64url')
    const authorization = await repository.parseAuthorizationRequest(new URLSearchParams({
      response_type: 'code', client_id: client.clientId, redirect_uri: client.redirectUris[0],
      code_challenge: challenge, code_challenge_method: 'S256', scope, resource: RESOURCE,
    }), RESOURCE)
    const code = await repository.issueAuthorizationCode(profile.profileId, authorization)
    return repository.exchangeAuthorizationCode({ clientId: client.clientId, code, codeVerifier: verifier, redirectUri: client.redirectUris[0], resource: RESOURCE })
  }
  return { db, env, profile, personal, state, providerFetch, requestFetch, connect, oauth }
}

const text = (result: Awaited<ReturnType<Client['callTool']>>) => {
  const content = result.content as Array<{ type: string; text: string }>
  expect(content[0]?.type).toBe('text')
  return content[0].text
}
const addition = { name: 'add_to_day', arguments: { day_id: '2026-07-16', content_md: 'Agent addition', operation_id: 'operation-replay-1' } }
const rawRequest = (headers: HeadersInit = {}) => new Request(RESOURCE, {
  method: 'POST', headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
})

describe('MCP Worker HTTP and durable security boundary', () => {
  it('initializes an SDK client, reads Dropbox, writes once and replays durable metadata', async () => {
    const f = await fixture()
    const client = await f.connect()
    expect(client.getServerVersion()?.name).toBe('rivolo-notes')
    const tools = (await client.listTools()).tools.map(tool => tool.name)
    expect(tools).toContain('list_days')
    expect(tools).toContain('add_to_day')
    expect(tools).toContain('add_to_today')
    expect(JSON.parse(text(await client.callTool({ name: 'get_day', arguments: { day_id: '2026-07-16' } })))).toMatchObject({ found: true, day: { content_md: 'Cloud note' } })
    const first = JSON.parse(text(await client.callTool(addition)))
    const replay = JSON.parse(text(await client.callTool(addition)))
    expect(replay).toEqual(first)
    expect(replay).toMatchObject({ day_id: '2026-07-16', operation_id: 'operation-replay-1', source: { provider: 'dropbox', rev: 'rev-2' } })
    expect(replay).not.toHaveProperty('day')
    expect(replay).not.toHaveProperty('content_md')
    expect(f.state.uploads).toBe(1)
    expect(f.state.markdown).toBe(`${initialMarkdown}\n\nAgent addition`)
    const stored = f.db.get('SELECT * FROM mcp_write_operations')
    expect(stored?.state).toBe('completed')
    expect(JSON.stringify(stored)).not.toContain('Agent addition')
    expect(f.db.get('SELECT last_used_at FROM mcp_personal_tokens')?.last_used_at).not.toBeNull()
    const messages = await Promise.all(f.requestFetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body)).method))
    expect(messages).toContain('initialize')
    expect(messages).toContain('notifications/initialized')
  })

  it.each(['notes:read', 'notes:write'])('enforces actual OAuth %s grants at list and call boundaries', async scope => {
    const f = await fixture()
    const token = await f.oauth(scope)
    const client = await f.connect(token.access_token)
    const tools = (await client.listTools()).tools.map(tool => tool.name)
    const forbidden = scope === 'notes:read' ? addition : { name: 'get_day', arguments: { day_id: '2026-07-16' } }
    expect(tools).not.toContain(forbidden.name)
    const callsBefore = f.providerFetch.mock.calls.length
    const rejected = await client.callTool(forbidden)
    expect(rejected.isError).toBe(true)
    expect(text(rejected)).toContain(`Tool ${forbidden.name} not found`)
    expect(f.providerFetch).toHaveBeenCalledTimes(callsBefore)
    expect(f.state.uploads).toBe(0)
    expect(f.db.all('SELECT * FROM mcp_write_operations')).toHaveLength(0)
    if (scope === 'notes:write') {
      expect(JSON.parse(text(await client.callTool(addition)))).toMatchObject({ day_id: '2026-07-16' })
    } else {
      expect(JSON.parse(text(await client.callTool({ name: 'get_day', arguments: { day_id: '2026-07-16' } })))).toMatchObject({ found: true })
    }
  })

  it('selects the configured Google Drive file through real refresh and SDK read', async () => {
    const f = await fixture('google-drive')
    const client = await f.connect()
    const payload = JSON.parse(text(await client.callTool({ name: 'list_days', arguments: { include_content: true } })))
    expect(payload).toMatchObject({ source: { provider: 'google-drive', fileId: 'file-1' }, count: 1, days: [{ content_md: 'Cloud note' }] })
  })

  it('rejects absent/unknown bearer and disallowed origin without reaching a provider', async () => {
    const f = await fixture()
    const absent = await worker.fetch(rawRequest(), f.env)
    expect(absent.status).toBe(401)
    expect(absent.headers.get('WWW-Authenticate')).toBe('Bearer resource_metadata="https://mcp.rivolo.app/.well-known/oauth-protected-resource/mcp", scope="notes:read notes:write"')
    expect((await worker.fetch(rawRequest({ Authorization: 'Bearer unrecognized' }), f.env)).status).toBe(401)
    const rejected = await worker.fetch(rawRequest({ Origin: 'https://evil.example', Authorization: `Bearer ${f.personal.token}` }), f.env)
    expect(rejected.status).toBe(403)
    expect(f.providerFetch).not.toHaveBeenCalled()
    expect(f.db.get('SELECT last_used_at FROM mcp_personal_tokens')?.last_used_at).toBeNull()
  })

  it('does not resurrect revoked OAuth and PAT grants after profile re-enable', async () => {
    const f = await fixture()
    const oauth = await f.oauth('notes:read notes:write')
    const profiles = new ProviderProfileRepository(f.env.MCP_DB, f.env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY)
    await profiles.revoke(f.profile.profileId)
    await profiles.createOrUpdate({ provider: 'dropbox', providerAccountId: 'account-1', target: { path: '/inbox.md' }, timeZone: 'UTC', refreshToken: 'new-provider-secret' })
    for (const token of [f.personal.token, oauth.access_token]) {
      expect((await worker.fetch(rawRequest({ Authorization: `Bearer ${token}` }), f.env)).status).toBe(401)
    }
    expect(f.providerFetch).not.toHaveBeenCalled()
  })

  it('releases a pre-upload failure and never reflects provider transport secrets', async () => {
    const f = await fixture()
    const client = await f.connect()
    f.providerFetch.mockRejectedValueOnce(new Error('provider leaked secret'))
    const result = await client.callTool(addition)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Dropbox download request failed.')
    expect(text(result)).not.toContain('provider leaked secret')
    expect(f.db.all('SELECT * FROM mcp_write_operations')).toHaveLength(0)
    expect(f.state.uploads).toBe(0)
    expect((await client.callTool(addition)).isError).not.toBe(true)
    expect(f.state.uploads).toBe(1)
  })

  it('keeps an upload network failure pending and refuses a second append', async () => {
    const f = await fixture()
    const client = await f.connect()
    const routed = f.providerFetch.getMockImplementation()!
    f.providerFetch.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/upload')) throw new Error('upload transport secret')
      return routed(input, init)
    })
    const result = await client.callTool(addition)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('provider write outcome is unknown')
    expect(text(result)).not.toContain('upload transport secret')
    expect(f.db.get('SELECT state, result_json FROM mcp_write_operations')).toEqual({ state: 'pending', result_json: null })
    const callsBefore = f.providerFetch.mock.calls.length
    expect((await client.callTool(addition)).isError).toBe(true)
    expect(f.providerFetch).toHaveBeenCalledTimes(callsBefore)
  })

  it('sanitizes actual authentication storage failure', async () => {
    const f = await fixture()
    f.db.close()
    const response = await worker.fetch(rawRequest({ Authorization: `Bearer ${f.personal.token}` }), f.env)
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('{"error":"MCP authentication is temporarily unavailable."}')
  })

  it('declines GET notification streaming before authentication', async () => {
    const f = await fixture()
    f.db.close()
    const response = await worker.fetch(new Request(RESOURCE, { headers: { Accept: 'text/event-stream' } }), f.env)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(f.providerFetch).not.toHaveBeenCalled()
  })

  it('serves discovery with environment resource/issuer and rejects unknown routes', async () => {
    const f = await fixture()
    f.env.MCP_RESOURCE_URL = 'https://mcp-dev.rivolo.app/mcp'
    f.env.MCP_OAUTH_ISSUER_URL = 'https://dev.rivolo.pages.dev/api/mcp/oauth'
    const response = await worker.fetch(new Request('https://mcp-dev.rivolo.app/.well-known/oauth-protected-resource/mcp'), f.env)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ resource: f.env.MCP_RESOURCE_URL, authorization_servers: [f.env.MCP_OAUTH_ISSUER_URL], scopes_supported: ['notes:read', 'notes:write'], bearer_methods_supported: ['header'], resource_name: 'Rivolo notes' })
    expect((await worker.fetch(new Request('https://mcp-dev.rivolo.app/not-mcp'), f.env)).status).toBe(404)
  })
})
