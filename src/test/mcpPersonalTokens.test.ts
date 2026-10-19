// @vitest-environment node
import { SqliteD1, closeTestDatabases } from './helpers/d1'
import { afterEach, describe, expect, it } from 'vitest'
import {
  authenticateMcpBearer,
  McpBearerAuthenticationError,
  McpPersonalTokenRepository,
  validateMcpPersonalTokenName,
} from '../../functions/_lib/mcpPersonalTokens'
import {
  createMcpProfileSessionCookie,
  type McpAgentAccessEnv,
} from '../../functions/_lib/mcpAgentAccess'
import { ProviderProfileRepository } from '../../functions/_lib/providerProfiles'
import { onRequestDelete as revokeToken } from '../../functions/api/mcp/tokens/[id]'
import {
  onRequestGet as listTokens,
  onRequestPost as createToken,
} from '../../functions/api/mcp/tokens/index'

const createEnv = (db: SqliteD1): McpAgentAccessEnv => ({
  MCP_DB: db as unknown as D1Database,
  MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: 'profile-token-secret',
  MCP_PROFILE_SESSION_ENCRYPTION_KEY: 'profile-session-secret',
  MCP_ALLOWED_ORIGINS: 'https://rivolo.app',
})

const cookiePair = (setCookie: string) => {
  const match = setCookie.match(/rivolo_mcp_profile=([^;,]+)/)
  if (!match) throw new Error('Missing profile session cookie.')
  return `rivolo_mcp_profile=${match[1]}`
}

const invoke = <Env>(
  handler: PagesFunction<Env>,
  request: Request,
  env: Env,
  params: Record<string, string> = {},
) =>
  handler({
    request,
    env,
    params,
  } as Parameters<PagesFunction<Env>>[0]) as Promise<Response>

