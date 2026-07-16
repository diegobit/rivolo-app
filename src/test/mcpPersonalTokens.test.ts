// @vitest-environment node
import { describe, expect, it } from 'vitest'
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

type ProviderRow = {
  profile_id: string
  provider: 'dropbox' | 'google-drive'
  provider_account_id: string
  provider_email: string | null
  provider_name: string | null
  dropbox_path: string | null
  google_file_id: string | null
  google_folder_id: string | null
  google_file_name: string | null
  time_zone: string
  encrypted_refresh_token: string
  created_at: string
  updated_at: string
  revoked_at: string | null
}

type TokenRow = {
  token_id: string
  profile_id: string
  name: string
  token_hash: string
  token_prefix: string
  scopes: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

class FakeD1 {
  readonly profiles = new Map<string, ProviderRow>()
  readonly tokens = new Map<string, TokenRow>()

  prepare(sql: string) {
    return {
      bind: (...values: unknown[]) => ({
        first: async <T>() => this.first(sql, values) as T | null,
        all: async <T>() => ({ results: this.all(sql, values) as T[] }),
        run: async () => this.run(sql, values),
      }),
    }
  }

  private first(sql: string, values: unknown[]) {
    if (sql.includes('INSERT INTO mcp_provider_profiles')) {
      const [
        profileId,
        provider,
        providerAccountId,
        providerEmail,
        providerName,
        dropboxPath,
        googleFileId,
        googleFolderId,
        googleFileName,
        timeZone,
        encryptedRefreshToken,
        createdAt,
        updatedAt,
      ] = values as [
        string,
        ProviderRow['provider'],
        string,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string,
        string,
        string,
        string,
      ]
      const existing = [...this.profiles.values()].find(
        (row) =>
          row.provider === provider && row.provider_account_id === providerAccountId,
      )
      const row: ProviderRow = existing
        ? {
            ...existing,
            provider_email: providerEmail,
            provider_name: providerName,
            dropbox_path: dropboxPath,
            google_file_id: googleFileId,
            google_folder_id: googleFolderId,
            google_file_name: googleFileName,
            time_zone: timeZone,
            encrypted_refresh_token: encryptedRefreshToken,
            updated_at: updatedAt,
            revoked_at: null,
          }
        : {
            profile_id: profileId,
            provider,
            provider_account_id: providerAccountId,
            provider_email: providerEmail,
            provider_name: providerName,
            dropbox_path: dropboxPath,
            google_file_id: googleFileId,
            google_folder_id: googleFolderId,
            google_file_name: googleFileName,
            time_zone: timeZone,
            encrypted_refresh_token: encryptedRefreshToken,
            created_at: createdAt,
            updated_at: updatedAt,
            revoked_at: null,
          }
      this.profiles.set(row.profile_id, row)
      return row
    }

    if (sql.includes('INSERT INTO mcp_personal_tokens')) {
      const [tokenId, name, tokenHash, prefix, scopes, createdAt, profileId] =
        values as [string, string, string, string, string, string, string]
      const profile = this.profiles.get(profileId)
      if (!profile || profile.revoked_at || !profile.encrypted_refresh_token) {
        return null
      }
      const row: TokenRow = {
        token_id: tokenId,
        profile_id: profileId,
        name,
        token_hash: tokenHash,
        token_prefix: prefix,
        scopes,
        created_at: createdAt,
        last_used_at: null,
        revoked_at: null,
      }
      this.tokens.set(tokenId, row)
      return row
    }

    if (sql.includes('FROM mcp_personal_tokens AS token')) {
      const row = [...this.tokens.values()].find(
        (token) => token.token_hash === values[0],
      )
      if (!row || row.revoked_at) return null
      const profile = this.profiles.get(row.profile_id)
      if (!profile || profile.revoked_at || !profile.encrypted_refresh_token) {
        return null
      }
      return row
    }

    const profile = this.profiles.get(String(values[0]))
    if (!profile) return null
    if (sql.includes('SELECT encrypted_refresh_token')) {
      return profile.revoked_at
        ? null
        : { encrypted_refresh_token: profile.encrypted_refresh_token }
    }
    return profile
  }

  private all(sql: string, values: unknown[]) {
    if (!sql.includes('FROM mcp_personal_tokens')) {
      throw new Error(`Unexpected query: ${sql}`)
    }
    return [...this.tokens.values()]
      .filter((row) => row.profile_id === values[0])
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }

  private async run(sql: string, values: unknown[]) {
    if (sql.includes('UPDATE mcp_provider_profiles')) {
      const [updatedAt, revokedAt, profileId] = values as [string, string, string]
      const row = this.profiles.get(profileId)
      if (!row || row.revoked_at) return { meta: { changes: 0 } }
      this.profiles.set(profileId, {
        ...row,
        encrypted_refresh_token: '',
        updated_at: updatedAt,
        revoked_at: revokedAt,
      })
      this.tokens.forEach((token, tokenId) => {
        if (token.profile_id === profileId && !token.revoked_at) {
          this.tokens.set(tokenId, { ...token, revoked_at: revokedAt })
        }
      })
      return { meta: { changes: 1 } }
    }

    if (sql.includes('SET revoked_at = ?')) {
      const [revokedAt, tokenId, profileId] = values as [string, string, string]
      const row = this.tokens.get(tokenId)
      if (!row || row.profile_id !== profileId || row.revoked_at) {
        return { meta: { changes: 0 } }
      }
      this.tokens.set(tokenId, { ...row, revoked_at: revokedAt })
      return { meta: { changes: 1 } }
    }

    if (sql.includes('SET last_used_at = ?')) {
      const [lastUsedAt, tokenId] = values as [string, string]
      const row = this.tokens.get(tokenId)
      if (!row || row.revoked_at) return { meta: { changes: 0 } }
      this.tokens.set(tokenId, { ...row, last_used_at: lastUsedAt })
      return { meta: { changes: 1 } }
    }

    throw new Error(`Unexpected query: ${sql}`)
  }
}

const createEnv = (db: FakeD1): McpAgentAccessEnv => ({
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
    const db = new FakeD1()
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

    const stored = db.tokens.get(createdPayload.token.tokenId)
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
    expect(db.tokens.get(createdPayload.token.tokenId)?.last_used_at).not.toBeNull()

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

  it('rejects wrong tokens and tokens whose provider profile is revoked', async () => {
    const db = new FakeD1()
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

    const env = createEnv(new FakeD1())
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
    const env = createEnv(new FakeD1())
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
    const db = new FakeD1()
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
    expect(db.tokens.get(token.tokenId)?.revoked_at).toBeNull()
  })
})
