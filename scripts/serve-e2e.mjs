import { preview, createServer } from 'vite'
import { createServer as createHttpServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// Built UI + actual Pages handlers. Only external provider HTTP is simulated.
const port = Number(process.env.E2E_PORT ?? 4175)
const origin = `https://127.0.0.1:${port}`
const certificateDir = mkdtempSync(join(tmpdir(), 'rivolo-browser-tls-'))
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', join(certificateDir, 'key.pem'), '-out', join(certificateDir, 'cert.pem')], { stdio: 'ignore' })
const fixtures = new Map()
const ssr = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
const { SqliteD1, closeTestDatabases } = await ssr.ssrLoadModule('/src/test/helpers/d1.ts')
const key = randomBytes(32).toString('base64')
const envFor = db => ({
  MCP_DB: db,
  DROPBOX_CLIENT_ID: 'browser-fixture-client',
  DROPBOX_TOKEN_ENCRYPTION_KEY: key,
  MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: key,
  MCP_PROFILE_SESSION_ENCRYPTION_KEY: key,
  MCP_ALLOWED_ORIGINS: origin,
  DROPBOX_ALLOWED_ORIGINS: origin,
  MCP_OAUTH_ISSUER_URL: `${origin}/api/mcp/oauth`,
  MCP_RESOURCE_URL: `${origin}/mcp`,
})
const account = { account_id: 'browser-fixture-account', email: 'fixture@example.test', name: { display_name: 'Browser Fixture' } }
const metadata = { '.tag': 'file', name: 'inbox.md', id: 'fixture-file', path_display: '/rivolo/inbox.md', path_lower: '/rivolo/inbox.md', rev: 'fixture-rev', size: 32 }
const providerFetch = async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.hostname !== 'api.dropboxapi.com' && url.hostname !== 'content.dropboxapi.com') {
    throw new Error(`Unexpected external HTTP: ${url.origin}${url.pathname}`)
  }
  if (url.pathname === '/oauth2/token') {
    const params = new URLSearchParams(await request.text())
    if (params.get('client_id') !== 'browser-fixture-client') throw new Error('Unexpected provider client')
    if (params.get('grant_type') === 'authorization_code') {
      if (params.get('code') !== 'fixture-code' || !params.get('code_verifier')) throw new Error('Unexpected code exchange')
    } else if (params.get('refresh_token') !== 'fixture-provider-refresh') throw new Error('Unexpected provider refresh')
    return Response.json({ access_token: 'fixture-provider-access', refresh_token: 'fixture-provider-refresh', expires_in: 3600 })
  }
  if (request.headers.get('Authorization') !== 'Bearer fixture-provider-access') throw new Error('Unexpected provider bearer')
  if (url.pathname === '/2/users/get_current_account') return Response.json(account)
  if (url.pathname === '/2/files/get_metadata') return Response.json(metadata)
  if (url.pathname === '/2/auth/token/revoke') return Response.json(null)
  if (url.pathname === '/2/files/download') return new Response('<!-- day:2024-01-03 -->\nJanuary 3\n---\n\nCloud fixture\n', { headers: { 'Dropbox-API-Result': JSON.stringify(metadata) } })
  if (url.pathname === '/2/files/upload') return Response.json(metadata)
  throw new Error(`Unexpected provider route: ${url.pathname}`)
}
globalThis.fetch = providerFetch

