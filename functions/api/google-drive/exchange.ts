import {
  exchangeGoogleCode,
  googleAllowedOrigins,
  googleCookieConfig,
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

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null
  if (typeof body?.code !== 'string' || !body.code) {
    return jsonResponse({ code: 'INVALID_REQUEST', message: 'Missing Google authorization code.' }, 400)
  }

  const config = googleCookieConfig(env)
  try {
    const token = await exchangeGoogleCode(body.code, new URL(request.url).origin, env)
    const refreshToken = token.refresh_token ?? (await readStoredToken(request, config))
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
      { 'Set-Cookie': await createTokenCookieHeader(request, config, refreshToken) },
    )
  } catch (error) {
    const publicError = toPublicOAuthError(error)
    return jsonResponse(publicError, publicError.status, {
      ...(publicError.status === 401
        ? { 'Set-Cookie': clearTokenCookieHeader(request, config) }
        : {}),
    })
  }
}
