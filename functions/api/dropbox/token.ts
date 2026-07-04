import {
  dropboxAllowedOrigins,
  dropboxCookieConfig,
  refreshDropboxAccessToken,
  toPublicDropboxError,
  type DropboxOAuthEnv,
} from '../../_lib/dropboxOAuth'
import {
  clearTokenCookieHeader,
  createTokenCookieHeader,
  jsonResponse,
  readStoredToken,
  validateMutationRequest,
} from '../../_lib/tokenCookie'

export const onRequestPost: PagesFunction<DropboxOAuthEnv> = async ({ request, env }) => {
  const validationError = validateMutationRequest(request, dropboxAllowedOrigins(env))
  if (validationError) return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)

  const config = dropboxCookieConfig(env)
  const refreshToken = await readStoredToken(request, config)
  if (!refreshToken) {
    return jsonResponse({ code: 'AUTH_REQUIRED', message: 'Connect Dropbox to sync.' }, 401, {
      'Set-Cookie': clearTokenCookieHeader(request, config),
    })
  }

  try {
    const token = await refreshDropboxAccessToken(refreshToken, env)
    // Dropbox only issues a new refresh token when rotation is enabled; keep the
    // stored one otherwise. Re-setting the cookie also extends its lifetime.
    const nextRefreshToken = token.refresh_token ?? refreshToken
    return jsonResponse(
      {
        accessToken: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      },
      200,
      { 'Set-Cookie': await createTokenCookieHeader(request, config, nextRefreshToken) },
    )
  } catch (error) {
    const publicError = toPublicDropboxError(error)
    return jsonResponse(publicError, publicError.status, {
      ...(publicError.status === 401 ? { 'Set-Cookie': clearTokenCookieHeader(request, config) } : {}),
    })
  }
}
