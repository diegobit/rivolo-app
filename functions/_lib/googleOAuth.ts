import type { CookieConfig } from './tokenCookie'

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

export const GOOGLE_REFRESH_COOKIE = 'rivolo_gdrive_refresh'
const GOOGLE_COOKIE_PATH = '/api/google-drive'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400

export const googleCookieConfig = (env: GoogleOAuthEnv): CookieConfig => ({
  name: GOOGLE_REFRESH_COOKIE,
  path: GOOGLE_COOKIE_PATH,
  secret: env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
  tokenPayloadKey: 'refreshToken',
})

export const googleAllowedOrigins = (env: GoogleOAuthEnv) =>
  (env.GOOGLE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

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
