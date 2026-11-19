// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { SqliteD1, closeTestDatabases } from './helpers/d1'
import { createMcpProfileSessionCookie, mcpProfileRepository } from '../../functions/_lib/mcpAgentAccess'
import { onRequestPost as moveAgentTarget } from '../../functions/api/mcp/daily-target'
import { onRequestGet as upgradeSocket, onRequestPost as publishEvent } from '../../functions/api/sync/daily-events'

const origin = 'https://rivolo.example'
const key = 'fixture-key-for-daily-sync'
const request = (path: string, body: object, headers: HeadersInit = {}) => new Request(origin + path, {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Requested-With': 'XmlHttpRequest', ...headers },
  body: JSON.stringify(body),
})
const context = (req: Request, env: unknown) => ({ request: req, env }) as never
afterEach(() => { closeTestDatabases(); vi.unstubAllGlobals() })

// Pages and the real D1 SQL own authorization for an existing profile's
// transition, including when the client repeats a successful request.
it('keeps the Agent profile and rejects a folder outside its existing notebook', async () => {
  const env = {
    MCP_DB: new SqliteD1() as unknown as D1Database,
    MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: key,
    MCP_PROFILE_SESSION_ENCRYPTION_KEY: key,
    DROPBOX_CLIENT_ID: 'fixture-id',
  }
  const repo = mcpProfileRepository(env)
  const profile = await repo.createOrUpdate({
    provider: 'dropbox', providerAccountId: 'alice', target: { path: '/inbox.md' }, timeZone: 'UTC', refreshToken: 'fixture-refresh',
  })
  const cookie = (await createMcpProfileSessionCookie(new Request(origin), env, profile.profileId)).split(';')[0]
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input)
    if (url.pathname === '/oauth2/token') return Response.json({ access_token: 'access-token', expires_in: 1000 })
    const { path } = JSON.parse(String(init?.body))
    if (path === '/inbox.rivolo-daily/.rivolo-migrated') return Response.json({ '.tag': 'file' })
    return Response.json({ id: path, '.tag': 'folder', path_lower: path === 'id:target' ? '/inbox.rivolo-daily' : '/other.rivolo-daily' })
  })
  const move = (folder: string, authorized = true) => moveAgentTarget(context(request('/api/mcp/daily-target',
    { provider: 'dropbox', folder }, authorized ? { Cookie: cookie } : {}), env))
  expect((await move('id:target', false)).status).toBe(403)
  expect((await move('id:unrelated')).status).toBe(409)
  expect((await move('id:target')).status).toBe(200)
  expect((await move('id:target')).status).toBe(200)
  expect(await repo.getMetadata(profile.profileId)).toMatchObject({ profileId: profile.profileId, dailyFolderId: 'id:target' })
  expect(await repo.decryptCredential(profile.profileId)).toBe('fixture-refresh')
})

// Pages routes own provider scoping and metadata verification before a Worker
// room can be joined or notified. Provider and Durable Object I/O are routed.
it('keeps relay tickets scoped to a provider and rejects an out-of-folder file', async () => {
  const env = {
    DROPBOX_TOKEN_ENCRYPTION_KEY: key,
    GOOGLE_TOKEN_ENCRYPTION_KEY: key,
    ONEDRIVE_EVENTS: { idFromName: (id: string) => id, get: () => ({
      fetch: async () => new Response(null, { status: 204 }),
    }) },
  }
  vi.stubGlobal('fetch', async (_input: string | URL, init?: RequestInit) => {
    const { path } = JSON.parse(String(init?.body))
    if (path === 'id:folder') return Response.json({ id: path, '.tag': 'folder', path_lower: '/inbox.rivolo-daily' })
    return Response.json({ id: path, '.tag': 'file', path_lower: '/other/2026/11/2026-11-18.md', rev: 'rev' })
  })
  const post = (body: object) => publishEvent(context(request('/api/sync/daily-events',
    { provider: 'dropbox', folder: 'id:folder', sender: 'browser', ...body }, { Authorization: 'Bearer provider-token' }), env))
  expect((await post({ action: 'publish', item: 'id:other' })).status).toBe(403)
  const subscription = await post({ action: 'subscribe' })
  expect(subscription.status).toBe(200)
  const { ticket } = await subscription.json() as { ticket: string }
  const join = (provider: string) => upgradeSocket(context(new Request(
    `${origin}/api/sync/daily-events?provider=${provider}&ticket=${encodeURIComponent(ticket)}`,
    { headers: { Origin: origin, Upgrade: 'websocket' } },
  ), env))
  expect((await join('dropbox')).status).toBe(204)
  expect((await join('google-drive')).status).toBe(401)
})
