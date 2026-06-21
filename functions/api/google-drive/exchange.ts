import {
  clearRefreshCookieHeader,
  createRefreshCookieHeader,
  exchangeGoogleCode,
  getStoredRefreshToken,
  jsonResponse,
  toPublicOAuthError,
  validateMutationRequest,
  type GoogleOAuthEnv,
} from '../../_lib/googleOAuth'

export const onRequestPost: PagesFunction<GoogleOAuthEnv> = async ({ request, env }) => {
  const validationError = validateMutationRequest(request, env)
  if (validationError) return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null
  if (typeof body?.code !== 'string' || !body.code) {
    return jsonResponse({ code: 'INVALID_REQUEST', message: 'Missing Google authorization code.' }, 400)
  }

  try {
    const token = await exchangeGoogleCode(body.code, new URL(request.url).origin, env)
    const refreshToken = token.refresh_token ?? (await getStoredRefreshToken(request, env))
    if (!refreshToken) {
      return jsonResponse(
        { code: 'CONSENT_REQUIRED', message: 'Google must grant offline access. Try connecting again.' },
        409,
      )
    }
    return jsonResponse(
      {
        accessToken: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      },
      200,
      { 'Set-Cookie': await createRefreshCookieHeader(request, refreshToken, env.GOOGLE_TOKEN_ENCRYPTION_KEY) },
    )
  } catch (error) {
    const publicError = toPublicOAuthError(error)
    return jsonResponse(publicError, publicError.status, {
      ...(publicError.status === 401
        ? { 'Set-Cookie': clearRefreshCookieHeader(request) }
        : {}),
    })
  }
}
