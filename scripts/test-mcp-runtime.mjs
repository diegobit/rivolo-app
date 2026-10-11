import assert from 'node:assert/strict'
import { randomBytes, webcrypto } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Smoke the shipped Worker and migrations under workerd/local D1. Never use a
// remote database or a connected provider account; tools/list needs no provider.
const cwd = fileURLToPath(new URL('../', import.meta.url))
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
const persistence = await mkdtemp(join(tmpdir(), 'rivolo-mcp-runtime-'))
const encryptionSecret = 'isolated-runtime-fixture-secret'
const profileId = '11111111-1111-4111-8111-111111111111'
const token = `rvl_${randomBytes(32).toString('base64url')}`
let server

const runD1 = (...args) => {
  const result = spawnSync(process.execPath, [wrangler, 'd1', ...args, '--local', '--config', 'wrangler.mcp.toml', '--persist-to', persistence], { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}
const sqlFile = async (name, sql) => {
  const path = join(persistence, name)
  await writeFile(path, sql)
  runD1('execute', 'MCP_DB', '--file', path)
}

try {
  runD1('migrations', 'apply', 'MCP_DB')
  const encoder = new TextEncoder()
  const key = await webcrypto.subtle.importKey('raw', await webcrypto.subtle.digest('SHA-256', encoder.encode(encryptionSecret)), 'AES-GCM', false, ['encrypt'])
  const iv = randomBytes(12)
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify({ version: 1, token: 'not-a-live-provider-credential' })))
  const credential = `${iv.toString('base64url')}.${Buffer.from(encrypted).toString('base64url')}`
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', encoder.encode(token))).toString('hex')
  await sqlFile('fixture.sql', `
    INSERT INTO mcp_provider_profiles (profile_id, provider, provider_account_id, dropbox_path, time_zone, encrypted_refresh_token, created_at, updated_at)
    VALUES ('${profileId}', 'dropbox', 'runtime-fixture-account', '/isolated-fixture.md', 'UTC', '${credential}', '2026-01-01', '2026-01-01');
    INSERT INTO mcp_personal_tokens (token_id, profile_id, name, token_hash, token_prefix, scopes, created_at)
    VALUES ('22222222-2222-4222-8222-222222222222', '${profileId}', 'Runtime fixture', '${hash}', '${token.slice(0, 12)}', 'notes:read notes:write', '2026-01-01');
  `)

  server = spawn(process.execPath, [wrangler, 'dev', '--local', '--config', 'wrangler.mcp.toml', '--persist-to', persistence, '--port', '0', '--var', `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY:${encryptionSecret}`, '--var', 'GOOGLE_CLIENT_SECRET:isolated-runtime-fixture'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Worker startup timed out: ${logs}`)), 30_000)
    const capture = chunk => {
      logs += chunk.toString()
      const match = logs.match(/Ready on (http:\/\/localhost:\d+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    }
    server.stdout.on('data', capture)
    server.stderr.on('data', capture)
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Worker exited ${code}: ${logs}`)) })
  })
  const call = (method, auth = token) => fetch(`${origin}/mcp`, {
    method: 'POST', headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-06-18', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(method === 'initialize' ? { params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'runtime-smoke', version: '1.0.0' } } } : {}) }),
  })
  const unauthenticated = await call('tools/list', null)
  assert.equal(unauthenticated.status, 401)
  assert.match(unauthenticated.headers.get('WWW-Authenticate'), /oauth-protected-resource\/mcp/)
  const metadata = await (await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`)).json()
  assert.equal(metadata.resource, 'https://mcp.rivolo.app/mcp')
  const initialized = await call('initialize')
  assert.equal(initialized.status, 200)
  assert.equal((await initialized.json()).result.serverInfo.name, 'rivolo-notes')
  const listed = await call('tools/list')
  assert.equal(listed.status, 200)
  const names = (await listed.json()).result.tools.map(tool => tool.name)
  assert(names.includes('list_days') && names.includes('add_to_day') && names.includes('add_to_today'))
  assert.equal((await fetch(`${origin}/mcp`, { headers: { Accept: 'text/event-stream' } })).status, 405)

  await sqlFile('revoke.sql', `UPDATE mcp_provider_profiles SET encrypted_refresh_token = '', revoked_at = '2026-10-11' WHERE profile_id = '${profileId}';`)
  assert.equal((await call('tools/list')).status, 401)
  await sqlFile('reenable.sql', `UPDATE mcp_provider_profiles SET encrypted_refresh_token = '${credential}', revoked_at = NULL WHERE profile_id = '${profileId}';`)
  assert.equal((await call('tools/list')).status, 401, 'profile re-enable must not resurrect the old token')
  console.log('MCP local runtime: migrations, metadata, initialize/list, auth, GET 405 and revocation across re-enable passed.')
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await exited
  }
  await rm(persistence, { recursive: true, force: true })
}
