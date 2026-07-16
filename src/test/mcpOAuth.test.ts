// @vitest-environment node
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { describe, expect, it } from 'vitest'
import {
  authenticateMcpOAuthBearer,
  McpOAuthAuthenticationError,
  type McpOAuthEnv,
} from '../../functions/_lib/mcpOAuth'
import {
  exchangeOAuthToken,
  oauthMetadataResponse,
  protectedResourceMetadataResponse,
  registerOAuthClient,
  revokeOAuthToken,
  showOAuthConsent,
  submitOAuthConsent,
} from '../../functions/_lib/mcpOAuthHttp'
import {
  createMcpProfileSessionCookie,
} from '../../functions/_lib/mcpAgentAccess'
import {
  authenticateMcpBearer,
  McpPersonalTokenRepository,
} from '../../functions/_lib/mcpPersonalTokens'
import { ProviderProfileRepository } from '../../functions/_lib/providerProfiles'
import {
  createMcpBearerChallenge,
  createMcpProtectedResourceMetadata,
  DEFAULT_MCP_OAUTH_ISSUER_URL,
  DEFAULT_MCP_RESOURCE_URL,
  getMcpProtectedResourceMetadataUrl,
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
            return {
              meta: {
                changes: Number(result.changes),
                last_row_id: Number(result.lastInsertRowid),
              },
            }
          },
        }
      },
    }
  }
}

const createEnv = (db: SqliteD1): McpOAuthEnv => ({
  MCP_DB: db as unknown as D1Database,
  MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: 'profile-token-secret',
  MCP_PROFILE_SESSION_ENCRYPTION_KEY: 'profile-session-secret',
  MCP_ALLOWED_ORIGINS: 'https://rivolo.app',
})

const createProfile = async (env: McpOAuthEnv) =>
  new ProviderProfileRepository(
    env.MCP_DB,
    env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
  ).createOrUpdate({
    provider: 'dropbox',
    providerAccountId: 'dbid:oauth-user',
    providerEmail: 'notes@example.com',
    target: { path: '/inbox.md' },
    timeZone: 'Europe/Rome',
    refreshToken: 'provider-refresh-secret',
  })

const sessionCookie = async (env: McpOAuthEnv, profileId: string) => {
  const setCookie = await createMcpProfileSessionCookie(
    new Request(`${DEFAULT_MCP_OAUTH_ISSUER_URL}/authorize`),
    env,
    profileId,
  )
  const match = setCookie.match(/rivolo_mcp_profile=([^;,]+)/)
  if (!match) throw new Error('Missing profile session cookie.')
  return `rivolo_mcp_profile=${match[1]}`
}

const jsonRequest = (url: string, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const formRequest = (
  url: string,
  body: URLSearchParams,
  headers: HeadersInit = {},
) =>
  new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body,
  })

const registerClient = async (
  env: McpOAuthEnv,
  redirectUri = 'http://127.0.0.1:4567/callback',
) => {
  const response = await registerOAuthClient(
    jsonRequest(`${DEFAULT_MCP_OAUTH_ISSUER_URL}/register`, {
      redirect_uris: [redirectUri],
      client_name: 'Codex',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
    env,
  )
  const payload = (await response.json()) as { client_id: string }
  expect(response.status).toBe(201)
  return payload.client_id
}

const base64Url = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const pkce = async () => {
  const verifier = 'v'.repeat(64)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return { verifier, challenge: base64Url(new Uint8Array(digest)) }
}

const authorizationParameters = (
  clientId: string,
  redirectUri: string,
  challenge: string,
) =>
  new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state: 'client-state',
    scope: 'notes:read notes:write',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: DEFAULT_MCP_RESOURCE_URL,
  })

const completeConsent = async (
  env: McpOAuthEnv,
  cookie: string,
  parameters: URLSearchParams,
) => {
  const response = await submitOAuthConsent(
    formRequest(
      `${DEFAULT_MCP_OAUTH_ISSUER_URL}/authorize`,
      new URLSearchParams([...parameters, ['decision', 'allow']]),
      {
        Origin: 'https://rivolo.app',
        Cookie: cookie,
      },
    ),
    env,
  )
  expect(response.status).toBe(302)
  const redirect = new URL(response.headers.get('Location') ?? '')
  expect(redirect.searchParams.get('state')).toBe('client-state')
  expect(redirect.searchParams.get('iss')).toBe(DEFAULT_MCP_OAUTH_ISSUER_URL)
  return redirect.searchParams.get('code') ?? ''
}

