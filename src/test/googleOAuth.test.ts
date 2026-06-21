// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_REFRESH_COOKIE,
  createRefreshCookieHeader,
  decryptRefreshCookie,
  encryptRefreshCookie,
  validateMutationRequest,
  type GoogleOAuthEnv,
} from '../../functions/_lib/googleOAuth'
import { onRequestPost as refreshAccessToken } from '../../functions/api/google-drive/token'
import { onRequestPost as exchangeAuthorizationCode } from '../../functions/api/google-drive/exchange'

const env: GoogleOAuthEnv = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_TOKEN_ENCRYPTION_KEY: 'a-long-test-encryption-key',
}

afterEach(() => vi.unstubAllGlobals())

describe('Google OAuth backend boundary', () => {
  it('encrypts refresh tokens and rejects tampering', async () => {
    const encrypted = await encryptRefreshCookie('refresh-secret', env.GOOGLE_TOKEN_ENCRYPTION_KEY)

    expect(encrypted).not.toContain('refresh-secret')
    expect(await decryptRefreshCookie(encrypted, env.GOOGLE_TOKEN_ENCRYPTION_KEY)).toBe('refresh-secret')
    expect(
      await decryptRefreshCookie(`${encrypted.slice(0, -1)}x`, env.GOOGLE_TOKEN_ENCRYPTION_KEY),
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

    expect(validateMutationRequest(valid, env)).toBeNull()
    expect(validateMutationRequest(crossOrigin, env)).toBe('Origin is not allowed.')
  })

  it('refreshes silently from the HttpOnly cookie and rotates its expiry', async () => {
    const cookie = await createRefreshCookieHeader(
      new Request('https://rivolo.app/api/google-drive/token'),
      'refresh-secret',
      env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    )
    const cookiePair = cookie.split(';', 1)[0]
    expect(cookie).toContain('Max-Age=34560000')
    expect(cookie).toContain('Path=/api/google-drive')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Secure')
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
    const cookie = await createRefreshCookieHeader(
      new Request('https://rivolo.app/api/google-drive/exchange'),
      'existing-refresh-token',
      env.GOOGLE_TOKEN_ENCRYPTION_KEY,
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
      await decryptRefreshCookie(decodeURIComponent(nextCookie ?? ''), env.GOOGLE_TOKEN_ENCRYPTION_KEY),
    ).toBe('existing-refresh-token')
  })
})
