// Provider-agnostic helpers for storing an OAuth refresh token in an encrypted,
// HttpOnly cookie so it never reaches JS-readable client storage. Each provider
// supplies its own cookie name, path, and encryption secret via CookieConfig.

export type CookieConfig = {
  name: string
  path: string
  secret: string
  maxAgeSeconds: number
  tokenPayloadKey?: 'token' | 'refreshToken'
}

type CookiePayload = {
  version: 1
  token?: string
  refreshToken?: string
}

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
  if (!secret) throw new Error('Missing token encryption key.')
  const keyBytes = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export const encryptToken = async (
  token: string,
  secret: string,
  tokenPayloadKey: CookieConfig['tokenPayloadKey'] = 'token',
) => {
  const key = await getEncryptionKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const payload: CookiePayload = { version: 1, [tokenPayloadKey]: token }
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  )
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`
}

export const decryptToken = async (
  value: string,
  secret: string,
  tokenPayloadKey: CookieConfig['tokenPayloadKey'] = 'token',
) => {
  try {
    const [ivValue, encryptedValue, extra] = value.split('.')
    if (!ivValue || !encryptedValue || extra) return null
    const key = await getEncryptionKey(secret)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(ivValue) },
      key,
      base64UrlToBytes(encryptedValue),
    )
    const payload = JSON.parse(decoder.decode(decrypted)) as Partial<CookiePayload>
    const token = payload[tokenPayloadKey]
    return payload.version === 1 && typeof token === 'string' ? token : null
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

const cookieAttributes = (request: Request, path: string) => {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `Path=${path}; HttpOnly; SameSite=Strict${secure}`
}

export const createTokenCookieHeader = async (
  request: Request,
  config: CookieConfig,
  token: string,
) => {
  const encrypted = await encryptToken(token, config.secret, config.tokenPayloadKey)
  return `${config.name}=${encodeURIComponent(encrypted)}; Max-Age=${config.maxAgeSeconds}; ${cookieAttributes(request, config.path)}`
}

export const clearTokenCookieHeader = (request: Request, config: CookieConfig) =>
  `${config.name}=; Max-Age=0; ${cookieAttributes(request, config.path)}`

export const readStoredToken = async (request: Request, config: CookieConfig) => {
  const encrypted = readCookie(request, config.name)
  return encrypted ? decryptToken(encrypted, config.secret, config.tokenPayloadKey) : null
}

export const jsonResponse = (payload: unknown, status = 200, headers: HeadersInit = {}) => {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Content-Type', 'application/json')
  responseHeaders.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders })
}

// Reject cross-origin and non-XHR requests to state-changing endpoints (CSRF).
export const validateMutationRequest = (request: Request, allowedOrigins: string[]) => {
  const requestOrigin = request.headers.get('Origin')
  const allowed = new Set([new URL(request.url).origin, ...allowedOrigins])
  if (!requestOrigin || !allowed.has(requestOrigin)) {
    return 'Origin is not allowed.'
  }
  if (request.headers.get('X-Requested-With') !== 'XmlHttpRequest') {
    return 'Missing CSRF request header.'
  }
  return null
}
