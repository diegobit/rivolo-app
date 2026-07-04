import {
  dropboxAllowedOrigins,
  dropboxCookieConfig,
  exchangeDropboxCode,
  toPublicDropboxError,
  type DropboxOAuthEnv,
} from '../../_lib/dropboxOAuth'
import {
  clearTokenCookieHeader,
  createTokenCookieHeader,
  jsonResponse,
  validateMutationRequest,
} from '../../_lib/tokenCookie'

export const onRequestPost: PagesFunction<DropboxOAuthEnv> = async ({ request, env }) => {
  const validationError = validateMutationRequest(request, dropboxAllowedOrigins(env))
  if (validationError) return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)

  const body = (await request.json().catch(() => null)) as
    | { code?: unknown; codeVerifier?: unknown }
    | null
  if (typeof body?.code !== 'string' || !body.code) {
    return jsonResponse({ code: 'INVALID_REQUEST', message: 'Missing Dropbox authorization code.' }, 400)
  }
  if (typeof body?.codeVerifier !== 'string' || !body.codeVerifier) {
    return jsonResponse({ code: 'INVALID_REQUEST', message: 'Missing Dropbox code verifier.' }, 400)
  }

  const redirectUri = `${new URL(request.url).origin}/auth/dropbox/callback`
  const config = dropboxCookieConfig(env)
  try {
    const token = await exchangeDropboxCode(body.code, body.codeVerifier, redirectUri, env)
    if (!token.refresh_token) {
      return jsonResponse(
        { code: 'CONSENT_REQUIRED', message: 'Dropbox must grant offline access. Try connecting again.' },
        409,
      )
    }
    return jsonResponse(
      {
        accessToken: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      },
      200,
      { 'Set-Cookie': await createTokenCookieHeader(request, config, token.refresh_token) },
    )
  } catch (error) {
    const publicError = toPublicDropboxError(error)
    return jsonResponse(publicError, publicError.status, {
      ...(publicError.status === 401 ? { 'Set-Cookie': clearTokenCookieHeader(request, config) } : {}),
    })
  }
}