const exchangeCode = (
  env: McpOAuthEnv,
  clientId: string,
  redirectUri: string,
  code: string,
  verifier: string,
) =>
  exchangeOAuthToken(
    formRequest(
      `${DEFAULT_MCP_OAUTH_ISSUER_URL}/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource: DEFAULT_MCP_RESOURCE_URL,
      }),
    ),
    env,
  )

describe('MCP OAuth metadata and registration', () => {
  it('publishes MCP discovery metadata and a resource-scoped bearer challenge', async () => {
    const env = createEnv(new SqliteD1())
    const response = oauthMetadataResponse(env)
    const authorizationMetadata = await response.json()
    expect(OAuthMetadataSchema.parse(authorizationMetadata)).toMatchObject({
      issuer: DEFAULT_MCP_OAUTH_ISSUER_URL,
      authorization_endpoint: `${DEFAULT_MCP_OAUTH_ISSUER_URL}/authorize`,
      token_endpoint: `${DEFAULT_MCP_OAUTH_ISSUER_URL}/token`,
      registration_endpoint: `${DEFAULT_MCP_OAUTH_ISSUER_URL}/register`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
    })
    const protectedMetadata = createMcpProtectedResourceMetadata()
    expect(OAuthProtectedResourceMetadataSchema.parse(protectedMetadata)).toEqual({
      resource: DEFAULT_MCP_RESOURCE_URL,
      authorization_servers: [DEFAULT_MCP_OAUTH_ISSUER_URL],
      scopes_supported: ['notes:read', 'notes:write'],
      bearer_methods_supported: ['header'],
      resource_name: 'Rivolo notes',
    })
    expect(await protectedResourceMetadataResponse(env).json()).toEqual(
      protectedMetadata,
    )
    expect(getMcpProtectedResourceMetadataUrl()).toBe(
      'https://mcp.rivolo.app/.well-known/oauth-protected-resource/mcp',
    )
    expect(createMcpBearerChallenge()).toContain(
      'resource_metadata="https://mcp.rivolo.app/.well-known/oauth-protected-resource/mcp"',
    )
  })

  it('registers only public clients with exact HTTPS or loopback redirects', async () => {
    const env = createEnv(new SqliteD1())
    const clientId = await registerClient(env)
    expect(clientId).toMatch(/^rvc_[A-Za-z0-9_-]{22}$/)

    const duplicate = await registerClient(env)
    expect(duplicate).toBe(clientId)

    for (const redirectUri of [
      'http://example.com/callback',
      'javascript:alert(1)',
      'com.example.app:/callback',
      'https://example.com/callback#fragment',
    ]) {
      const response = await registerOAuthClient(
        jsonRequest(`${DEFAULT_MCP_OAUTH_ISSUER_URL}/register`, {
          redirect_uris: [redirectUri],
        }),
        env,
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'invalid_request' })
    }
  })
})

describe('MCP OAuth authorization and tokens', () => {
  it('requires explicit consent, exact redirect/resource, and mandatory S256 PKCE', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const redirectUri = 'http://127.0.0.1:4567/callback'
    const clientId = await registerClient(env, redirectUri)
    const { challenge } = await pkce()
    const parameters = authorizationParameters(clientId, redirectUri, challenge)

    const consent = await showOAuthConsent(
      new Request(
        `${DEFAULT_MCP_OAUTH_ISSUER_URL}/authorize?${parameters.toString()}`,
        { headers: { Cookie: cookie } },
      ),
      env,
    )
    const consentHtml = await consent.text()
    expect(consent.status).toBe(200)
    expect(consentHtml).toContain('Allow Codex?')
    expect(consentHtml).toContain('notes@example.com')
    expect(consentHtml).not.toContain('provider-refresh-secret')

    const wrongRedirect = new URLSearchParams(parameters)
    wrongRedirect.set('redirect_uri', 'http://localhost:4567/callback')
    const mismatch = await showOAuthConsent(
      new Request(
        `${DEFAULT_MCP_OAUTH_ISSUER_URL}/authorize?${wrongRedirect.toString()}`,
        { headers: { Cookie: cookie } },
      ),
      env,
    )
    expect(mismatch.status).toBe(400)
    expect(await mismatch.text()).toContain(
      'redirect_uri does not match the registered value.',
    )

    const wrongResource = new URLSearchParams(parameters)
    wrongResource.set('resource', 'https://attacker.example/mcp')
    const resourceMismatch = await showOAuthConsent(
      new Request(
        `${DEFAULT_MCP_OAUTH_ISSUER_URL}/authorize?${wrongResource.toString()}`,
        { headers: { Cookie: cookie } },
      ),
      env,
    )
    expect(resourceMismatch.status).toBe(400)

    const noPkce = new URLSearchParams(parameters)
    noPkce.delete('code_challenge')
    expect(
      await (
        await showOAuthConsent(
          new Request(
            `${DEFAULT_MCP_OAUTH_ISSUER_URL}/authorize?${noPkce.toString()}`,
            { headers: { Cookie: cookie } },
          ),
          env,
        )
      ).text(),
    ).toContain('S256 PKCE is required.')
  })

  it('issues one-time codes and hashed audience-bound tokens without leaking secrets', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const redirectUri = 'http://localhost:9876/oauth/callback'
    const clientId = await registerClient(env, redirectUri)
    const { verifier, challenge } = await pkce()
    const parameters = authorizationParameters(clientId, redirectUri, challenge)
    const code = await completeConsent(env, cookie, parameters)
    expect(code).toMatch(/^rvc_code_[A-Za-z0-9_-]{43}$/)

    const storedCode = db.database
      .prepare('SELECT code_hash, used_at FROM mcp_oauth_authorization_codes')
      .get() as { code_hash: string; used_at: string | null }
    expect(storedCode.code_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(storedCode.code_hash).not.toContain(code)

    const wrongPkce = await exchangeCode(
      env,
      clientId,
      redirectUri,
      code,
      'x'.repeat(64),
    )
    expect(wrongPkce.status).toBe(400)
    expect(await wrongPkce.json()).toMatchObject({ error: 'invalid_grant' })
    expect(
      (
        db.database
          .prepare('SELECT used_at FROM mcp_oauth_authorization_codes')
          .get() as { used_at: string | null }
      ).used_at,
    ).toBeNull()

    const exchanged = await exchangeCode(
      env,
      clientId,
      redirectUri,
      code,
      verifier,
    )
    const tokens = (await exchanged.json()) as {
      access_token: string
      refresh_token: string
      scope: string
    }
    expect(exchanged.status).toBe(200)
    expect(tokens.access_token).toMatch(/^rva_[A-Za-z0-9_-]{43}$/)
    expect(tokens.refresh_token).toMatch(/^rvr_[A-Za-z0-9_-]{43}$/)

    const databaseText = JSON.stringify({
      code: db.database
        .prepare('SELECT * FROM mcp_oauth_authorization_codes')
        .all(),
      grants: db.database.prepare('SELECT * FROM mcp_oauth_token_grants').all(),
      profiles: db.database.prepare('SELECT * FROM mcp_provider_profiles').all(),
    })
    expect(databaseText).not.toContain(code)
    expect(databaseText).not.toContain(tokens.access_token)
    expect(databaseText).not.toContain(tokens.refresh_token)
    expect(databaseText).not.toContain('provider-refresh-secret')

    const authenticated = await authenticateMcpOAuthBearer(
      new Request(DEFAULT_MCP_RESOURCE_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }),
      env,
    )
    expect(authenticated).toMatchObject({
      profile: { profileId: profile.profileId },
      providerRefreshToken: 'provider-refresh-secret',
      clientId,
      scopes: ['notes:read', 'notes:write'],
      resource: DEFAULT_MCP_RESOURCE_URL,
    })

    const replay = await exchangeCode(
      env,
      clientId,
      redirectUri,
      code,
      verifier,
    )
    expect(replay.status).toBe(400)
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('rotates refresh tokens and revokes the whole family on replay', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const redirectUri = 'https://client.example/oauth/callback'
    const clientId = await registerClient(env, redirectUri)
    const { verifier, challenge } = await pkce()
    const code = await completeConsent(
      env,
      cookie,
      authorizationParameters(clientId, redirectUri, challenge),
    )
    const initialResponse = await exchangeCode(
      env,
      clientId,
      redirectUri,
      code,
      verifier,
    )
    const initial = (await initialResponse.json()) as {
      refresh_token: string
    }

    const refresh = () =>
      exchangeOAuthToken(
        formRequest(
          `${DEFAULT_MCP_OAUTH_ISSUER_URL}/token`,
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: initial.refresh_token,
            resource: DEFAULT_MCP_RESOURCE_URL,
          }),
        ),
        env,
      )
    const competingResponses = await Promise.all([refresh(), refresh()])
    expect(competingResponses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ])
    const rotatedResponse =
      competingResponses.find((response) => response.status === 200) ??
      (() => {
        throw new Error('Missing successful refresh response.')
      })()
    const replayResponse =
      competingResponses.find((response) => response.status === 400) ??
      (() => {
        throw new Error('Missing rejected refresh response.')
      })()
    const rotated = (await rotatedResponse.json()) as {
      access_token: string
      refresh_token: string
    }
    expect(rotated.refresh_token).not.toBe(initial.refresh_token)
    expect(await replayResponse.json()).toMatchObject({ error: 'invalid_grant' })
    expect(
      await authenticateMcpOAuthBearer(
        new Request(DEFAULT_MCP_RESOURCE_URL, {
          headers: { Authorization: `Bearer ${rotated.access_token}` },
        }),
        env,
      ),
    ).toBeNull()
  })

  it('rejects a valid token when the resource server audience is different', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const redirectUri = 'https://client.example/callback'
    const clientId = await registerClient(env, redirectUri)
    const { verifier, challenge } = await pkce()
    const code = await completeConsent(
      env,
      cookie,
      authorizationParameters(clientId, redirectUri, challenge),
    )
    const response = await exchangeCode(
      env,
      clientId,
      redirectUri,
      code,
      verifier,
    )
    const token = (await response.json()) as { access_token: string }

    expect(
      await authenticateMcpOAuthBearer(
        new Request(DEFAULT_MCP_RESOURCE_URL, {
          headers: { Authorization: `Bearer ${token.access_token}` },
        }),
        {
          ...env,
          MCP_RESOURCE_URL: 'https://mcp.rivolo.app/other-resource',
        },
      ),
    ).toBeNull()
  })

  it('invalidates OAuth tokens on profile revoke while preserving PAT fallback behavior', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const redirectUri = 'http://127.0.0.1:8787/callback'
    const clientId = await registerClient(env, redirectUri)
    const { verifier, challenge } = await pkce()
    const code = await completeConsent(
      env,
      cookie,
      authorizationParameters(clientId, redirectUri, challenge),
    )
    const response = await exchangeCode(
      env,
      clientId,
      redirectUri,
      code,
      verifier,
    )
    const oauth = (await response.json()) as { access_token: string }

    const personal = await new McpPersonalTokenRepository(env.MCP_DB).create(
      profile.profileId,
      'Static fallback',
    )
    expect(
      await authenticateMcpBearer(
        new Request(DEFAULT_MCP_RESOURCE_URL, {
          headers: { Authorization: `Bearer ${personal.token}` },
        }),
        env,
      ),
    ).not.toBeNull()

    await new ProviderProfileRepository(
      env.MCP_DB,
      env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
    ).revoke(profile.profileId)
    expect(
      await authenticateMcpOAuthBearer(
        new Request(DEFAULT_MCP_RESOURCE_URL, {
          headers: { Authorization: `Bearer ${oauth.access_token}` },
        }),
        env,
      ),
    ).toBeNull()
    expect(
      await authenticateMcpBearer(
        new Request(DEFAULT_MCP_RESOURCE_URL, {
          headers: { Authorization: `Bearer ${personal.token}` },
        }),
        env,
      ),
    ).toBeNull()
  })

  it('sanitizes storage failures without reflecting OAuth bearer secrets', async () => {
    const secret = `rva_${'S'.repeat(43)}`
    const env = createEnv(new SqliteD1())
    env.MCP_DB = {
      prepare: () => {
        throw new Error(`query failed for ${secret}`)
      },
    } as unknown as D1Database

    const error = await authenticateMcpOAuthBearer(
      new Request(DEFAULT_MCP_RESOURCE_URL, {
        headers: { Authorization: `Bearer ${secret}` },
      }),
      env,
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(McpOAuthAuthenticationError)
    expect(String(error)).toBe('McpOAuthAuthenticationError: MCP OAuth bearer authentication failed.')
    expect(String(error)).not.toContain(secret)
  })

  it('requires a same-origin user action and supports public-client revocation', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const profile = await createProfile(env)
    const cookie = await sessionCookie(env, profile.profileId)
    const redirectUri = 'https://client.example/callback'
    const clientId = await registerClient(env, redirectUri)
    const { verifier, challenge } = await pkce()
    const parameters = authorizationParameters(clientId, redirectUri, challenge)

    const crossOrigin = await submitOAuthConsent(
      formRequest(
        `${DEFAULT_MCP_OAUTH_ISSUER_URL}/authorize`,
        new URLSearchParams([...parameters, ['decision', 'allow']]),
        { Origin: 'https://attacker.example', Cookie: cookie },
      ),
      env,
    )
    expect(crossOrigin.status).toBe(400)
    expect(await crossOrigin.text()).toContain('Consent origin is invalid.')

    const code = await completeConsent(env, cookie, parameters)
    const response = await exchangeCode(
      env,
      clientId,
      redirectUri,
      code,
      verifier,
    )
    const token = (await response.json()) as { access_token: string }
    const revoked = await revokeOAuthToken(
      formRequest(
        `${DEFAULT_MCP_OAUTH_ISSUER_URL}/revoke`,
        new URLSearchParams({
          client_id: clientId,
          token: token.access_token,
        }),
      ),
      env,
    )
    expect(revoked.status).toBe(200)
    expect(
      await authenticateMcpOAuthBearer(
        new Request(DEFAULT_MCP_RESOURCE_URL, {
          headers: { Authorization: `Bearer ${token.access_token}` },
        }),
        env,
      ),
    ).toBeNull()
  })
})
