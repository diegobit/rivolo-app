import {
  DEFAULT_MCP_OAUTH_ISSUER_URL,
  DEFAULT_MCP_RESOURCE_URL,
  MCP_OAUTH_SCOPES,
  resolveMcpOAuthConfig,
} from '../../src/lib/mcpOAuthMetadata'
import {
  ProviderProfileRepository,
  ProviderProfileValidationError,
  type ProviderProfileMetadata,
} from './providerProfiles'
import type { McpAgentAccessEnv } from './mcpAgentAccess'

export type McpOAuthEnv = McpAgentAccessEnv & {
  MCP_OAUTH_ISSUER_URL?: string
  MCP_RESOURCE_URL?: string
}

export type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number]

export type RegisteredOAuthClient = {
  clientId: string
  redirectUris: string[]
  clientName: string | null
  createdAt: string
}

export type OAuthAuthorizationRequest = {
  client: RegisteredOAuthClient
  redirectUri: string
  state: string | null
  scopes: McpOAuthScope[]
  codeChallenge: string
  resource: string
}

export type OAuthTokenResponse = {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

export type AuthenticatedMcpOAuthBearer = {
  profile: ProviderProfileMetadata
  /**
   * Internal transport credential. Never serialize this principal or include it
   * in MCP tool results, errors, or logs.
   */
  providerRefreshToken: string
  clientId: string
  scopes: McpOAuthScope[]
  expiresAt: number
  resource: string
}

type OAuthClientRow = {
  client_id: string
  redirect_uris: string
  client_name: string | null
  created_at: string
}

type AuthorizationCodeRow = {
  code_hash: string
  profile_id: string
  client_id: string
  redirect_uri: string
  code_challenge: string
  scopes: string
  resource: string
  expires_at: string
  used_at: string | null
}

type RefreshGrantRow = {
  grant_id: string
  family_id: string
  profile_id: string
  client_id: string
  resource: string
  scopes: string
  refresh_expires_at: string
  refresh_used_at: string | null
  family_revoked_at: string | null
  profile_revoked_at: string | null
  encrypted_refresh_token: string
}

type AccessGrantRow = {
  profile_id: string
  client_id: string
  resource: string
  scopes: string
  access_expires_at: string
}

const encoder = new TextEncoder()
const CLIENT_NAME_MAX_LENGTH = 100
const MAX_REDIRECT_URIS = 10
const MAX_REDIRECT_URI_LENGTH = 2048
const CODE_TTL_MS = 5 * 60 * 1000
const ACCESS_TTL_MS = 60 * 60 * 1000
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CLIENT_ID_PATTERN = /^rvc_[A-Za-z0-9_-]{22}$/
const AUTHORIZATION_CODE_PATTERN = /^rvc_code_[A-Za-z0-9_-]{43}$/
const ACCESS_TOKEN_PATTERN = /^rva_[A-Za-z0-9_-]{43}$/
const REFRESH_TOKEN_PATTERN = /^rvr_[A-Za-z0-9_-]{43}$/
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/
const hasControlCharacter = (value: string) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })

export class McpOAuthProtocolError extends Error {
  constructor(
    readonly code:
      | 'invalid_request'
      | 'invalid_client'
      | 'invalid_grant'
      | 'invalid_scope'
      | 'unsupported_grant_type'
      | 'unsupported_response_type',
    message: string,
  ) {
    super(message)
    this.name = 'McpOAuthProtocolError'
  }
}

