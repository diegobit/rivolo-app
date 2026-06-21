export type GoogleOAuthEnv = {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GOOGLE_TOKEN_ENCRYPTION_KEY: string
  GOOGLE_ALLOWED_ORIGINS?: string
}

type GoogleTokenResponse = {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  error?: string
  error_description?: string
}

type RefreshCookiePayload = {
  version: 1
  refreshToken: string
}

export const GOOGLE_REFRESH_COOKIE = 'rivolo_gdrive_refresh'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400
const encoder = new TextEncoder()
const decoder = new TextDecoder()

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

const getEncryptionKey = async (secret: string) => {
  if (!secret) throw new Error('Missing Google token encryption key.')
  const keyBytes = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export const encryptRefreshCookie = async (refreshToken: string, secret: string) => {
  const key = await getEncryptionKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const payload: RefreshCookiePayload = { version: 1, refreshToken }
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  )
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`
}

export const decryptRefreshCookie = async (value: string, secret: string) => {
  try {
    const [ivValue, encryptedValue, extra] = value.split('.')
    if (!ivValue || !encryptedValue || extra) return null
    const key = await getEncryptionKey(secret)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(ivValue) },
      key,
      base64UrlToBytes(encryptedValue),
    )
    const payload = JSON.parse(decoder.decode(decrypted)) as Partial<RefreshCookiePayload>
    return payload.version === 1 && typeof payload.refreshToken === 'string'
      ? payload.refreshToken
      : null
  } catch {
    return null
  }
}

export const readCookie = (request: Request, name: string) => {
  const cookie = request.headers.get('Cookie')
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim())
    }
  }
  return null
}

const cookieAttributes = (request: Request) => {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `Path=/api/google-drive; HttpOnly; SameSite=Strict${secure}`
}

export const createRefreshCookieHeader = async (
  request: Request,
  refreshToken: string,
  secret: string,
) => {
  const encrypted = await encryptRefreshCookie(refreshToken, secret)
  return `${GOOGLE_REFRESH_COOKIE}=${encodeURIComponent(encrypted)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; ${cookieAttributes(request)}`
}

export const clearRefreshCookieHeader = (request: Request) =>
  `${GOOGLE_REFRESH_COOKIE}=; Max-Age=0; ${cookieAttributes(request)}`

export const getStoredRefreshToken = async (request: Request, env: GoogleOAuthEnv) => {
  const encrypted = readCookie(request, GOOGLE_REFRESH_COOKIE)
  return encrypted ? decryptRefreshCookie(encrypted, env.GOOGLE_TOKEN_ENCRYPTION_KEY) : null
}

const configuredOrigins = (env: GoogleOAuthEnv) =>
  (env.GOOGLE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

export const validateMutationRequest = (request: Request, env: GoogleOAuthEnv) => {
  const requestOrigin = request.headers.get('Origin')
  const allowedOrigins = new Set([new URL(request.url).origin, ...configuredOrigins(env)])
  if (!requestOrigin || !allowedOrigins.has(requestOrigin)) {
    return 'Origin is not allowed.'
  }
  if (request.headers.get('X-Requested-With') !== 'XmlHttpRequest') {
    return 'Missing CSRF request header.'
  }
  return null
}

export const jsonResponse = (
  payload: unknown,
  status = 200,
  headers: HeadersInit = {},
) => {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Content-Type', 'application/json')
  responseHeaders.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders })
}

const requestGoogleToken = async (params: URLSearchParams) => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse
  if (!response.ok || !payload.access_token || !payload.expires_in) {
    const error = new Error(payload.error_description || 'Google token request failed.')
    ;(error as Error & { code?: string }).code = payload.error ?? 'TOKEN_REQUEST_FAILED'
    throw error
  }
  return payload as Required<Pick<GoogleTokenResponse, 'access_token' | 'expires_in'>> &
    GoogleTokenResponse
}

export const exchangeGoogleCode = async (
  code: string,
  redirectUri: string,
  env: GoogleOAuthEnv,
) =>
  requestGoogleToken(
    new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  )

export const refreshGoogleAccessToken = async (
  refreshToken: string,
  env: GoogleOAuthEnv,
) =>
  requestGoogleToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  )

export const toPublicOAuthError = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code
  if (code === 'invalid_grant') {
    return { status: 401, code: 'AUTH_RECONNECT', message: 'Google Drive access expired. Connect again.' }
  }
  return {
    status: 502,
    code: 'GOOGLE_AUTH_FAILED',
    message: error instanceof Error ? error.message : 'Google authorization failed.',
  }
}
