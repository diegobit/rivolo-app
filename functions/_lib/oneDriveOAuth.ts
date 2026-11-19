import type { CookieConfig } from './tokenCookie'

export type OneDriveOAuthEnv = {
  ONEDRIVE_CLIENT_SECRET: string
  ONEDRIVE_CLIENT_ID: string
  ONEDRIVE_TOKEN_ENCRYPTION_KEY: string
  ONEDRIVE_ALLOWED_ORIGINS?: string
}

type OneDriveTokenResponse = {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  error?: string
  error_description?: string
}

export const ONEDRIVE_REFRESH_COOKIE = 'rivolo_onedrive_refresh'
const ONEDRIVE_COOKIE_PATH = '/api/onedrive'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400
const ONEDRIVE_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

export const oneDriveCookieConfig = (env: OneDriveOAuthEnv): CookieConfig => ({
  name: ONEDRIVE_REFRESH_COOKIE,
  path: ONEDRIVE_COOKIE_PATH,
  secret: env.ONEDRIVE_TOKEN_ENCRYPTION_KEY,
  maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
})

export const oneDriveAllowedOrigins = (env: OneDriveOAuthEnv) =>
  (env.ONEDRIVE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

const requestOneDriveToken = async (params: URLSearchParams) => {
  const response = await fetch(ONEDRIVE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  const payload = (await response.json().catch(() => ({}))) as OneDriveTokenResponse
  if (!response.ok || !payload.access_token || !payload.expires_in) {
    const error = new Error(payload.error_description || 'OneDrive token request failed.')
    ;(error as Error & { code?: string }).code = payload.error ?? 'TOKEN_REQUEST_FAILED'
    throw error
  }
  return payload as Required<Pick<OneDriveTokenResponse, 'access_token' | 'expires_in'>> &
    OneDriveTokenResponse
}

export const exchangeOneDriveCode = async (
  code: string,
  codeVerifier: string,
  redirectUri: string,
  env: OneDriveOAuthEnv,
) =>
  requestOneDriveToken(
    new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: env.ONEDRIVE_CLIENT_ID,
      client_secret: env.ONEDRIVE_CLIENT_SECRET,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  )

export const refreshOneDriveAccessToken = async (
  refreshToken: string,
  env: Pick<OneDriveOAuthEnv, 'ONEDRIVE_CLIENT_ID' | 'ONEDRIVE_CLIENT_SECRET'>,
) =>
  requestOneDriveToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: env.ONEDRIVE_CLIENT_ID,
      client_secret: env.ONEDRIVE_CLIENT_SECRET,
    }),
  )

export const toPublicOneDriveError = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code
  if (code === 'invalid_grant') {
    return { status: 401, code: 'AUTH_RECONNECT', message: 'OneDrive access expired. Connect again.' }
  }
  return {
    status: 502,
    code: 'ONEDRIVE_AUTH_FAILED',
    message: 'OneDrive authorization failed. Check the Microsoft app configuration and reconnect.',
  }
}