export class McpOAuthAuthenticationError extends Error {
  constructor() {
    super('MCP OAuth bearer authentication failed.')
    this.name = 'McpOAuthAuthenticationError'
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

const hash = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return bytesToHex(new Uint8Array(digest))
}

const constantTimeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

const randomSecret = (prefix: string, bytes: number) =>
  `${prefix}${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))}`

const parseScopes = (value: string): McpOAuthScope[] => {
  const requested = value
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
  const scopes = requested.length ? [...new Set(requested)] : [...MCP_OAUTH_SCOPES]
  if (
    scopes.some(
      (scope): scope is string => !MCP_OAUTH_SCOPES.includes(scope as McpOAuthScope),
    )
  ) {
    throw new McpOAuthProtocolError('invalid_scope', 'Requested scope is not supported.')
  }
  return MCP_OAUTH_SCOPES.filter((scope) => scopes.includes(scope))
}

const validateClientId = (value: string) => {
  if (!CLIENT_ID_PATTERN.test(value)) {
    throw new McpOAuthProtocolError('invalid_client', 'Client is not registered.')
  }
  return value
}

const validateRedirectUri = (value: string) => {
  if (!value || value.length > MAX_REDIRECT_URI_LENGTH) {
    throw new McpOAuthProtocolError('invalid_request', 'redirect_uri is invalid.')
  }
  let redirect: URL
  try {
    redirect = new URL(value)
  } catch {
    throw new McpOAuthProtocolError('invalid_request', 'redirect_uri is invalid.')
  }
  const isLoopback =
    redirect.protocol === 'http:' &&
    (redirect.hostname === 'localhost' ||
      redirect.hostname === '127.0.0.1' ||
      redirect.hostname === '[::1]')
  if (
    redirect.hash ||
    redirect.username ||
    redirect.password ||
    (redirect.protocol !== 'https:' && !isLoopback)
  ) {
    throw new McpOAuthProtocolError('invalid_request', 'redirect_uri is not allowed.')
  }
  return redirect.href
}

const validateClientName = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') {
    throw new McpOAuthProtocolError('invalid_request', 'client_name is invalid.')
  }
  const name = value.trim()
  if (!name || name.length > CLIENT_NAME_MAX_LENGTH || hasControlCharacter(name)) {
    throw new McpOAuthProtocolError('invalid_request', 'client_name is invalid.')
  }
  return name
}

const parseStoredScopes = (value: string) => parseScopes(value)

const toClient = (row: OAuthClientRow): RegisteredOAuthClient => {
  let redirectUris: unknown
  try {
    redirectUris = JSON.parse(row.redirect_uris)
  } catch {
    throw new Error('Stored OAuth client redirects are invalid.')
  }
  if (!Array.isArray(redirectUris) || !redirectUris.every((uri) => typeof uri === 'string')) {
    throw new Error('Stored OAuth client redirects are invalid.')
  }
  return {
    clientId: row.client_id,
    redirectUris,
    clientName: row.client_name,
    createdAt: row.created_at,
  }
}

export const getMcpOAuthConfig = (env: McpOAuthEnv) =>
  resolveMcpOAuthConfig({
    issuerUrl: env.MCP_OAUTH_ISSUER_URL ?? DEFAULT_MCP_OAUTH_ISSUER_URL,
    resourceUrl: env.MCP_RESOURCE_URL ?? DEFAULT_MCP_RESOURCE_URL,
  })

