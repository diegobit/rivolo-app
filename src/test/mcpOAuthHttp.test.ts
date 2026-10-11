// @vitest-environment node
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpProfileSessionCookie } from '../../functions/_lib/mcpAgentAccess'
import {
  McpOAuthRepository,
  McpOAuthUnavailableError,
  type McpOAuthEnv,
} from '../../functions/_lib/mcpOAuth'
import {
  applyCookieHeaders,
  readOAuthPendingStatus,
  showOAuthConsent,
  submitOAuthConsent,
  submitOAuthPendingCancellation,
} from '../../functions/_lib/mcpOAuthHttp'
import {
  clearPendingCookieHeader,
  MCP_OAUTH_PENDING_COOKIE,
  MCP_OAUTH_PENDING_KDF_INFO,
  MCP_OAUTH_PENDING_KDF_SALT,
  openPendingPayload,
  pendingCookieHeader,
  readPendingRequest,
  sealPendingJson,
  type PendingPayload,
} from '../../functions/_lib/mcpOAuthPending'
import { ProviderProfileRepository } from '../../functions/_lib/providerProfiles'
import { decryptToken } from '../../functions/_lib/tokenCookie'
import {
  createMcpAuthorizationServerMetadata,
  resolveMcpOAuthConfig,
} from '../lib/mcpOAuthMetadata'

class SqliteD1 {
  readonly database = new DatabaseSync(':memory:')

  constructor() {
    this.database.exec('PRAGMA foreign_keys = ON')
    for (const migration of [
      'migrations/0001_mcp_provider_profiles.sql',
      'migrations/0003_mcp_personal_tokens.sql',
      'migrations/0004_mcp_oauth.sql',
    ]) {
      this.database.exec(readFileSync(migration, 'utf8'))
    }
  }

  prepare(sql: string) {
    return {
      bind: (...values: unknown[]) => {
        const statement = this.database.prepare(sql)
        return {
          first: async <T>() => (statement.get(...values) as T | undefined) ?? null,
          all: async <T>() => ({ results: statement.all(...values) as T[] }),
          run: async () => {
            const result = statement.run(...values)
            return { meta: { changes: Number(result.changes) } }
          },
        }
      },
    }
  }
}

const ISSUER = 'https://rivolo.app/api/mcp/oauth'
const RESOURCE = 'https://mcp.rivolo.app/mcp'

const createEnv = (db = new SqliteD1()): McpOAuthEnv => ({
  MCP_DB: db as unknown as D1Database,
  MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: 'profile-token-secret',
  MCP_PROFILE_SESSION_ENCRYPTION_KEY: 'profile-session-secret',
})

const createProfile = (env: McpOAuthEnv) =>
  new ProviderProfileRepository(env.MCP_DB, env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY).createOrUpdate({
    provider: 'dropbox',
    providerAccountId: 'dbid:oauth-user',
    providerEmail: 'notes@example.com',
    target: { path: '/inbox.md' },
    timeZone: 'Europe/Rome',
    refreshToken: 'provider-refresh-secret',
  })

const sessionCookie = async (env: McpOAuthEnv, profileId: string) => {
  const header = await createMcpProfileSessionCookie(
    new Request(`${ISSUER}/authorize`),
    env,
    profileId,
  )
  return cookiePair(header)
}

const cookiePair = (setCookie: string) => {
  const name = setCookie.split('=', 1)[0]
  return `${name}=${setCookie.slice(name.length + 1).split(';', 1)[0]}`
}

const base64Url = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const pkce = async () => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('v'.repeat(64)))
  return base64Url(new Uint8Array(digest))
}

const register = async (env: McpOAuthEnv, redirectUri: string, clientName = 'ChatGPT') => {
  const client = await new McpOAuthRepository(env.MCP_DB).registerClient({
    redirectUris: [redirectUri],
    clientName,
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
  })
  return client
}

const authorizeParams = (
  clientId: string,
  redirectUri: string,
  challenge: string,
  extras: Record<string, string | null> = {},
) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'notes:read notes:write',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: RESOURCE,
  })
  if (!Object.prototype.hasOwnProperty.call(extras, 'state')) params.set('state', 'client-state')
  for (const [key, value] of Object.entries(extras)) {
    params.delete(key)
    if (value !== null) params.set(key, value)
  }
  return params
}