const mutationRequest = (
  path: string,
  method: 'POST' | 'DELETE',
  cookie: string,
  body?: unknown,
) =>
  new Request(`https://rivolo.app${path}`, {
    method,
    headers: {
      Origin: 'https://rivolo.app',
      'X-Requested-With': 'XmlHttpRequest',
      Cookie: cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const createProfile = async (env: McpAgentAccessEnv, account = 'dbid:account') =>
  new ProviderProfileRepository(
    env.MCP_DB,
    env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
  ).createOrUpdate({
    provider: 'dropbox',
    providerAccountId: account,
    target: { path: '/inbox.md' },
    timeZone: 'Europe/Rome',
    refreshToken: 'provider-refresh-secret',
  })

const createSession = async (
  env: McpAgentAccessEnv,
  profileId: string,
) =>
  cookiePair(
    await createMcpProfileSessionCookie(
      new Request('https://rivolo.app/api/mcp/tokens'),
      env,
      profileId,
    ),
  )

describe('MCP personal access tokens', () => {
  it('creates, lists, authenticates, and revokes a named token without storing it', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const profile = await createProfile(env)
    const session = await createSession(env, profile.profileId)

    const createdResponse = await invoke(
      createToken,
      mutationRequest('/api/mcp/tokens', 'POST', session, {
        name: 'Codex Mac',
      }),
      env,
    )
    const createdPayload = (await createdResponse.json()) as {
      token: {
        tokenId: string
        name: string
        prefix: string
        token: string
        scopes: string[]
      }
    }
    expect(createdResponse.status).toBe(201)
    expect(createdPayload.token).toMatchObject({
      name: 'Codex Mac',
      scopes: ['notes:read', 'notes:write'],
    })
    expect(createdPayload.token.token).toMatch(/^rvl_[A-Za-z0-9_-]{43}$/)
    expect(createdPayload.token.prefix).toBe(
      createdPayload.token.token.slice(0, 12),
    )

    const stored = db.get('SELECT * FROM mcp_personal_tokens WHERE token_id = ?', createdPayload.token.tokenId)
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(stored)).not.toContain(createdPayload.token.token)

    const listedResponse = await invoke(
      listTokens,
      new Request('https://rivolo.app/api/mcp/tokens', {
        headers: { Cookie: session },
      }),
      env,
    )
    const listedText = await listedResponse.text()
    expect(listedResponse.status).toBe(200)
    expect(listedText).not.toContain(createdPayload.token.token)
    expect(listedText).not.toContain(stored?.token_hash)
    expect(JSON.parse(listedText)).toMatchObject({
      tokens: [
        {
          tokenId: createdPayload.token.tokenId,
          name: 'Codex Mac',
          prefix: createdPayload.token.prefix,
          revokedAt: null,
        },
      ],
    })

    const authenticated = await authenticateMcpBearer(
      new Request('https://mcp.rivolo.app/mcp', {
        headers: { Authorization: `Bearer ${createdPayload.token.token}` },
      }),
      env,
    )
    expect(authenticated).toMatchObject({
      profile: { profileId: profile.profileId, provider: 'dropbox' },
      token: { tokenId: createdPayload.token.tokenId, name: 'Codex Mac' },
    })
    expect(db.get('SELECT * FROM mcp_personal_tokens WHERE token_id = ?', createdPayload.token.tokenId)?.last_used_at).not.toBeNull()

    const revokedResponse = await invoke(
      revokeToken,
      mutationRequest(
        `/api/mcp/tokens/${createdPayload.token.tokenId}`,
        'DELETE',
        session,
      ),
      env,
      { id: createdPayload.token.tokenId },
    )
    expect(revokedResponse.status).toBe(200)
    expect(
      await authenticateMcpBearer(
        new Request('https://mcp.rivolo.app/mcp', {
          headers: { Authorization: `Bearer ${createdPayload.token.token}` },
        }),
        env,
      ),
    ).toBeNull()
  })

  it('records last_used_at at most once per hour per token', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const profile = await createProfile(env)
    let now = new Date('2026-07-16T12:00:00.000Z')
    const repository = new McpPersonalTokenRepository(
      env.MCP_DB,
      () => now,
      () => '33333333-3333-4333-8333-333333333333',
      () => `rvl_${'H'.repeat(43)}`,
    )
    const created = await repository.create(profile.profileId, 'Throttled token')

    await repository.touchLastUsed(created.tokenId)
    expect(db.get('SELECT * FROM mcp_personal_tokens WHERE token_id = ?', created.tokenId)?.last_used_at).toBe(
      '2026-07-16T12:00:00.000Z',
    )

    now = new Date('2026-07-16T12:30:00.000Z')
    await repository.touchLastUsed(created.tokenId)
    expect(db.get('SELECT * FROM mcp_personal_tokens WHERE token_id = ?', created.tokenId)?.last_used_at).toBe(
      '2026-07-16T12:00:00.000Z',
    )

    now = new Date('2026-07-16T13:00:01.000Z')
    await repository.touchLastUsed(created.tokenId)
    expect(db.get('SELECT * FROM mcp_personal_tokens WHERE token_id = ?', created.tokenId)?.last_used_at).toBe(
      '2026-07-16T13:00:01.000Z',
    )
  })

  it('rejects wrong tokens and tokens whose provider profile is revoked', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const profile = await createProfile(env)
    const repository = new McpPersonalTokenRepository(
      env.MCP_DB,
      () => new Date('2026-07-16T12:00:00.000Z'),
      () => '22222222-2222-4222-8222-222222222222',
      () => `rvl_${'A'.repeat(43)}`,
    )
    const created = await repository.create(profile.profileId, 'Claude')

    expect(
      await authenticateMcpBearer(
        new Request('https://mcp.rivolo.app/mcp', {
          headers: { Authorization: `Bearer rvl_${'B'.repeat(43)}` },
        }),
        env,
      ),
    ).toBeNull()
    expect(
      await authenticateMcpBearer(
        new Request('https://mcp.rivolo.app/mcp', {
          headers: { Authorization: 'Basic secret' },
        }),
        env,
      ),
    ).toBeNull()

    await new ProviderProfileRepository(
      env.MCP_DB,
      env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
    ).revoke(profile.profileId)
    expect(
      await authenticateMcpBearer(
        new Request('https://mcp.rivolo.app/mcp', {
          headers: { Authorization: `Bearer ${created.token}` },
        }),
        env,
      ),
    ).toBeNull()

    await createProfile(env)
    expect(
      await authenticateMcpBearer(
        new Request('https://mcp.rivolo.app/mcp', {
          headers: { Authorization: `Bearer ${created.token}` },
        }),
        env,
      ),
    ).toBeNull()
  })

  it('enforces token-name limits and requires an active profile session', async () => {
    expect(() => validateMcpPersonalTokenName('')).toThrow('name is invalid.')
    expect(() => validateMcpPersonalTokenName('x'.repeat(81))).toThrow(
      'name is invalid.',
    )
    expect(() => validateMcpPersonalTokenName('bad\nname')).toThrow(
      'name is invalid.',
    )

    const env = createEnv(new SqliteD1())
    const response = await invoke(
      createToken,
      mutationRequest('/api/mcp/tokens', 'POST', 'missing=session', {
        name: 'Codex',
      }),
      env,
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      code: 'AUTH_REQUIRED',
      message: 'Agent access is not enabled.',
    })
  })

  it('sanitizes storage failures without reflecting bearer secrets', async () => {
    const secret = `rvl_${'S'.repeat(43)}`
    const env = createEnv(new SqliteD1())
    env.MCP_DB = {
      prepare: () => {
        throw new Error(`query failed for ${secret}`)
      },
    } as unknown as D1Database

    const error = await authenticateMcpBearer(
      new Request('https://mcp.rivolo.app/mcp', {
        headers: { Authorization: `Bearer ${secret}` },
      }),
      env,
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(McpBearerAuthenticationError)
    expect(String(error)).toContain('MCP bearer authentication failed.')
    expect(String(error)).not.toContain(secret)
  })

  it('does not allow one profile session to revoke another profile token', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const owner = await createProfile(env, 'dbid:owner')
    const other = await createProfile(env, 'dbid:other')
    const token = await new McpPersonalTokenRepository(env.MCP_DB).create(
      owner.profileId,
      'Owner token',
    )
    const otherSession = await createSession(env, other.profileId)

    const response = await invoke(
      revokeToken,
      mutationRequest(
        `/api/mcp/tokens/${token.tokenId}`,
        'DELETE',
        otherSession,
      ),
      env,
      { id: token.tokenId },
    )
    expect(response.status).toBe(404)
    expect(db.get('SELECT * FROM mcp_personal_tokens WHERE token_id = ?', token.tokenId)?.revoked_at).toBeNull()
  })
})

afterEach(closeTestDatabases)