export class McpOAuthRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly createClientId: () => string = () => randomSecret('rvc_', 16),
    private readonly createCode: () => string = () => randomSecret('rvc_code_', 32),
    private readonly createAccessToken: () => string = () => randomSecret('rva_', 32),
    private readonly createRefreshToken: () => string = () => randomSecret('rvr_', 32),
  ) {}

  async registerClient(input: {
    redirectUris: unknown
    clientName?: unknown
    tokenEndpointAuthMethod?: unknown
    grantTypes?: unknown
    responseTypes?: unknown
  }): Promise<RegisteredOAuthClient> {
    if (
      !Array.isArray(input.redirectUris) ||
      !input.redirectUris.length ||
      input.redirectUris.length > MAX_REDIRECT_URIS
    ) {
      throw new McpOAuthProtocolError('invalid_request', 'redirect_uris is invalid.')
    }
    const redirectUris = [
      ...new Set(
        input.redirectUris.map((uri) => {
          if (typeof uri !== 'string') {
            throw new McpOAuthProtocolError(
              'invalid_request',
              'redirect_uris is invalid.',
            )
          }
          return validateRedirectUri(uri)
        }),
      ),
    ]
    if (
      input.tokenEndpointAuthMethod !== undefined &&
      input.tokenEndpointAuthMethod !== 'none'
    ) {
      throw new McpOAuthProtocolError(
        'invalid_client',
        'Only public clients are supported.',
      )
    }
    const grantTypes =
      input.grantTypes === undefined
        ? ['authorization_code', 'refresh_token']
        : input.grantTypes
    if (
      !Array.isArray(grantTypes) ||
      grantTypes.some(
        (grant) => grant !== 'authorization_code' && grant !== 'refresh_token',
      ) ||
      !grantTypes.includes('authorization_code')
    ) {
      throw new McpOAuthProtocolError('invalid_request', 'grant_types is invalid.')
    }
    const responseTypes = input.responseTypes ?? ['code']
    if (
      !Array.isArray(responseTypes) ||
      responseTypes.length !== 1 ||
      responseTypes[0] !== 'code'
    ) {
      throw new McpOAuthProtocolError(
        'invalid_request',
        'response_types is invalid.',
      )
    }
    const clientName = validateClientName(input.clientName)
    const registration = JSON.stringify({
      redirect_uris: [...redirectUris].sort(),
      client_name: clientName,
    })
    const registrationHash = await hash(registration)
    const existing = await this.db
      .prepare(
        `SELECT client_id, redirect_uris, client_name, created_at
        FROM mcp_oauth_clients
        WHERE registration_hash = ?`,
      )
      .bind(registrationHash)
      .first<OAuthClientRow>()
    if (existing) return toClient(existing)

    const clientId = this.createClientId()
    if (!CLIENT_ID_PATTERN.test(clientId)) {
      throw new Error('OAuth client id generator returned an invalid value.')
    }
    const createdAt = this.now().toISOString()
    const row = await this.db
      .prepare(
        `INSERT INTO mcp_oauth_clients (
          client_id, registration_hash, redirect_uris, client_name, created_at
        ) VALUES (?, ?, ?, ?, ?)
        RETURNING client_id, redirect_uris, client_name, created_at`,
      )
      .bind(
        clientId,
        registrationHash,
        JSON.stringify(redirectUris),
        clientName,
        createdAt,
      )
      .first<OAuthClientRow>()
    if (!row) throw new Error('OAuth client was not persisted.')
    return toClient(row)
  }

  async getClient(clientId: string): Promise<RegisteredOAuthClient | null> {
    const row = await this.db
      .prepare(
        `SELECT client_id, redirect_uris, client_name, created_at
        FROM mcp_oauth_clients
        WHERE client_id = ?`,
      )
      .bind(validateClientId(clientId))
      .first<OAuthClientRow>()
    return row ? toClient(row) : null
  }

  async parseAuthorizationRequest(
    input: URLSearchParams,
    expectedResource: string,
  ): Promise<OAuthAuthorizationRequest> {
    if (input.get('response_type') !== 'code') {
      throw new McpOAuthProtocolError(
        'unsupported_response_type',
        'response_type must be code.',
      )
    }
    const clientId = validateClientId(input.get('client_id') ?? '')
    const client = await this.getClient(clientId)
    if (!client) {
      throw new McpOAuthProtocolError('invalid_client', 'Client is not registered.')
    }
    const redirectUri = validateRedirectUri(input.get('redirect_uri') ?? '')
    if (!client.redirectUris.includes(redirectUri)) {
      throw new McpOAuthProtocolError(
        'invalid_request',
        'redirect_uri does not match the registered value.',
      )
    }
    const codeChallenge = input.get('code_challenge') ?? ''
    if (
      input.get('code_challenge_method') !== 'S256' ||
      !PKCE_CHALLENGE_PATTERN.test(codeChallenge)
    ) {
      throw new McpOAuthProtocolError(
        'invalid_request',
        'S256 PKCE is required.',
      )
    }
    const resource = input.get('resource') ?? ''
    if (resource !== expectedResource) {
      throw new McpOAuthProtocolError(
        'invalid_request',
        'resource does not match the Rivolo MCP server.',
      )
    }
    const state = input.get('state')
    if (state !== null && (state.length > 1024 || hasControlCharacter(state))) {
      throw new McpOAuthProtocolError('invalid_request', 'state is invalid.')
    }
    return {
      client,
      redirectUri,
      state,
      scopes: parseScopes(input.get('scope') ?? ''),
      codeChallenge,
      resource,
    }
  }

  async issueAuthorizationCode(
    profileId: string,
    authorization: OAuthAuthorizationRequest,
  ) {
    const code = this.createCode()
    if (!AUTHORIZATION_CODE_PATTERN.test(code)) {
      throw new Error('Authorization code generator returned an invalid value.')
    }
    const createdAt = this.now()
    const result = await this.db
      .prepare(
        `INSERT INTO mcp_oauth_authorization_codes (
          code_hash,
          profile_id,
          client_id,
          redirect_uri,
          code_challenge,
          scopes,
          resource,
          created_at,
          expires_at,
          used_at
        )
        SELECT ?, profile_id, ?, ?, ?, ?, ?, ?, ?, NULL
        FROM mcp_provider_profiles
        WHERE profile_id = ?
          AND revoked_at IS NULL
          AND encrypted_refresh_token <> ''`,
      )
      .bind(
        await hash(code),
        authorization.client.clientId,
        authorization.redirectUri,
        authorization.codeChallenge,
        authorization.scopes.join(' '),
        authorization.resource,
        createdAt.toISOString(),
        new Date(createdAt.getTime() + CODE_TTL_MS).toISOString(),
        profileId,
      )
      .run()
    if (result.meta.changes !== 1) {
      throw new McpOAuthProtocolError(
        'invalid_request',
        'Rivolo agent access is not active.',
      )
    }
    return code
  }

  async exchangeAuthorizationCode(input: {
    clientId: string
    code: string
    codeVerifier: string
    redirectUri: string
    resource: string
  }): Promise<OAuthTokenResponse> {
    const clientId = validateClientId(input.clientId)
    if (!AUTHORIZATION_CODE_PATTERN.test(input.code)) {
      throw new McpOAuthProtocolError('invalid_grant', 'Authorization code is invalid.')
    }
    if (!PKCE_VERIFIER_PATTERN.test(input.codeVerifier)) {
      throw new McpOAuthProtocolError('invalid_grant', 'code_verifier is invalid.')
    }
    const row = await this.db
      .prepare(
        `SELECT
          code_hash,
          code.profile_id,
          code.client_id,
          code.redirect_uri,
          code.code_challenge,
          code.scopes,
          code.resource,
          code.expires_at,
          code.used_at
        FROM mcp_oauth_authorization_codes AS code
        INNER JOIN mcp_provider_profiles AS profile
          ON profile.profile_id = code.profile_id
        WHERE code.code_hash = ?
          AND profile.revoked_at IS NULL
          AND profile.encrypted_refresh_token <> ''`,
      )
      .bind(await hash(input.code))
      .first<AuthorizationCodeRow>()
    if (
      !row ||
      row.used_at ||
      row.client_id !== clientId ||
      row.redirect_uri !== validateRedirectUri(input.redirectUri) ||
      row.resource !== input.resource ||
      Date.parse(row.expires_at) <= this.now().getTime()
    ) {
      throw new McpOAuthProtocolError('invalid_grant', 'Authorization code is invalid.')
    }
    const expectedChallenge = bytesToBase64Url(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', encoder.encode(input.codeVerifier)),
      ),
    )
    if (!constantTimeEqual(expectedChallenge, row.code_challenge)) {
      throw new McpOAuthProtocolError('invalid_grant', 'PKCE verification failed.')
    }
    const usedAt = this.now().toISOString()
    const claim = await this.db
      .prepare(
        `UPDATE mcp_oauth_authorization_codes
        SET used_at = ?
        WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .bind(usedAt, row.code_hash, usedAt)
      .run()
    if (claim.meta.changes !== 1) {
      throw new McpOAuthProtocolError('invalid_grant', 'Authorization code is invalid.')
    }
    return this.createTokenFamily({
      profileId: row.profile_id,
      clientId,
      resource: row.resource,
      scopes: parseStoredScopes(row.scopes),
    })
  }

  async exchangeRefreshToken(input: {
    clientId: string
    refreshToken: string
    scopes?: string
    resource: string
  }): Promise<OAuthTokenResponse> {
    const clientId = validateClientId(input.clientId)
    if (!REFRESH_TOKEN_PATTERN.test(input.refreshToken)) {
      throw new McpOAuthProtocolError('invalid_grant', 'Refresh token is invalid.')
    }
    const row = await this.db
      .prepare(
        `SELECT
          grant.grant_id,
          grant.family_id,
          family.profile_id,
          family.client_id,
          family.resource,
          grant.scopes,
          grant.refresh_expires_at,
          grant.refresh_used_at,
          family.revoked_at AS family_revoked_at,
          profile.revoked_at AS profile_revoked_at,
          profile.encrypted_refresh_token
        FROM mcp_oauth_token_grants AS grant
        INNER JOIN mcp_oauth_token_families AS family
          ON family.family_id = grant.family_id
        INNER JOIN mcp_provider_profiles AS profile
          ON profile.profile_id = family.profile_id
        WHERE grant.refresh_token_hash = ?`,
      )
      .bind(await hash(input.refreshToken))
      .first<RefreshGrantRow>()
    if (!row) {
      throw new McpOAuthProtocolError('invalid_grant', 'Refresh token is invalid.')
    }
    if (row.refresh_used_at) {
      await this.revokeFamily(row.family_id)
      throw new McpOAuthProtocolError('invalid_grant', 'Refresh token is invalid.')
    }
    if (
      row.family_revoked_at ||
      row.profile_revoked_at ||
      !row.encrypted_refresh_token ||
      row.client_id !== clientId ||
      row.resource !== input.resource ||
      Date.parse(row.refresh_expires_at) <= this.now().getTime()
    ) {
      throw new McpOAuthProtocolError('invalid_grant', 'Refresh token is invalid.')
    }
    const originalScopes = parseStoredScopes(row.scopes)
    const scopes = input.scopes ? parseScopes(input.scopes) : originalScopes
    if (scopes.some((scope) => !originalScopes.includes(scope))) {
      throw new McpOAuthProtocolError(
        'invalid_scope',
        'Refresh scope exceeds the original grant.',
      )
    }
    const usedAt = this.now().toISOString()
    const claim = await this.db
      .prepare(
        `UPDATE mcp_oauth_token_grants
        SET refresh_used_at = ?
        WHERE grant_id = ? AND refresh_used_at IS NULL`,
      )
      .bind(usedAt, row.grant_id)
      .run()
    if (claim.meta.changes !== 1) {
      await this.revokeFamily(row.family_id)
      throw new McpOAuthProtocolError('invalid_grant', 'Refresh token is invalid.')
    }
    return this.createGrant({
      familyId: row.family_id,
      scopes,
    })
  }

  async revokeToken(clientId: string, token: string): Promise<void> {
    if (!CLIENT_ID_PATTERN.test(clientId)) return
    if (!ACCESS_TOKEN_PATTERN.test(token) && !REFRESH_TOKEN_PATTERN.test(token)) return
    const tokenHash = await hash(token)
    await this.db
      .prepare(
        `UPDATE mcp_oauth_token_families
        SET revoked_at = ?
        WHERE client_id = ?
          AND family_id IN (
            SELECT family_id
            FROM mcp_oauth_token_grants
            WHERE access_token_hash = ? OR refresh_token_hash = ?
          )
          AND revoked_at IS NULL`,
      )
      .bind(this.now().toISOString(), clientId, tokenHash, tokenHash)
      .run()
  }

  async findActiveAccessToken(token: string): Promise<AccessGrantRow | null> {
    if (!ACCESS_TOKEN_PATTERN.test(token)) return null
    return this.db
      .prepare(
        `SELECT
          family.profile_id,
          family.client_id,
          family.resource,
          grant.scopes,
          grant.access_expires_at
        FROM mcp_oauth_token_grants AS grant
        INNER JOIN mcp_oauth_token_families AS family
          ON family.family_id = grant.family_id
        INNER JOIN mcp_provider_profiles AS profile
          ON profile.profile_id = family.profile_id
        WHERE grant.access_token_hash = ?
          AND grant.access_revoked_at IS NULL
          AND grant.access_expires_at > ?
          AND family.revoked_at IS NULL
          AND profile.revoked_at IS NULL
          AND profile.encrypted_refresh_token <> ''`,
      )
      .bind(await hash(token), this.now().toISOString())
      .first<AccessGrantRow>()
  }

  private async createTokenFamily(input: {
    profileId: string
    clientId: string
    resource: string
    scopes: McpOAuthScope[]
  }) {
    const familyId = this.createId()
    const createdAt = this.now().toISOString()
    await this.db
      .prepare(
        `INSERT INTO mcp_oauth_token_families (
          family_id, profile_id, client_id, resource, created_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        familyId,
        input.profileId,
        input.clientId,
        input.resource,
        createdAt,
      )
      .run()
    return this.createGrant({ familyId, scopes: input.scopes })
  }

  private async createGrant(input: {
    familyId: string
    scopes: McpOAuthScope[]
  }): Promise<OAuthTokenResponse> {
    const accessToken = this.createAccessToken()
    const refreshToken = this.createRefreshToken()
    if (
      !ACCESS_TOKEN_PATTERN.test(accessToken) ||
      !REFRESH_TOKEN_PATTERN.test(refreshToken)
    ) {
      throw new Error('OAuth token generator returned an invalid value.')
    }
    const createdAt = this.now()
    await this.db
      .prepare(
        `INSERT INTO mcp_oauth_token_grants (
          grant_id,
          family_id,
          access_token_hash,
          refresh_token_hash,
          scopes,
          created_at,
          access_expires_at,
          refresh_expires_at,
          access_revoked_at,
          refresh_used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .bind(
        this.createId(),
        input.familyId,
        await hash(accessToken),
        await hash(refreshToken),
        input.scopes.join(' '),
        createdAt.toISOString(),
        new Date(createdAt.getTime() + ACCESS_TTL_MS).toISOString(),
        new Date(createdAt.getTime() + REFRESH_TTL_MS).toISOString(),
      )
      .run()
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_MS / 1000,
      refresh_token: refreshToken,
      scope: input.scopes.join(' '),
    }
  }

  private async revokeFamily(familyId: string) {
    await this.db
      .prepare(
        `UPDATE mcp_oauth_token_families
        SET revoked_at = ?
        WHERE family_id = ? AND revoked_at IS NULL`,
      )
      .bind(this.now().toISOString(), familyId)
      .run()
  }
}

const parseBearerToken = (request: Request) => {
  const authorization = request.headers.get('Authorization')
  if (!authorization) return null
  return authorization.match(/^Bearer ([^\s]+)$/i)?.[1] ?? null
}

export const authenticateMcpOAuthBearer = async (
  request: Request,
  env: McpOAuthEnv,
): Promise<AuthenticatedMcpOAuthBearer | null> => {
  try {
    const token = parseBearerToken(request)
    if (!token || !ACCESS_TOKEN_PATTERN.test(token)) return null
    const grant = await new McpOAuthRepository(env.MCP_DB).findActiveAccessToken(token)
    if (!grant) return null
    const { resourceUrl } = getMcpOAuthConfig(env)
    if (grant.resource !== resourceUrl) return null

    const profiles = new ProviderProfileRepository(
      env.MCP_DB,
      env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
    )
    const [profile, credential] = await Promise.all([
      profiles.getMetadata(grant.profile_id),
      profiles.decryptCredential(grant.profile_id),
    ])
    if (!profile || profile.revokedAt || !credential) return null
    return {
      profile,
      providerRefreshToken: credential,
      clientId: grant.client_id,
      scopes: parseStoredScopes(grant.scopes),
      expiresAt: Math.floor(Date.parse(grant.access_expires_at) / 1000),
      resource: grant.resource,
    }
  } catch (error) {
    if (
      error instanceof ProviderProfileValidationError ||
      error instanceof McpOAuthProtocolError
    ) {
      return null
    }
    throw new McpOAuthAuthenticationError()
  }
}