const show = (env: McpOAuthEnv, params: URLSearchParams, cookie?: string) =>
  showOAuthConsent(
    new Request(`${ISSUER}/authorize?${params.toString()}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )

const pendingPair = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookiePair)
    .find((pair) => pair.startsWith(`${MCP_OAUTH_PENDING_COOKIE}=`))

const transactionIdFrom = (html: string) =>
  html.match(/name="transaction_id" value="([^"]+)"/)?.[1] ?? ''

const acceptIssuer = (location: string, expectedIssuer: string) => {
  const url = new URL(location)
  const issuers = url.searchParams.getAll('iss')
  if (issuers.length !== 1 || issuers[0] !== expectedIssuer) {
    throw new Error('Reject issuer before token exchange.')
  }
  return url
}

afterEach(() => {
  vi.useRealTimers()
})

describe('authorization callback trust', () => {
  it('renders consent for an active profile with a response-specific ChatGPT origin', async () => {
    const env = createEnv()
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const redirectUri = 'https://chatgpt.com/backend-api/aip/connectors/mcp/oauth/callback?foo=1'
    const client = await register(env, redirectUri)
    const response = await show(
      env,
      authorizeParams(client.clientId, client.redirectUris[0], await pkce()),
      cookie,
    )
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; base-uri 'none'; frame-ancestors 'none'",
    )
    expect(html).toContain('Allow ChatGPT?')
    expect(html).toContain('notes@example.com')
    expect(html).toContain('action="https://rivolo.app/api/mcp/oauth/authorize"')
    expect(html).toContain('name="transaction_id"')
    expect(html).not.toContain('provider-refresh-secret')
    expect(pendingPair(response)).toBeTruthy()
  })

  it('serializes one safe callback origin and keeps unsafe callbacks off the response', async () => {
    const cases = [
      ['https://chatgpt.com:8443/callback', 'https://chatgpt.com:8443'],
      ['https://exämple.com/cb', 'https://xn--exmple-cua.com'],
      ['http://127.0.0.1:4567/callback', 'http://127.0.0.1:4567'],
      ['http://[::1]:4567/callback', 'http://[::1]:4567'],
    ] as const
    for (const [redirectUri, origin] of cases) {
      const env = createEnv()
      const profile = await createProfile(env)
      const cookie = await sessionCookie(env, profile.profileId)
      const client = await register(env, redirectUri)
      const response = await show(
        env,
        authorizeParams(client.clientId, client.redirectUris[0], await pkce()),
        cookie,
      )
      expect(response.headers.get('Content-Security-Policy')).toContain(`form-action 'self' ${origin};`)
      expect(response.headers.get('Content-Security-Policy')).not.toContain(client.redirectUris[0].slice(origin.length))
    }

    const env = createEnv()
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const stored = 'https://chatgpt.com/cb?q=%22;%3B'
    const client = await register(env, stored)
    const quoted = await show(
      env,
      authorizeParams(client.clientId, client.redirectUris[0], await pkce()),
      cookie,
    )
    const quotedPolicy = quoted.headers.get('Content-Security-Policy') ?? ''
    expect(quotedPolicy).toContain('https://chatgpt.com')
    expect(quotedPolicy).not.toContain('%22')
    expect(quotedPolicy).not.toContain(';base-uri')
    env.MCP_DB.prepare(
      'UPDATE mcp_oauth_clients SET redirect_uris = ? WHERE client_id = ?',
    )
      .bind(JSON.stringify(['javascript:alert(1)', 'https://evil.example/cb\r\nX-Header: 1']), client.clientId)
      .run()
    const poisoned = await show(
      env,
      authorizeParams(client.clientId, 'javascript:alert(1)', await pkce()),
      cookie,
    )
    const poisonedText = `${poisoned.status} ${poisoned.headers.get('Location') ?? ''} ${poisoned.headers.get('Content-Security-Policy')} ${await poisoned.text()}`
    expect(poisoned.status).toBe(400)
    expect(poisoned.headers.get('Location')).toBeNull()
    expect(poisonedText).not.toContain('javascript:alert(1)')
    expect(poisonedText).not.toContain('X-Header')
  })

  it('does not share CSP header state between concurrent consents', async () => {
    const env = createEnv()
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const challenge = await pkce()
    const first = await register(env, 'https://chatgpt.com/callback', 'ChatGPT')
    const second = await register(env, 'https://claude.ai/callback', 'Claude')
    const [left, right] = await Promise.all([
      show(env, authorizeParams(first.clientId, first.redirectUris[0], challenge), cookie),
      show(env, authorizeParams(second.clientId, second.redirectUris[0], challenge), cookie),
    ])
    expect(left.headers.get('Content-Security-Policy')).toContain('https://chatgpt.com')
    expect(left.headers.get('Content-Security-Policy')).not.toContain('https://claude.ai')
    expect(right.headers.get('Content-Security-Policy')).toContain('https://claude.ai')
    expect(right.headers.get('Content-Security-Policy')).not.toContain('https://chatgpt.com')
    expect(await show(env, authorizeParams('rvc_missing_client_id', 'https://chatgpt.com/callback', challenge), cookie)).toMatchObject({
      status: 400,
    })
    expect(
      (await show(
        env,
        authorizeParams('rvc_missing_client_id', 'https://chatgpt.com/callback', challenge),
        cookie,
      )).headers.get('Content-Security-Policy'),
    ).toContain("form-action 'self';")
  })

  it('keeps untrusted client, callback, duplicate, and state failures local', async () => {
    const env = createEnv()
    const client = await register(env, 'https://chatgpt.com/callback')
    const challenge = await pkce()
    const base = authorizeParams(client.clientId, client.redirectUris[0], challenge)
    const requests = [
      authorizeParams('rvc_unknown_client_idxx', client.redirectUris[0], challenge),
      authorizeParams(client.clientId, 'https://chatgpt.com/callback/', challenge),
      authorizeParams(client.clientId, 'https://chatgpt.com/callback/extra', challenge),
      authorizeParams(client.clientId, 'https://chatgpt.com/callback?x=1', challenge),
      authorizeParams(client.clientId, 'https://chatgpt.com:8443/callback', challenge),
      new URLSearchParams(`${base.toString()}&client_id=${client.clientId}`),
      new URLSearchParams(`${base.toString()}&state=one&state=two`),
      authorizeParams(client.clientId, client.redirectUris[0], challenge, {
        state: 'x'.repeat(1025),
      }),
      authorizeParams(client.clientId, client.redirectUris[0], challenge, {
        state: 'bad\nstate',
      }),
    ]
    for (const params of requests) {
      const response = await show(env, params)
      expect(response.status).toBe(400)
      expect(response.headers.get('Location')).toBeNull()
      expect(response.headers.getSetCookie()).toEqual([])
    }
    expect(
      (
        await (env.MCP_DB as unknown as SqliteD1)
          .prepare('SELECT COUNT(*) AS count FROM mcp_oauth_authorization_codes')
          .bind()
          .first<{ count: number }>()
      )?.count,
    ).toBe(0)
  })

  it('redirects validated callback failures with one issuer, state, and preserved query', async () => {
    const env = createEnv()
    const redirectUri = 'https://chatgpt.com/callback?foo=1&code=old&iss=https%3A%2F%2Fevil.example'
    const client = await register(env, redirectUri)
    const challenge = await pkce()
    const canonical = client.redirectUris[0]
    const cases = [
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ code_challenge: 'not-a-challenge' }, 'invalid_request'],
      [{ resource: 'https://attacker.example/mcp' }, 'invalid_request'],
      [{ scope: 'notes:admin' }, 'invalid_scope'],
    ] as const
    for (const [extra, error] of cases) {
      const response = await show(
        env,
        authorizeParams(client.clientId, canonical, challenge, extra),
      )
      const location = acceptIssuer(response.headers.get('Location') ?? '', ISSUER)
      expect(response.status).toBe(302)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
      expect(location.searchParams.get('foo')).toBe('1')
      expect(location.searchParams.get('error')).toBe(error)
      expect(location.searchParams.getAll('code')).toEqual([])
      expect(location.searchParams.getAll('iss')).toEqual([ISSUER])
      expect(location.searchParams.get('state')).toBe('client-state')
      const cookies = response.headers.getSetCookie()
      expect(cookies).toHaveLength(1)
      expect(cookies[0]).toContain(`${MCP_OAUTH_PENDING_COOKIE}=;`)
      expect(cookies[0]).toContain('Max-Age=0')
    }
  })

  it('preserves decoded state and rejects state that cannot be echoed', async () => {
    const env = createEnv()
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const client = await register(env, 'https://chatgpt.com/callback')
    const challenge = await pkce()
    const states: Array<string | null> = [
      null,
      '',
      'héllo',
      'a+b',
      'a&b',
      '100%',
      'x'.repeat(1024),
    ]
    for (const state of states) {
      const params = authorizeParams(client.clientId, client.redirectUris[0], challenge, {
        state,
      })
      const response = await show(env, params, cookie)
      expect(response.status).toBe(200)
      const pending = pendingPair(response)
      const read = await readPendingRequest(
        new Request(`${ISSUER}/authorize`, { headers: { Cookie: pending } }),
        env.MCP_PROFILE_SESSION_ENCRYPTION_KEY,
      )
      expect(read.status).toBe('valid')
      if (read.status === 'valid') expect(read.payload.authorization.state).toBe(state)
    }
  })
})

describe('pending authorization cookie', () => {
  it('sends a fresh browser to Settings without putting the request in the URL', async () => {
    const env = createEnv()
    const client = await register(env, 'https://chatgpt.com/callback')
    const params = authorizeParams(client.clientId, client.redirectUris[0], await pkce(), {
      state: null,
    })
    const response = await show(env, params)
    const location = new URL(response.headers.get('Location') ?? '')
    expect(response.status).toBe(302)
    expect(location.href).toBe('https://rivolo.app/settings?mcp_oauth=1')
    expect(location.href).not.toContain('chatgpt.com')
    expect(location.href).not.toContain('code_challenge')
    const header = response.headers.getSetCookie()[0] ?? ''
    expect(header).toContain('Path=/api/mcp/oauth')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Secure')
    expect(header).not.toContain('Domain=')
    expect(header).not.toContain('chatgpt.com')
    expect(header).not.toContain('mcp-oauth-pending')
    expect(MCP_OAUTH_PENDING_KDF_SALT).toBe('rivolo:mcp-cookie-kdf:v1')
    expect(MCP_OAUTH_PENDING_KDF_INFO).toBe('rivolo:mcp-oauth-pending:v1')
  })

  it('round-trips the sealed request and clears it without dropping another cookie', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
    const env = createEnv()
    const client = await register(env, 'https://chatgpt.com/callback')
    const response = await show(
      env,
      authorizeParams(client.clientId, client.redirectUris[0], await pkce(), { state: '' }),
    )
    const pair = pendingPair(response) ?? ''
    const read = await readPendingRequest(
      new Request(`${ISSUER}/authorize`, { headers: { Cookie: pair } }),
      env.MCP_PROFILE_SESSION_ENCRYPTION_KEY,
    )
    expect(read.status).toBe('valid')
    if (read.status !== 'valid') return
    expect(read.payload.phase).toBe('setup')
    expect(read.payload.authorization.state).toBe('')
    expect(read.payload.expiresAt - read.payload.issuedAt).toBe(600)
    const profileHeader = await createMcpProfileSessionCookie(
      new Request(`${ISSUER}/authorize`),
      env,
      '11111111-1111-4111-8111-111111111111',
    )
    const headers = new Headers()
    headers.append('Set-Cookie', profileHeader)
    applyCookieHeaders(headers, [clearPendingCookieHeader(new Request(`${ISSUER}/authorize`))])
    const cookies = headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toContain('rivolo_mcp_profile=')
    expect(cookies[1]).toContain('Max-Age=0')
    expect(cookies[1]).toContain('Path=/api/mcp/oauth')
    expect(await decryptToken(pair.split('=')[1], env.MCP_PROFILE_SESSION_ENCRYPTION_KEY)).toBeNull()
    expect(
      await openPendingPayload(
        profileHeader.split('=')[1].split(';')[0],
        env.MCP_PROFILE_SESSION_ENCRYPTION_KEY,
        new Date(),
      ),
    ).toBeNull()
  })

  it('fails closed for tampered, mistyped, expired, and future cookies', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const issued = new Date('2026-10-11T12:00:00Z')
    vi.setSystemTime(issued)
    const env = createEnv()
    const client = await register(env, 'https://chatgpt.com/callback')
    const response = await show(
      env,
      authorizeParams(client.clientId, client.redirectUris[0], await pkce()),
    )
    const value = decodeURIComponent((pendingPair(response) ?? '').split('=')[1])
    const secret = env.MCP_PROFILE_SESSION_ENCRYPTION_KEY
    const requestWith = (cookieValue: string) =>
      new Request(`${ISSUER}/pending`, {
        headers: { Cookie: `${MCP_OAUTH_PENDING_COOKIE}=${encodeURIComponent(cookieValue)}` },
      })
    expect((await readPendingRequest(requestWith(`${value.slice(0, -1)}A`), secret)).status).toBe(
      'invalid',
    )
    expect(
      (await readPendingRequest(requestWith(value), 'other-secret')).status,
    ).toBe('invalid')
    const sealed = JSON.parse((await openPendingPayload(value, secret, issued)) ? '{}' : '{}')
    void sealed
    const payload = await openPendingPayload(value, secret, issued)
    expect(payload).not.toBeNull()
    const wrongPurpose = await sealPendingJson(
      JSON.stringify({ ...(payload as PendingPayload), purpose: 'other' }),
      secret,
    )
    const future = await sealPendingJson(
      JSON.stringify({
        ...(payload as PendingPayload),
        issuedAt: payload!.issuedAt + 5,
        expiresAt: payload!.issuedAt + 605,
      }),
      secret,
    )
    const malformedJson = await sealPendingJson('{', secret)
    expect((await readPendingRequest(requestWith(wrongPurpose), secret)).status).toBe('invalid')
    expect((await readPendingRequest(requestWith(future), secret)).status).toBe('invalid')
    expect((await readPendingRequest(requestWith(malformedJson), secret)).status).toBe('invalid')
    vi.setSystemTime(new Date(issued.getTime() + 600_000))
    expect((await readPendingRequest(requestWith(value), secret)).status).toBe('invalid')
    const malformed = await readOAuthPendingStatus(
      new Request(`${ISSUER}/pending`, {
        headers: { Cookie: `${MCP_OAUTH_PENDING_COOKIE}=%E0%A4%A` },
      }),
      env,
    )
    expect(await malformed.json()).toEqual({ pending: false })
    expect(malformed.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })

  it('accepts a cookie at the size boundary and redirects a larger trusted request', async () => {
    const env = createEnv()
    const request = new Request(`${ISSUER}/authorize`)
    const challenge = await pkce()
    const payloadFor = (redirectUri: string): PendingPayload => ({
      version: 1,
      purpose: 'mcp-oauth-pending',
      transactionId: base64Url(new Uint8Array(32)),
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      phase: 'setup',
      authorization: {
        response_type: 'code',
        client_id: 'rvc_size_boundary_client',
        redirect_uri: redirectUri,
        state: 's'.repeat(1024),
        scope: 'notes:read notes:write',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: RESOURCE,
      },
    })
    // The stored client id must match the registration pattern for a real request.
    let acceptedLength = 0
    let rejectedLength = 0
    for (let length = 200; length <= 1800; length += 20) {
      const redirectUri = `https://chatgpt.com/${'a'.repeat(length)}`
      const header = await pendingCookieHeader(
        request,
        env.MCP_PROFILE_SESSION_ENCRYPTION_KEY,
        { ...payloadFor(redirectUri), authorization: { ...payloadFor(redirectUri).authorization, client_id: 'rvc_aaaaaaaaaaaaaaaaaaaaaa' } },
        new Date(),
      )
      if (header.ok) acceptedLength = length
      else if (header.reason === 'too_large') {
        rejectedLength = length
        break
      }
    }
    expect(acceptedLength).toBeGreaterThan(0)
    expect(rejectedLength).toBeGreaterThan(acceptedLength)
    const accepted = await pendingCookieHeader(
      request,
      env.MCP_PROFILE_SESSION_ENCRYPTION_KEY,
      {
        ...payloadFor(`https://chatgpt.com/${'a'.repeat(acceptedLength)}`),
        authorization: {
          ...payloadFor(`https://chatgpt.com/${'a'.repeat(acceptedLength)}`).authorization,
          client_id: 'rvc_aaaaaaaaaaaaaaaaaaaaaa',
        },
      },
      new Date(),
    )
    expect(accepted.ok).toBe(true)
    if (accepted.ok) {
      expect(new TextEncoder().encode(accepted.header).byteLength).toBeLessThanOrEqual(3800)
    }

    const redirectUri = `https://chatgpt.com/${'b'.repeat(rejectedLength)}`
    const client = await register(env, redirectUri)
    const response = await show(
      env,
      authorizeParams(client.clientId, client.redirectUris[0], challenge, {
        state: 's'.repeat(1024),
      }),
    )
    const location = acceptIssuer(response.headers.get('Location') ?? '', ISSUER)
    expect(response.status).toBe(302)
    expect(location.searchParams.get('error')).toBe('invalid_request')
    expect(location.searchParams.get('error_description')).toBe(
      'The authorization request is too large to continue.',
    )
    expect(response.headers.getSetCookie().some((cookie) => cookie.includes('Max-Age=600'))).toBe(
      false,
    )
  })

  it('reports banner fields only and resumes without extending the request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
    const env = createEnv()
    const client = await register(env, 'https://chatgpt.com/callback')
    const started = await show(
      env,
      authorizeParams(client.clientId, client.redirectUris[0], await pkce()),
    )
    const pair = pendingPair(started) ?? ''
    const pendingRequest = new Request(`${ISSUER}/pending`, { headers: { Cookie: pair } })
    const status = await readOAuthPendingStatus(pendingRequest, env)
    const body = await status.json()
    expect(status.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toMatchObject({
      pending: true,
      clientLabel: 'ChatGPT',
      ready: false,
    })
    expect(JSON.stringify(body)).not.toContain('chatgpt.com/callback')
    expect(JSON.stringify(body)).not.toContain('code_challenge')

    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const ready = await readOAuthPendingStatus(
      new Request(`${ISSUER}/pending`, { headers: { Cookie: `${pair}; ${cookie}` } }),
      env,
    )
    expect(await ready.json()).toMatchObject({ pending: true, ready: true })

    const transactionId = (body as { transactionId: string }).transactionId
    vi.setSystemTime(new Date('2026-10-11T12:01:40Z'))
    const resume = await showOAuthConsent(
      new Request(`${ISSUER}/authorize?resume=${transactionId}`, {
        headers: { Cookie: `${pair}; ${cookie}` },
      }),
      env,
    )
    expect(resume.status).toBe(200)
    expect(await resume.text()).toContain('Allow ChatGPT?')
    const rewritten = resume.headers.getSetCookie().find((cookie) => cookie.includes('Max-Age='))
    expect(rewritten).toContain('Max-Age=500')
    const resumed = await readPendingRequest(
      new Request(`${ISSUER}/authorize`, {
        headers: { Cookie: pendingPair(resume) },
      }),
      env.MCP_PROFILE_SESSION_ENCRYPTION_KEY,
    )
    expect(resumed.status).toBe('valid')
    if (resumed.status === 'valid') {
      expect(resumed.payload.phase).toBe('consent')
      expect(resumed.payload.expiresAt).toBe(
        Math.floor(new Date('2026-10-11T12:00:00Z').getTime() / 1000) + 600,
      )
    }

    const again = await showOAuthConsent(
      new Request(`${ISSUER}/authorize?resume=${transactionId}`, {
        headers: { Cookie: pair },
      }),
      env,
    )
    const setupHtml = await again.text()
    expect(again.status).toBe(200)
    expect(again.headers.get('Location')).toBeNull()
    expect(setupHtml).toContain('https://rivolo.app/settings?mcp_oauth=1')
    expect(setupHtml).toContain('Cancel connection')

    const mixed = await showOAuthConsent(
      new Request(
        `${ISSUER}/authorize?resume=${transactionId}&client_id=${client.clientId}`,
        { headers: { Cookie: pair } },
      ),
      env,
    )
    expect(mixed.status).toBe(400)
    expect(mixed.headers.get('Location')).toBeNull()
  })

  it('cancels from the confirmation form without an active profile', async () => {
    const env = createEnv()
    const client = await register(env, 'https://chatgpt.com/callback?foo=1')
    const params = authorizeParams(client.clientId, client.redirectUris[0], await pkce(), {
      state: 'cancel-state',
    })
    const started = await show(env, params)
    const pair = pendingPair(started) ?? ''
    const read = await readPendingRequest(
      new Request(`${ISSUER}/authorize`, { headers: { Cookie: pair } }),
      env.MCP_PROFILE_SESSION_ENCRYPTION_KEY,
    )
    if (read.status !== 'valid') throw new Error('Missing pending request.')
    const confirmation = await showOAuthConsent(
      new Request(`${ISSUER}/authorize?resume=${read.payload.transactionId}&cancel=1`, {
        headers: { Cookie: pair },
      }),
      env,
    )
    expect(confirmation.status).toBe(200)
    expect(confirmation.headers.get('Location')).toBeNull()
    const denied = await submitOAuthPendingCancellation(
      new Request(`${ISSUER}/pending`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://rivolo.app',
          Cookie: pair,
        },
        body: new URLSearchParams({
          decision: 'deny',
          transaction_id: read.payload.transactionId,
        }),
      }),
      env,
    )
    const location = acceptIssuer(denied.headers.get('Location') ?? '', ISSUER)
    expect(denied.status).toBe(302)
    expect(location.searchParams.get('error')).toBe('access_denied')
    expect(location.searchParams.get('state')).toBe('cancel-state')
    expect(location.searchParams.get('foo')).toBe('1')
    expect(location.searchParams.get('code')).toBeNull()
    expect(denied.headers.getSetCookie().some((cookie) => cookie.includes('Max-Age=0'))).toBe(true)

    const expired = await submitOAuthPendingCancellation(
      new Request(`${ISSUER}/pending`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://rivolo.app',
        },
        body: new URLSearchParams({
          decision: 'deny',
          transaction_id: read.payload.transactionId,
          redirect_uri: 'https://attacker.example/callback',
        }),
      }),
      env,
    )
    expect(expired.status).toBe(400)
    expect(expired.headers.get('Location')).toBeNull()
    expect(await expired.text()).not.toContain('attacker.example')
  })

  it('clears the previous pending transaction when a later trusted request fails', async () => {
    const env = createEnv()
    const client = await register(env, 'https://chatgpt.com/callback')
    const challenge = await pkce()
    const started = await show(
      env,
      authorizeParams(client.clientId, client.redirectUris[0], challenge, { state: 'first' }),
    )
    const pair = pendingPair(started) ?? ''
    const read = await readPendingRequest(
      new Request(`${ISSUER}/authorize`, { headers: { Cookie: pair } }),
      env.MCP_PROFILE_SESSION_ENCRYPTION_KEY,
    )
    if (read.status !== 'valid') throw new Error('Missing pending request.')
    const failed = await show(
      env,
      authorizeParams(client.clientId, client.redirectUris[0], challenge, {
        state: 'second',
        code_challenge: 'not-a-challenge',
      }),
      pair,
    )
    const location = acceptIssuer(failed.headers.get('Location') ?? '', ISSUER)
    expect(failed.status).toBe(302)
    expect(location.searchParams.get('error')).toBe('invalid_request')
    expect(location.searchParams.get('state')).toBe('second')
    const cleared = failed.headers
      .getSetCookie()
      .some(
        (cookie) =>
          cookie.startsWith(`${MCP_OAUTH_PENDING_COOKIE}=;`) && cookie.includes('Max-Age=0'),
      )
    expect(cleared).toBe(true)
    const resumed = await showOAuthConsent(
      new Request(`${ISSUER}/authorize?resume=${read.payload.transactionId}`, {
        headers: cleared ? {} : { Cookie: pair },
      }),
      env,
    )
    expect(resumed.status).toBe(400)
    expect(resumed.headers.get('Location')).toBeNull()
  })

  it('returns detail failures for a pending request to the trusted callback', async () => {
    const env = createEnv()
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const client = await register(env, 'https://chatgpt.com/callback?foo=1')
    const params = authorizeParams(client.clientId, client.redirectUris[0], await pkce(), {
      state: 'kept-state',
    })
    const setup = await show(env, params)
    const setupPair = pendingPair(setup) ?? ''
    const setupRead = await readPendingRequest(
      new Request(`${ISSUER}/authorize`, { headers: { Cookie: setupPair } }),
      env.MCP_PROFILE_SESSION_ENCRYPTION_KEY,
    )
    if (setupRead.status !== 'valid') throw new Error('Missing pending request.')
    const consent = await show(env, params, cookie)
    const consentId = transactionIdFrom(await consent.text())
    const consentPair = pendingPair(consent) ?? ''
    const cancel = await show(env, params)
    const cancelRead = await readPendingRequest(
      new Request(`${ISSUER}/authorize`, { headers: { Cookie: pendingPair(cancel) ?? '' } }),
      env.MCP_PROFILE_SESSION_ENCRYPTION_KEY,
    )
    if (cancelRead.status !== 'valid') throw new Error('Missing pending request.')
    const cancelPair = pendingPair(cancel) ?? ''
    env.MCP_RESOURCE_URL = 'https://mcp.rivolo.app/other'

    const expectResourceError = (response: Response) => {
      const location = acceptIssuer(response.headers.get('Location') ?? '', ISSUER)
      expect(response.status).toBe(302)
      expect(location.searchParams.get('error')).toBe('invalid_request')
      expect(location.searchParams.get('error_description')).toBe(
        'resource does not match the Rivolo MCP server.',
      )
      expect(location.searchParams.get('state')).toBe('kept-state')
      expect(location.searchParams.getAll('iss')).toEqual([ISSUER])
      expect(location.searchParams.get('foo')).toBe('1')
      expect(location.searchParams.get('code')).toBeNull()
      expect(response.headers.getSetCookie().some((header) => header.includes('Max-Age=0'))).toBe(
        true,
      )
    }

    expectResourceError(
      await showOAuthConsent(
        new Request(`${ISSUER}/authorize?resume=${setupRead.payload.transactionId}`, {
          headers: { Cookie: setupPair },
        }),
        env,
      ),
    )
    expectResourceError(
      await submitOAuthConsent(
        new Request(`${ISSUER}/authorize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'https://rivolo.app',
            Cookie: `${cookie}; ${consentPair}`,
          },
          body: new URLSearchParams([
            ...params,
            ['transaction_id', consentId],
            ['profile_id', profile.profileId],
            ['decision', 'allow'],
          ]),
        }),
        env,
      ),
    )
    expectResourceError(
      await submitOAuthPendingCancellation(
        new Request(`${ISSUER}/pending`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'https://rivolo.app',
            Cookie: cancelPair,
          },
          body: new URLSearchParams({
            decision: 'deny',
            transaction_id: cancelRead.payload.transactionId,
          }),
        }),
        env,
      ),
    )
    expect(
      (
        await (env.MCP_DB as unknown as SqliteD1)
          .prepare('SELECT COUNT(*) AS count FROM mcp_oauth_authorization_codes')
          .bind()
          .first<{ count: number }>()
      )?.count,
    ).toBe(0)
  })
})

describe('consent submission', () => {
  it('rejects a malformed consent body without issuing a code', async () => {
    const env = createEnv()
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const client = await register(env, 'https://chatgpt.com/callback')
    const params = authorizeParams(client.clientId, client.redirectUris[0], await pkce())
    const consent = await show(env, params, cookie)
    const transactionId = transactionIdFrom(await consent.text())
    const pair = pendingPair(consent) ?? ''
    const fields = new URLSearchParams([
      ...params,
      ['transaction_id', transactionId],
      ['profile_id', profile.profileId],
      ['decision', 'allow'],
    ])
    const post = (contentType: string, body: string) =>
      submitOAuthConsent(
        new Request(`${ISSUER}/authorize`, {
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            Origin: 'https://rivolo.app',
            Cookie: `${cookie}; ${pair}`,
          },
          body,
        }),
        env,
      )
    for (const [contentType, body] of [
      ['application/x-www-form-urlencodedevil', fields.toString()],
      ['application/x-www-form-urlencodedevil; charset=UTF-8', fields.toString()],
      ['application/x-www-form-urlencoded', `${fields.toString()}&junk=%FF%`],
    ] as const) {
      const response = await post(contentType, body)
      expect(response.status).toBe(400)
      expect(response.headers.get('Location')).toBeNull()
      expect(await response.text()).not.toContain('%FF')
    }
    expect(
      (
        await (env.MCP_DB as unknown as SqliteD1)
          .prepare('SELECT COUNT(*) AS count FROM mcp_oauth_authorization_codes')
          .bind()
          .first<{ count: number }>()
      )?.count,
    ).toBe(0)

    const accepted = await post(
      'application/x-www-form-urlencoded; charset=UTF-8',
      fields.toString(),
    )
    const location = acceptIssuer(accepted.headers.get('Location') ?? '', ISSUER)
    expect(location.searchParams.getAll('code')).toHaveLength(1)
  })

  it('issues one code or one denial and rejects unbound changes', async () => {
    const env = createEnv()
    const db = env.MCP_DB as unknown as SqliteD1
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const client = await register(env, 'https://chatgpt.com/callback?foo=1')
    const challenge = await pkce()
    const params = authorizeParams(client.clientId, client.redirectUris[0], challenge)
    const consent = await show(env, params, cookie)
    const html = await consent.text()
    const transactionId = transactionIdFrom(html)
    const pair = pendingPair(consent) ?? ''
    const submit = (body: URLSearchParams, extraCookie = cookie) =>
      submitOAuthConsent(
        new Request(`${ISSUER}/authorize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'https://rivolo.app',
            Cookie: `${extraCookie}; ${pair}`,
          },
          body,
        }),
        env,
      )
    const denied = await submit(
      new URLSearchParams([
        ...params,
        ['transaction_id', transactionId],
        ['profile_id', profile.profileId],
        ['decision', 'deny'],
      ]),
    )
    const denial = acceptIssuer(denied.headers.get('Location') ?? '', ISSUER)
    expect(denial.searchParams.get('error')).toBe('access_denied')
    expect(denial.searchParams.getAll('code')).toEqual([])
    expect(denial.searchParams.get('foo')).toBe('1')

    const consentAgain = await show(env, params, cookie)
    const allowId = transactionIdFrom(await consentAgain.text())
    const allowPair = pendingPair(consentAgain) ?? ''
    const allowed = await submitOAuthConsent(
      new Request(`${ISSUER}/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://rivolo.app',
          Cookie: `${cookie}; ${allowPair}`,
        },
        body: new URLSearchParams([
          ...params,
          ['transaction_id', allowId],
          ['profile_id', profile.profileId],
          ['decision', 'allow'],
        ]),
      }),
      env,
    )
    const success = acceptIssuer(allowed.headers.get('Location') ?? '', ISSUER)
    expect(success.searchParams.getAll('code')).toHaveLength(1)
    expect(success.searchParams.get('error')).toBeNull()
    expect(
      (await db.prepare('SELECT COUNT(*) AS count FROM mcp_oauth_authorization_codes').bind().first<{
        count: number
      }>())?.count,
    ).toBe(1)

    const invalidDecision = await show(env, params, cookie)
    const invalidId = transactionIdFrom(await invalidDecision.text())
    const invalidPair = pendingPair(invalidDecision) ?? ''
    const badDecision = await submitOAuthConsent(
      new Request(`${ISSUER}/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://rivolo.app',
          Cookie: `${cookie}; ${invalidPair}`,
        },
        body: new URLSearchParams([
          ...params,
          ['transaction_id', invalidId],
          ['profile_id', profile.profileId],
          ['decision', 'maybe'],
        ]),
      }),
      env,
    )
    expect(new URL(badDecision.headers.get('Location') ?? '').searchParams.get('error')).toBe(
      'invalid_request',
    )

    const foreign = await submitOAuthConsent(
      new Request(`${ISSUER}/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://attacker.example',
          Cookie: `${cookie}; ${invalidPair}`,
        },
        body: '{}',
      }),
      env,
    )
    expect(foreign.status).toBe(400)
    expect(foreign.headers.get('Location')).toBeNull()
  })

  it('uses the reviewed transaction when the profile, session, or hidden fields change', async () => {
    const env = createEnv()
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const client = await register(env, 'https://chatgpt.com/callback')
    const params = authorizeParams(client.clientId, client.redirectUris[0], await pkce())
    const consent = await show(env, params, cookie)
    const transactionId = transactionIdFrom(await consent.text())
    const pair = pendingPair(consent) ?? ''
    const post = (init: { cookie?: string; body: URLSearchParams; origin?: string }) =>
      submitOAuthConsent(
        new Request(`${ISSUER}/authorize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: init.origin ?? 'https://rivolo.app',
            ...(init.cookie ? { Cookie: init.cookie } : {}),
          },
          body: init.body,
        }),
        env,
      )

    const tampered = new URLSearchParams([
      ...params,
      ['transaction_id', transactionId],
      ['profile_id', profile.profileId],
      ['decision', 'allow'],
    ])
    tampered.set('redirect_uri', 'https://attacker.example/callback')
    const tamperedResponse = await post({ cookie: `${cookie}; ${pair}`, body: tampered })
    const tamperedLocation = acceptIssuer(tamperedResponse.headers.get('Location') ?? '', ISSUER)
    expect(tamperedLocation.origin).toBe('https://chatgpt.com')
    expect(tamperedLocation.searchParams.get('error')).toBe('invalid_request')
    expect(tamperedLocation.searchParams.get('code')).toBeNull()

    const consentForNonce = await show(env, params, cookie)
    const noncePair = pendingPair(consentForNonce) ?? ''
    const wrongNonce = await post({
      cookie: `${cookie}; ${noncePair}`,
      body: new URLSearchParams([
        ...params,
        ['transaction_id', 'A'.repeat(43)],
        ['profile_id', profile.profileId],
        ['decision', 'allow'],
      ]),
    })
    expect(wrongNonce.status).toBe(400)
    expect(wrongNonce.headers.get('Location')).toBeNull()

    const consentForSession = await show(env, params, cookie)
    const sessionId = transactionIdFrom(await consentForSession.text())
    const sessionPair = pendingPair(consentForSession) ?? ''
    const missingSession = await post({
      cookie: sessionPair,
      body: new URLSearchParams([
        ...params,
        ['transaction_id', sessionId],
        ['profile_id', profile.profileId],
        ['decision', 'allow'],
      ]),
    })
    expect(new URL(missingSession.headers.get('Location') ?? '').searchParams.get('error')).toBe(
      'access_denied',
    )

    await new ProviderProfileRepository(
      env.MCP_DB,
      env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
    ).revoke(profile.profileId)
    const consentForRevoke = await show(env, params, cookie)
    expect(consentForRevoke.status).toBe(302)
    expect(new URL(consentForRevoke.headers.get('Location') ?? '').pathname).toBe('/settings')
  })

  it('sanitizes dependency failures before and after callback trust', async () => {
    const secret = 'SELECT provider-refresh-secret FROM mcp'
    const before = createEnv()
    const client = await register(before, 'https://chatgpt.com/callback')
    const params = authorizeParams(client.clientId, client.redirectUris[0], await pkce())
    const failing = createEnv(before.MCP_DB as unknown as SqliteD1)
    failing.MCP_DB = {
      prepare: () => {
        throw new McpOAuthUnavailableError()
      },
    } as unknown as D1Database
    const local = await show(failing, params)
    const localText = await local.text()
    expect(local.status).toBe(503)
    expect(local.headers.get('Location')).toBeNull()
    expect(localText).not.toContain(secret)
    expect(localText).not.toContain('McpOAuthUnavailableError')

    const after = createEnv()
    const profile = await createProfile(after)
    const cookie = await sessionCookie(after, profile.profileId)
    const registered = await register(after, 'https://chatgpt.com/callback')
    const consent = await show(
      after,
      authorizeParams(registered.clientId, registered.redirectUris[0], await pkce()),
      cookie,
    )
    const original = after.MCP_DB.prepare.bind(after.MCP_DB)
    after.MCP_DB.prepare = ((sql: string) => {
      if (sql.includes('FROM mcp_provider_profiles')) throw new Error(secret)
      return original(sql)
    }) as D1Database['prepare']
    const transactionId = transactionIdFrom(await consent.text())
    const pair = pendingPair(consent) ?? ''
    const redirected = await submitOAuthConsent(
      new Request(`${ISSUER}/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://rivolo.app',
          Cookie: `${cookie}; ${pair}`,
        },
        body: new URLSearchParams([
          ...authorizeParams(registered.clientId, registered.redirectUris[0], await pkce()),
          ['transaction_id', transactionId],
          ['profile_id', profile.profileId],
          ['decision', 'allow'],
        ]),
      }),
      after,
    )
    const location = acceptIssuer(redirected.headers.get('Location') ?? '', ISSUER)
    expect(location.searchParams.get('error')).toBe('server_error')
    expect(location.searchParams.get('error_description')).not.toContain(secret)
    expect(redirected.headers.get('Location')).not.toContain(secret)
  })

  it('returns the configured issuer on metadata and both callback outcomes', async () => {
    const issuerUrl = 'https://auth.example/oauth'
    expect(resolveMcpOAuthConfig({ issuerUrl: `${issuerUrl}/` }).issuerUrl).toBe(issuerUrl)
    for (const candidate of [
      'http://auth.example/oauth',
      'https://user:pass@auth.example/oauth',
      'https://auth.example/oauth?',
      'https://auth.example/oauth#',
      'https://auth.example/oauth?x=1',
    ]) {
      expect(() => resolveMcpOAuthConfig({ issuerUrl: candidate })).toThrow(/canonical HTTPS/)
    }

    const env = createEnv()
    env.MCP_OAUTH_ISSUER_URL = issuerUrl
    expect(createMcpAuthorizationServerMetadata({ issuerUrl }).issuer).toBe(issuerUrl)
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const client = await register(env, 'https://chatgpt.com/callback')
    const params = authorizeParams(client.clientId, client.redirectUris[0], await pkce())
    const consent = await show(env, params, cookie)
    const transactionId = transactionIdFrom(await consent.text())
    const denied = await submitOAuthConsent(
      new Request(`${issuerUrl}/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://auth.example',
          Cookie: `${cookie}; ${pendingPair(consent)}`,
        },
        body: new URLSearchParams([
          ...params,
          ['transaction_id', transactionId],
          ['profile_id', profile.profileId],
          ['decision', 'deny'],
        ]),
      }),
      env,
    )
    expect(acceptIssuer(denied.headers.get('Location') ?? '', issuerUrl).searchParams.get('error')).toBe(
      'access_denied',
    )
    expect(() => acceptIssuer(denied.headers.get('Location') ?? '', `${issuerUrl}/`)).toThrow(
      /Reject issuer/,
    )
    expect(() => acceptIssuer('https://chatgpt.com/callback?code=abc', issuerUrl)).toThrow(
      /Reject issuer/,
    )
    expect(() =>
      acceptIssuer('https://chatgpt.com/callback?iss=https%3A%2F%2Fauth.example%2Foauth&iss=other', issuerUrl),
    ).toThrow(/Reject issuer/)
  })
})
