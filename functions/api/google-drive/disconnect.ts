import {
  googleAllowedOrigins,
  googleCookieConfig,
  type GoogleOAuthEnv,
} from '../../_lib/googleOAuth'
import {
  clearTokenCookieHeader,
  jsonResponse,
  readStoredToken,
  validateMutationRequest,
} from '../../_lib/tokenCookie'

export const onRequestPost: PagesFunction<GoogleOAuthEnv> = async ({ request, env }) => {
  const validationError = validateMutationRequest(request, googleAllowedOrigins(env))
  if (validationError) return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)

  const config = googleCookieConfig(env)
  const refreshToken = await readStoredToken(request, config)
  if (refreshToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => undefined)
  }

  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearTokenCookieHeader(request, config) })
}
