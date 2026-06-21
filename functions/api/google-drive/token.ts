import {
  clearRefreshCookieHeader,
  createRefreshCookieHeader,
  getStoredRefreshToken,
  jsonResponse,
  refreshGoogleAccessToken,
  toPublicOAuthError,
  validateMutationRequest,
  type GoogleOAuthEnv,
} from '../../_lib/googleOAuth'

export const onRequestPost: PagesFunction<GoogleOAuthEnv> = async ({ request, env }) => {
  const validationError = validateMutationRequest(request, env)
  if (validationError) return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)

  const refreshToken = await getStoredRefreshToken(request, env)
  if (!refreshToken) {
    return jsonResponse({ code: 'AUTH_REQUIRED', message: 'Connect Google Drive to sync.' }, 401, {
      'Set-Cookie': clearRefreshCookieHeader(request),
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
        'Set-Cookie': await createRefreshCookieHeader(
          request,
          nextRefreshToken,
          env.GOOGLE_TOKEN_ENCRYPTION_KEY,
        ),
      },
    )
  } catch (error) {
    const publicError = toPublicOAuthError(error)
    return jsonResponse(publicError, publicError.status, {
      ...(publicError.status === 401 ? { 'Set-Cookie': clearRefreshCookieHeader(request) } : {}),
    })
  }
}
