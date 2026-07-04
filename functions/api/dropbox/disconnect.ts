import {
  dropboxAllowedOrigins,
  dropboxCookieConfig,
  type DropboxOAuthEnv,
} from '../../_lib/dropboxOAuth'
import {
  clearTokenCookieHeader,
  jsonResponse,
  validateMutationRequest,
} from '../../_lib/tokenCookie'

export const onRequestPost: PagesFunction<DropboxOAuthEnv> = async ({ request, env }) => {
  const validationError = validateMutationRequest(request, dropboxAllowedOrigins(env))
  if (validationError) return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)

  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': clearTokenCookieHeader(request, dropboxCookieConfig(env)),
  })
}
