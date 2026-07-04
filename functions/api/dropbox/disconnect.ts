import {
  dropboxAllowedOrigins,
  dropboxCookieConfig,
  revokeDropboxRefreshToken,
  type DropboxOAuthEnv,
} from '../../_lib/dropboxOAuth'
import {
  clearTokenCookieHeader,
  jsonResponse,
  readStoredToken,
  validateMutationRequest,
} from '../../_lib/tokenCookie'

export const onRequestPost: PagesFunction<DropboxOAuthEnv> = async ({ request, env }) => {
  const validationError = validateMutationRequest(request, dropboxAllowedOrigins(env))
  if (validationError) return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)

  const config = dropboxCookieConfig(env)
  const refreshToken = await readStoredToken(request, config)
  if (refreshToken) await revokeDropboxRefreshToken(refreshToken, env)

  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': clearTokenCookieHeader(request, config),
  })
}
