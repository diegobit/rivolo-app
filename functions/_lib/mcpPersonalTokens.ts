import {
  ProviderProfileRepository,
  ProviderProfileValidationError,
  type ProviderProfileMetadata,
} from './providerProfiles'
import type { McpAgentAccessEnv } from './mcpAgentAccess'

export const MCP_PERSONAL_TOKEN_SCOPES = ['notes:read', 'notes:write'] as const

export type McpPersonalTokenMetadata = {
  tokenId: string
  name: string
  prefix: string
  scopes: Array<(typeof MCP_PERSONAL_TOKEN_SCOPES)[number]>
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export type CreatedMcpPersonalToken = McpPersonalTokenMetadata & {
  token: string
}

export type AuthenticatedMcpBearer = {
  profile: ProviderProfileMetadata
  token: McpPersonalTokenMetadata
}

type McpPersonalTokenRow = {
  token_id: string
  name: string
  token_prefix: string
  scopes: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

type AuthenticatedTokenRow = McpPersonalTokenRow & {
  profile_id: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_PATTERN = /^rvl_[A-Za-z0-9_-]{43}$/
const TOKEN_PREFIX_LENGTH = 12
const TOKEN_NAME_MAX_LENGTH = 80
const encoder = new TextEncoder()

export class McpPersonalTokenValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpPersonalTokenValidationError'
  }
}

export class McpBearerAuthenticationError extends Error {
  constructor() {
    super('MCP bearer authentication failed.')
    this.name = 'McpBearerAuthenticationError'
  }
}

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const validateId = (value: string, field: string) => {
  if (!UUID.test(value)) {
    throw new McpPersonalTokenValidationError(`${field} is invalid.`)
  }
  return value
}

export const validateMcpPersonalTokenName = (value: unknown) => {
  if (typeof value !== 'string') {
    throw new McpPersonalTokenValidationError('name must be a string.')
  }
  const name = value.trim()
  const hasControlCharacter = [...name].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
  if (!name || name.length > TOKEN_NAME_MAX_LENGTH || hasControlCharacter) {
    throw new McpPersonalTokenValidationError('name is invalid.')
  }
  return name
}

const hashToken = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return bytesToHex(new Uint8Array(digest))
}

const createTokenSecret = () => {
  const random = crypto.getRandomValues(new Uint8Array(32))
  return `rvl_${bytesToBase64Url(random)}`
}

const toMetadata = (row: McpPersonalTokenRow): McpPersonalTokenMetadata => ({
  tokenId: row.token_id,
  name: row.name,
  prefix: row.token_prefix,
  scopes: [...MCP_PERSONAL_TOKEN_SCOPES],
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
})

export class McpPersonalTokenRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly createSecret: () => string = createTokenSecret,
  ) {}

  async create(profileId: string, rawName: unknown): Promise<CreatedMcpPersonalToken> {
    const name = validateMcpPersonalTokenName(rawName)
    const token = this.createSecret()
    if (!TOKEN_PATTERN.test(token)) {
      throw new Error('Personal token generator returned an invalid token.')
    }
    const tokenHash = await hashToken(token)
    const timestamp = this.now().toISOString()
    const row = await this.db
      .prepare(
        `INSERT INTO mcp_personal_tokens (
          token_id,
          profile_id,
          name,
          token_hash,
          token_prefix,
          scopes,
          created_at,
          last_used_at,
          revoked_at
        )
        SELECT ?, profile_id, ?, ?, ?, ?, ?, NULL, NULL
        FROM mcp_provider_profiles
        WHERE profile_id = ?
          AND revoked_at IS NULL
          AND encrypted_refresh_token <> ''
        RETURNING token_id, name, token_prefix, scopes, created_at, last_used_at, revoked_at`,
      )
      .bind(
        this.createId(),
        name,
        tokenHash,
        token.slice(0, TOKEN_PREFIX_LENGTH),
        MCP_PERSONAL_TOKEN_SCOPES.join(' '),
        timestamp,
        validateId(profileId, 'profileId'),
      )
      .first<McpPersonalTokenRow>()

    if (!row) {
      throw new McpPersonalTokenValidationError('Profile is not active.')
    }
    return { ...toMetadata(row), token }
  }

  async list(profileId: string): Promise<McpPersonalTokenMetadata[]> {
    const result = await this.db
      .prepare(
        `SELECT token_id, name, token_prefix, scopes, created_at, last_used_at, revoked_at
        FROM mcp_personal_tokens
        WHERE profile_id = ?
        ORDER BY created_at DESC`,
      )
      .bind(validateId(profileId, 'profileId'))
      .all<McpPersonalTokenRow>()

    return result.results.map(toMetadata)
  }

  async revoke(profileId: string, tokenId: string): Promise<boolean> {
    const timestamp = this.now().toISOString()
    const result = await this.db
      .prepare(
        `UPDATE mcp_personal_tokens
        SET revoked_at = ?
        WHERE token_id = ? AND profile_id = ? AND revoked_at IS NULL`,
      )
      .bind(
        timestamp,
        validateId(tokenId, 'tokenId'),
        validateId(profileId, 'profileId'),
      )
      .run()

    return result.meta.changes > 0
  }

  async findActive(token: string): Promise<AuthenticatedTokenRow | null> {
    if (!TOKEN_PATTERN.test(token)) return null
    return this.db
      .prepare(
        `SELECT
          token.token_id,
          token.profile_id,
          token.name,
          token.token_prefix,
          token.scopes,
          token.created_at,
          token.last_used_at,
          token.revoked_at
        FROM mcp_personal_tokens AS token
        INNER JOIN mcp_provider_profiles AS profile
          ON profile.profile_id = token.profile_id
        WHERE token.token_hash = ?
          AND token.revoked_at IS NULL
          AND profile.revoked_at IS NULL
          AND profile.encrypted_refresh_token <> ''`,
      )
      .bind(await hashToken(token))
      .first<AuthenticatedTokenRow>()
  }

  async touchLastUsed(tokenId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE mcp_personal_tokens
        SET last_used_at = ?
        WHERE token_id = ? AND revoked_at IS NULL`,
      )
      .bind(this.now().toISOString(), validateId(tokenId, 'tokenId'))
      .run()
  }
}

const parseBearerToken = (request: Request) => {
  const authorization = request.headers.get('Authorization')
  if (!authorization) return null
  const match = authorization.match(/^Bearer ([^\s]+)$/i)
  return match?.[1] ?? null
}

export const authenticateMcpBearer = async (
  request: Request,
  env: McpAgentAccessEnv,
): Promise<AuthenticatedMcpBearer | null> => {
  try {
    const bearer = parseBearerToken(request)
    if (!bearer) return null

    const tokens = new McpPersonalTokenRepository(env.MCP_DB)
    const activeToken = await tokens.findActive(bearer)
    if (!activeToken) return null

    const profiles = new ProviderProfileRepository(
      env.MCP_DB,
      env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
    )
    const [profile, credential] = await Promise.all([
      profiles.getMetadata(activeToken.profile_id),
      profiles.decryptCredential(activeToken.profile_id),
    ])
    if (!profile || profile.revokedAt || !credential) return null

    try {
      await tokens.touchLastUsed(activeToken.token_id)
    } catch {
      // Authentication must not fail because best-effort usage metadata failed.
    }
    return { profile, token: toMetadata(activeToken) }
  } catch (error) {
    if (error instanceof ProviderProfileValidationError) return null
    throw new McpBearerAuthenticationError()
  }
}
