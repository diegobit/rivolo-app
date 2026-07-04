import type { CookieConfig } from './tokenCookie'

export type DropboxOAuthEnv = {
  DROPBOX_CLIENT_ID: string
  DROPBOX_TOKEN_ENCRYPTION_KEY: string
  DROPBOX_ALLOWED_ORIGINS?: string
}

type DropboxTokenResponse = {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  error?: string
  error_description?: string
}

export const DROPBOX_REFRESH_COOKIE = 'rivolo_dropbox_refresh'
const DROPBOX_COOKIE_PATH = '/api/dropbox'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400
const DROPBOX_TOKEN_ENDPOINT = 'https://api.dropboxapi.com/oauth2/token'
const DROPBOX_REVOKE_ENDPOINT = 'https://api.dropboxapi.com/2/auth/token/revoke'

export const dropboxCookieConfig = (env: DropboxOAuthEnv): CookieConfig => ({
  name: DROPBOX_REFRESH_COOKIE,
  path: DROPBOX_COOKIE_PATH,
  secret: env.DROPBOX_TOKEN_ENCRYPTION_KEY,
  maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
})

export const dropboxAllowedOrigins = (env: DropboxOAuthEnv) =>
  (env.DROPBOX_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

const requestDropboxToken = async (params: URLSearchParams) => {
  const response = await fetch(DROPBOX_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  const payload = (await response.json().catch(() => ({}))) as DropboxTokenResponse
  if (!response.ok || !payload.access_token || !payload.expires_in) {
    const error = new Error(payload.error_description || 'Dropbox token request failed.')
    ;(error as Error & { code?: string }).code = payload.error ?? 'TOKEN_REQUEST_FAILED'
    throw error
  }
  return payload as Required<Pick<DropboxTokenResponse, 'access_token' | 'expires_in'>> &
    DropboxTokenResponse
}

export const exchangeDropboxCode = async (
  code: string,
  codeVerifier: string,
  redirectUri: string,
  env: DropboxOAuthEnv,
) =>
  requestDropboxToken(
    new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: env.DROPBOX_CLIENT_ID,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  )

export const refreshDropboxAccessToken = async (refreshToken: string, env: DropboxOAuthEnv) =>
  requestDropboxToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: env.DROPBOX_CLIENT_ID,
    }),
  )

// Dropbox revocation needs an access token; revoking it also disables the paired
// refresh token. Best-effort: a failure leaves an orphaned grant, never a stuck disconnect.
export const revokeDropboxRefreshToken = async (refreshToken: string, env: DropboxOAuthEnv) => {
  try {
    const token = await refreshDropboxAccessToken(refreshToken, env)
    await fetch(DROPBOX_REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
  } catch {
    // Cookie clearing in the caller proceeds regardless.
  }
}

export const toPublicDropboxError = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code
  if (code === 'invalid_grant') {
    return { status: 401, code: 'AUTH_RECONNECT', message: 'Dropbox access expired. Connect again.' }
  }
  return {
    status: 502,
    code: 'DROPBOX_AUTH_FAILED',
    message: error instanceof Error ? error.message : 'Dropbox authorization failed.',
  }
}
