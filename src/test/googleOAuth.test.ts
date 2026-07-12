// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_REFRESH_COOKIE,
  googleAllowedOrigins,
  googleCookieConfig,
  type GoogleOAuthEnv,
} from '../../functions/_lib/googleOAuth'
import {
  clearTokenCookieHeader,
  createTokenCookieHeader,
  decryptToken,
  encryptToken,
  validateMutationRequest,
} from '../../functions/_lib/tokenCookie'
import { dropboxCookieConfig } from '../../functions/_lib/dropboxOAuth'
import { onRequestPost as refreshAccessToken } from '../../functions/api/google-drive/token'
import { onRequestPost as exchangeAuthorizationCode } from '../../functions/api/google-drive/exchange'

const env: GoogleOAuthEnv = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_TOKEN_ENCRYPTION_KEY: 'a-long-test-encryption-key',
}

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

const tamperEncryptedPayload = (value: string) => {
  const [iv, encryptedPayload, extra] = value.split('.')
  if (!iv || !encryptedPayload || extra) throw new Error('Expected an iv and encrypted payload.')

  const payloadBytes = base64UrlToBytes(encryptedPayload)
  const lastByte = payloadBytes.at(-1)
  if (lastByte === undefined) throw new Error('Expected a non-empty encrypted payload.')

  payloadBytes[payloadBytes.length - 1] = lastByte ^ 0x01
  return `${iv}.${bytesToBase64Url(payloadBytes)}`
}

afterEach(() => vi.unstubAllGlobals())

describe('Google OAuth backend boundary', () => {
  it('encrypts refresh tokens and rejects tampering', async () => {
    const encrypted = await encryptToken(
      'refresh-secret',
      env.GOOGLE_TOKEN_ENCRYPTION_KEY,
      googleCookieConfig(env).tokenPayloadKey,
    )

    expect(encrypted).not.toContain('refresh-secret')
    expect(
      await decryptToken(
        encrypted,
        env.GOOGLE_TOKEN_ENCRYPTION_KEY,
        googleCookieConfig(env).tokenPayloadKey,
      ),
    ).toBe('refresh-secret')
    expect(
      await decryptToken(
        tamperEncryptedPayload(encrypted),
        env.GOOGLE_TOKEN_ENCRYPTION_KEY,
        googleCookieConfig(env).tokenPayloadKey,
      ),
    ).toBeNull()
  })

  it('requires same-origin mutation requests and the CSRF header', () => {
    const valid = new Request('https://rivolo.app/api/google-drive/token', {
      method: 'POST',
      headers: { Origin: 'https://rivolo.app', 'X-Requested-With': 'XmlHttpRequest' },
    })
    const crossOrigin = new Request(valid.url, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'X-Requested-With': 'XmlHttpRequest' },
    })

    expect(validateMutationRequest(valid, googleAllowedOrigins(env))).toBeNull()
    expect(validateMutationRequest(crossOrigin, googleAllowedOrigins(env))).toBe('Origin is not allowed.')
  })

  it('preserves Google cookie attributes while both provider configs use the shared helper', async () => {
    const request = new Request('https://rivolo.app/api/google-drive/token')
    const googleConfig = googleCookieConfig(env)
    const dropboxConfig = dropboxCookieConfig({
      DROPBOX_CLIENT_ID: 'dropbox-client-id',
      DROPBOX_TOKEN_ENCRYPTION_KEY: 'another-long-test-encryption-key',
    })

    const googleHeader = await createTokenCookieHeader(request, googleConfig, 'google-refresh-token')
    const dropboxHeader = await createTokenCookieHeader(request, dropboxConfig, 'dropbox-refresh-token')

    expect(googleHeader.slice(googleHeader.indexOf('; ') + 2)).toBe(
      'Max-Age=34560000; Path=/api/google-drive; HttpOnly; SameSite=Strict; Secure',
    )
    expect(clearTokenCookieHeader(request, googleConfig)).toBe(
      'rivolo_gdrive_refresh=; Max-Age=0; Path=/api/google-drive; HttpOnly; SameSite=Strict; Secure',
    )
    expect(await decryptToken(googleHeader.split(';', 1)[0].split('=')[1], googleConfig.secret, googleConfig.tokenPayloadKey)).toBe('google-refresh-token')
    expect(dropboxHeader).toContain('Path=/api/dropbox; HttpOnly; SameSite=Strict; Secure')
    expect(await decryptToken(dropboxHeader.split(';', 1)[0].split('=')[1], dropboxConfig.secret)).toBe('dropbox-refresh-token')
  })

  it('refreshes silently from the HttpOnly cookie and rotates its expiry', async () => {
    const requestUrl = 'https://rivolo.app/api/google-drive/token'
    const config = googleCookieConfig(env)
    const cookie = await createTokenCookieHeader(new Request(requestUrl), config, 'refresh-secret')
    const cookiePair = cookie.split(';', 1)[0]
    expect(cookie).toContain('Max-Age=34560000')
    expect(cookie).toContain('Path=/api/google-drive')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Secure')
    expect(clearTokenCookieHeader(new Request(requestUrl), config)).toBe(
      'rivolo_gdrive_refresh=; Max-Age=0; Path=/api/google-drive; HttpOnly; SameSite=Strict; Secure',
    )
    const googleFetch = vi.fn(async () =>
      Response.json({ access_token: 'access-token', expires_in: 3600 }),
    )
    vi.stubGlobal('fetch', googleFetch)
    const request = new Request('https://rivolo.app/api/google-drive/token', {
      method: 'POST',
      headers: {
        Origin: 'https://rivolo.app',
        'X-Requested-With': 'XmlHttpRequest',
        Cookie: cookiePair,
      },
    })

    const response = await refreshAccessToken({ request, env } as never)
    const payload = (await (response as Response).json()) as { accessToken: string }

    expect(payload.accessToken).toBe('access-token')
    expect((response as Response).headers.get('Set-Cookie')).toContain(`${GOOGLE_REFRESH_COOKIE}=`)
    expect(googleFetch).toHaveBeenCalledOnce()
    const [, requestInit] = googleFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(requestInit.body)).toContain('refresh_token=refresh-secret')
  })

  it('preserves the stored refresh token when a later code exchange omits it', async () => {
    const cookie = await createTokenCookieHeader(
      new Request('https://rivolo.app/api/google-drive/exchange'),
      googleCookieConfig(env),
      'existing-refresh-token',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ access_token: 'new-access-token', expires_in: 3600 })),
    )
    const request = new Request('https://rivolo.app/api/google-drive/exchange', {
      method: 'POST',
      headers: {
        Origin: 'https://rivolo.app',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XmlHttpRequest',
        Cookie: cookie.split(';', 1)[0],
      },
      body: JSON.stringify({ code: 'authorization-code' }),
    })

    const response = (await exchangeAuthorizationCode({ request, env } as never)) as Response

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ accessToken: 'new-access-token' })
    const nextCookie = response.headers.get('Set-Cookie')?.split(';', 1)[0].split('=')[1]
    expect(
      await decryptToken(
        decodeURIComponent(nextCookie ?? ''),
        env.GOOGLE_TOKEN_ENCRYPTION_KEY,
        googleCookieConfig(env).tokenPayloadKey,
      ),
    ).toBe('existing-refresh-token')
  })
})
