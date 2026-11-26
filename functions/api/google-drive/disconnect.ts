import {
  googleAllowedOrigins,
  googleCookieConfig,
  refreshGoogleAccessToken,
  type GoogleOAuthEnv,
} from '../../_lib/googleOAuth'
import { mcpProfileRepository, type McpAgentAccessEnv } from '../../_lib/mcpAgentAccess'
import { fetchGoogleDriveAccount } from '../../_lib/providerAccess'
import {
  clearTokenCookieHeader,
  jsonResponse,
  readStoredToken,
  validateMutationRequest,
} from '../../_lib/tokenCookie'

type Env = GoogleOAuthEnv & McpAgentAccessEnv

// Google revokes the app's whole grant for the account, not just this
// browser's token. Agent access set up from another browser runs on that
// same grant, so revoking here would silently break it.
const grantBacksAgentAccess = async (refreshToken: string, env: Env) => {
  try {
    const token = await refreshGoogleAccessToken(refreshToken, env)
    const account = await fetchGoogleDriveAccount(token.access_token)
    return await mcpProfileRepository(env).hasActiveProfile('google-drive', account.accountId)
  } catch {
    // When the account can't be checked, keep the grant: this browser's
    // cookie is still cleared below.
    return true
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const validationError = validateMutationRequest(request, googleAllowedOrigins(env))
  if (validationError) return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)

  const config = googleCookieConfig(env)
  const refreshToken = await readStoredToken(request, config)
  if (refreshToken && !(await grantBacksAgentAccess(refreshToken, env))) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => undefined)
  }

  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearTokenCookieHeader(request, config) })
}