const routes = new Map([
  ['/api/dropbox/config', '/functions/api/dropbox/config.ts'],
  ['/api/dropbox/exchange', '/functions/api/dropbox/exchange.ts'],
  ['/api/dropbox/token', '/functions/api/dropbox/token.ts'],
  ['/api/dropbox/disconnect', '/functions/api/dropbox/disconnect.ts'],
  ['/api/dropbox/mcp-enable', '/functions/api/dropbox/mcp-enable.ts'],
  ['/api/mcp/status', '/functions/api/mcp/status.ts'],
  ['/api/mcp/disable', '/functions/api/mcp/disable.ts'],
  ['/api/mcp/tokens', '/functions/api/mcp/tokens/index.ts'],
  ['/api/mcp/oauth/authorize', '/functions/api/mcp/oauth/authorize.ts'],
  ['/api/mcp/oauth/register', '/functions/api/mcp/oauth/register.ts'],
  ['/api/mcp/oauth/token', '/functions/api/mcp/oauth/token.ts'],
  ['/api/mcp/oauth/revoke', '/functions/api/mcp/oauth/revoke.ts'],
])
const send = async (response, res) => {
  res.statusCode = response.status
  for (const [name, value] of response.headers) if (name !== 'set-cookie') res.setHeader(name, value)
  const cookies = response.headers.getSetCookie()
  const existing = res.getHeader('Set-Cookie')
  if (cookies.length || existing) res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...cookies])
  res.end(Buffer.from(await response.arrayBuffer()))
}
const handle = async (req, res, next) => {
  const url = new URL(req.url, origin)
  if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/__fixtures/') && url.pathname !== '/mcp') return next()
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const request = new Request(url, { method: req.method, headers: Object.entries(req.headers).filter(([name]) => !name.startsWith(':')).flatMap(([name, value]) => Array.isArray(value) ? value.map(item => [name, item]) : value === undefined ? [] : [[name, value]]), ...(chunks.length ? { body: Buffer.concat(chunks), duplex: 'half' } : {}) })
    if (url.pathname === '/__fixtures/new' && req.method === 'POST') {
      const id = randomUUID()
      fixtures.set(id, new SqliteD1())
      return send(Response.json({ ok: true }, { headers: { 'Set-Cookie': `e2e_fixture=${id}; Path=/; HttpOnly; SameSite=Lax` } }), res)
    }
    const id = request.headers.get('Cookie')?.match(/(?:^|;\s*)e2e_fixture=([^;]+)/)?.[1]
    let db = fixtures.get(id)
    if (!db) {
      const newId = randomUUID()
      db = new SqliteD1()
      fixtures.set(newId, db)
      res.setHeader('Set-Cookie', `e2e_fixture=${newId}; Path=/; HttpOnly; SameSite=Lax`)
    }
    if (url.pathname === '/__fixtures/snapshot') return send(Response.json({
      profiles: db.all('SELECT profile_id, revoked_at, encrypted_refresh_token FROM mcp_provider_profiles'),
      tokens: db.all('SELECT token_id, token_hash, revoked_at FROM mcp_personal_tokens'),
      codes: db.all('SELECT used_at FROM mcp_oauth_authorization_codes'),
      grants: db.all('SELECT scopes, access_revoked_at, refresh_used_at FROM mcp_oauth_token_grants'),
    }), res)
    const env = envFor(db)
    if (url.pathname === '/mcp') {
      const { default: worker } = await ssr.ssrLoadModule('/mcp/worker.ts')
      return send(await worker.fetch(request, env), res)
    }
    const tokenId = url.pathname.match(/^\/api\/mcp\/tokens\/([^/]+)$/)?.[1]
    const modulePath = tokenId ? '/functions/api/mcp/tokens/[id].ts' : routes.get(url.pathname)
    if (!modulePath) return send(new Response('Unknown fixture API route', { status: 404 }), res)
    const module = await ssr.ssrLoadModule(modulePath)
    const handler = module[`onRequest${req.method[0]}${req.method.slice(1).toLowerCase()}`]
    if (!handler) return send(new Response('Method not allowed', { status: 405 }), res)
    return send(await handler({ request, env, params: tokenId ? { id: tokenId } : {} }), res)
  } catch (error) {
    console.error(error)
    return send(Response.json({ error: 'Browser fixture handler failed' }, { status: 500 }), res)
  }
}
const callback = createHttpServer((req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.setHeader('Cache-Control', 'no-store')
  res.end('<!doctype html><html><body><h1>Agent callback received</h1></body></html>')
})
await new Promise(resolve => callback.listen(port + 1, '127.0.0.1', resolve))
const built = await preview({ preview: { host: '127.0.0.1', port, strictPort: true, https: { key: readFileSync(join(certificateDir, 'key.pem')), cert: readFileSync(join(certificateDir, 'cert.pem')) } }, plugins: [{ name: 'actual-pages-fixture', configurePreviewServer(server) { server.middlewares.use(handle) } }] })
// Service workers reject untrusted TLS certificates even when page navigation accepts
// them. Secure loopback HTTP exercises the generated worker without bypassing TLS.
const offline = await preview({ preview: { host: '127.0.0.1', port: port + 2, strictPort: true } })
console.log(`Built browser fixture ready at ${origin}; callback at ${port + 1}; offline at ${port + 2}`)
const stop = async () => {
  callback.close()
  await Promise.all([built, offline].map(server => new Promise(resolve => server.httpServer.close(resolve))))
  await ssr.close()
  closeTestDatabases()
  rmSync(certificateDir, { recursive: true, force: true })
  process.exit(0)
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
