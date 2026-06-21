import {
  clearRefreshCookieHeader,
  getStoredRefreshToken,
  jsonResponse,
  validateMutationRequest,
  type GoogleOAuthEnv,
} from '../../_lib/googleOAuth'

export const onRequestPost: PagesFunction<GoogleOAuthEnv> = async ({ request, env }) => {
  const validationError = validateMutationRequest(request, env)
  if (validationError) return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)

  const refreshToken = await getStoredRefreshToken(request, env)
  if (refreshToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => undefined)
  }

  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearRefreshCookieHeader(request) })
}
