import {
  type OAuthAuthorizationRequest,
} from './mcpOAuth'
import { readCookieResult } from './tokenCookie'

export const MCP_OAUTH_PENDING_COOKIE = 'rivolo_oauth_pending'
export const MCP_OAUTH_PENDING_PATH = '/api/mcp/oauth'
export const MCP_OAUTH_PENDING_TTL_SECONDS = 600
export const MCP_OAUTH_PENDING_COOKIE_LIMIT = 3800
export const MCP_OAUTH_PENDING_KDF_SALT = 'rivolo:mcp-cookie-kdf:v1'
export const MCP_OAUTH_PENDING_KDF_INFO = 'rivolo:mcp-oauth-pending:v1'

export type PendingAuthorization = {
  response_type: 'code'
  client_id: string
  redirect_uri: string
  state: string | null
  scope: string
  code_challenge: string
  code_challenge_method: 'S256'
  resource: string
}

export type PendingPayload = {
  version: 1
  purpose: 'mcp-oauth-pending'
  transactionId: string
  issuedAt: number
  expiresAt: number
  phase: 'setup' | 'consent'
  profileId: string | null
  authorization: PendingAuthorization
}

export type PendingCookieRead =
  | { status: 'absent' }
  | { status: 'invalid' }
  | { status: 'valid'; payload: PendingPayload }

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const CLIENT_ID_PATTERN = /^rvc_[A-Za-z0-9_-]{22}$/
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const base64UrlToBytes = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(`${normalized}${padding}`)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const isTransactionId = (value: string) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return false
  try {
    return base64UrlToBytes(value).length === 32
  } catch {
    return false
  }
}

const isEpochSeconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isPendingAuthorization = (value: unknown): value is PendingAuthorization => {
  if (!value || typeof value !== 'object') return false
  const authorization = value as PendingAuthorization
  return (
    authorization.response_type === 'code' &&
    typeof authorization.client_id === 'string' &&
    CLIENT_ID_PATTERN.test(authorization.client_id) &&
    typeof authorization.redirect_uri === 'string' &&
    authorization.redirect_uri.length > 0 &&
    authorization.redirect_uri.length <= 2048 &&
    (authorization.state === null ||
      (typeof authorization.state === 'string' && authorization.state.length <= 1024)) &&
    typeof authorization.scope === 'string' &&
    authorization.scope.length <= 256 &&
    typeof authorization.code_challenge === 'string' &&
    PKCE_CHALLENGE_PATTERN.test(authorization.code_challenge) &&
    authorization.code_challenge_method === 'S256' &&
    typeof authorization.resource === 'string' &&
    authorization.resource.length > 0 &&
    authorization.resource.length <= 2048
  )
}

export const pendingAuthorizationFromRequest = (
  authorization: OAuthAuthorizationRequest,
): PendingAuthorization => ({
  response_type: 'code',
  client_id: authorization.client.clientId,
  redirect_uri: authorization.redirectUri,
  state: authorization.state,
  scope: authorization.scopes.join(' '),
  code_challenge: authorization.codeChallenge,
  code_challenge_method: 'S256',
  resource: authorization.resource,
})

export const createPendingPayload = (
  authorization: OAuthAuthorizationRequest,
  phase: PendingPayload['phase'],
  profileId: string | null,
  now: Date,
): PendingPayload => {
  const issuedAt = Math.floor(now.getTime() / 1000)
  return {
    version: 1,
    purpose: 'mcp-oauth-pending',
    transactionId: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    issuedAt,
    expiresAt: issuedAt + MCP_OAUTH_PENDING_TTL_SECONDS,
    phase,
    profileId,
    authorization: pendingAuthorizationFromRequest(authorization),
  }
}

export const withPendingPhase = (
  payload: PendingPayload,
  phase: PendingPayload['phase'],
  profileId: string | null,
): PendingPayload => ({
  ...payload,
  phase,
  profileId,
})

