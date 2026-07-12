import {
  googleAllowedOrigins,
  googleCookieConfig,
  refreshGoogleAccessToken,
  toPublicOAuthError,
  type GoogleOAuthEnv,
} from '../../_lib/googleOAuth'
import {
  clearTokenCookieHeader,
  createTokenCookieHeader,
  jsonResponse,
  readStoredToken,
  validateMutationRequest,
} from '../../_lib/tokenCookie'

export const onRequestPost: PagesFunction<GoogleOAuthEnv> = async ({ request, env }) => {
  const validationError = validateMutationRequest(request, googleAllowedOrigins(env))
  if (validationError) return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)

  const config = googleCookieConfig(env)
  const refreshToken = await readStoredToken(request, config)
  if (!refreshToken) {
    return jsonResponse({ code: 'AUTH_REQUIRED', message: 'Connect Google Drive to sync.' }, 401, {
      'Set-Cookie': clearTokenCookieHeader(request, config),
    })
  }

  try {
    const token = await refreshGoogleAccessToken(refreshToken, env)
    const nextRefreshToken = token.refresh_token ?? refreshToken
    return jsonResponse(
      {
        accessToken: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      },
      200,
      {
        'Set-Cookie': await createTokenCookieHeader(request, config, nextRefreshToken),
      },
    )
  } catch (error) {
    const publicError = toPublicOAuthError(error)
    return jsonResponse(publicError, publicError.status, {
      ...(publicError.status === 401 ? { 'Set-Cookie': clearTokenCookieHeader(request, config) } : {}),
    })
  }
}