const deriveKey = async (secret: string) => {
  if (!secret) throw new Error('Missing token encryption key.')
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(MCP_OAUTH_PENDING_KDF_SALT),
      info: encoder.encode(MCP_OAUTH_PENDING_KDF_INFO),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export const sealPendingJson = async (json: string, secret: string) => {
  const key = await deriveKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(json),
  )
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`
}

export const openPendingJson = async (value: string, secret: string) => {
  try {
    const [ivValue, encryptedValue, extra] = value.split('.')
    if (!ivValue || !encryptedValue || extra) return null
    const iv = base64UrlToBytes(ivValue)
    if (iv.length !== 12) return null
    const key = await deriveKey(secret)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      base64UrlToBytes(encryptedValue),
    )
    return decoder.decode(decrypted)
  } catch {
    return null
  }
}

const validatePendingPayload = (
  value: unknown,
  nowSeconds: number,
): PendingPayload | null => {
  if (!value || typeof value !== 'object') return null
  const payload = value as PendingPayload
  if (payload.version !== 1 || payload.purpose !== 'mcp-oauth-pending') return null
  if (payload.phase !== 'setup' && payload.phase !== 'consent') return null
  if (payload.phase === 'setup' && payload.profileId !== null) return null
  if (
    payload.phase === 'consent' &&
    (typeof payload.profileId !== 'string' || !PROFILE_ID_PATTERN.test(payload.profileId))
  ) {
    return null
  }
  if (!isTransactionId(payload.transactionId)) return null
  if (!isEpochSeconds(payload.issuedAt) || !isEpochSeconds(payload.expiresAt)) return null
  if (payload.expiresAt !== payload.issuedAt + MCP_OAUTH_PENDING_TTL_SECONDS) return null
  if (payload.issuedAt > nowSeconds || payload.expiresAt <= nowSeconds) return null
  if (!isPendingAuthorization(payload.authorization)) return null
  return payload
}

export const openPendingPayload = async (
  value: string,
  secret: string,
  now: Date,
) => {
  const json = await openPendingJson(value, secret)
  if (!json) return null
  try {
    return validatePendingPayload(JSON.parse(json), Math.floor(now.getTime() / 1000))
  } catch {
    return null
  }
}

const cookieAttributes = (request: Request) => {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `Path=${MCP_OAUTH_PENDING_PATH}; HttpOnly; SameSite=Lax${secure}`
}

export const clearPendingCookieHeader = (request: Request) =>
  `${MCP_OAUTH_PENDING_COOKIE}=; Max-Age=0; ${cookieAttributes(request)}`

export const pendingCookieHeader = async (
  request: Request,
  secret: string,
  payload: PendingPayload,
  now: Date,
): Promise<{ ok: true; header: string } | { ok: false; reason: 'expired' | 'too_large' }> => {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const validated = validatePendingPayload(payload, nowSeconds)
  if (!validated) return { ok: false, reason: 'expired' }
  const maxAge = validated.expiresAt - nowSeconds
  const header = `${MCP_OAUTH_PENDING_COOKIE}=${encodeURIComponent(
    await sealPendingJson(JSON.stringify(validated), secret),
  )}; Max-Age=${maxAge}; ${cookieAttributes(request)}`
  if (encoder.encode(header).byteLength > MCP_OAUTH_PENDING_COOKIE_LIMIT) {
    return { ok: false, reason: 'too_large' }
  }
  return { ok: true, header }
}

export const readPendingRequest = async (
  request: Request,
  secret: string,
  now = new Date(),
): Promise<PendingCookieRead> => {
  const cookie = readCookieResult(request, MCP_OAUTH_PENDING_COOKIE)
  if (cookie.status === 'absent') return { status: 'absent' }
  if (cookie.status === 'malformed') return { status: 'invalid' }
  const payload = await openPendingPayload(cookie.value, secret, now)
  return payload ? { status: 'valid', payload } : { status: 'invalid' }
}

export const pendingAuthorizationParams = (authorization: PendingAuthorization) => {
  const params = new URLSearchParams()
  params.set('response_type', authorization.response_type)
  params.set('client_id', authorization.client_id)
  params.set('redirect_uri', authorization.redirect_uri)
  if (authorization.state !== null) params.set('state', authorization.state)
  params.set('scope', authorization.scope)
  params.set('code_challenge', authorization.code_challenge)
  params.set('code_challenge_method', authorization.code_challenge_method)
  params.set('resource', authorization.resource)
  return params
}

export const submittedAuthorizationMatches = (
  submitted: URLSearchParams,
  authorization: PendingAuthorization,
) => {
  const fields = [
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'code_challenge',
    'code_challenge_method',
    'resource',
  ] as const
  for (const field of fields) {
    const values = submitted.getAll(field)
    if (values.length !== 1 || values[0] !== authorization[field]) return false
  }
  const state = submitted.getAll('state')
  if (authorization.state === null) return state.length === 0
  return state.length === 1 && state[0] === authorization.state
}
