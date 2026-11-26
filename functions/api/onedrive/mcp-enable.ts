import {
  oneDriveAllowedOrigins,
  oneDriveCookieConfig,
  refreshOneDriveAccessToken,
  toPublicOneDriveError,
  type OneDriveOAuthEnv,
} from '../../_lib/oneDriveOAuth'
import {
  createMcpProfileSessionCookie,
  mcpProfileRepository,
  parseOneDriveEnableBody,
  setCookieHeaders,
  type McpAgentAccessEnv,
} from '../../_lib/mcpAgentAccess'
import {
  fetchOneDriveAccount,
  ProviderAccessError,
  verifyOneDriveDailyTarget,
} from '../../_lib/providerAccess'
import { ProviderProfileValidationError } from '../../_lib/providerProfiles'
import {
  clearTokenCookieHeader,
  createTokenCookieHeader,
  jsonResponse,
  readStoredToken,
  validateMutationRequest,
} from '../../_lib/tokenCookie'

type Env = OneDriveOAuthEnv & McpAgentAccessEnv

// Lives under /api/onedrive because the OneDrive refresh cookie is scoped there.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const validationError = validateMutationRequest(
    request,
    oneDriveAllowedOrigins(env),
  )
  if (validationError) {
    return jsonResponse(
      { code: 'INVALID_REQUEST', message: validationError },
      403,
    )
  }

  let input: ReturnType<typeof parseOneDriveEnableBody>
  try {
    input = parseOneDriveEnableBody(await request.json().catch(() => null))
  } catch (error) {
    const message =
      error instanceof ProviderProfileValidationError
        ? error.message
        : 'Invalid Agent access request.'
    return jsonResponse({ code: 'INVALID_REQUEST', message }, 400)
  }

  const providerCookie = oneDriveCookieConfig(env)
  const refreshToken = await readStoredToken(request, providerCookie)
  if (!refreshToken) {
    return jsonResponse(
      { code: 'AUTH_REQUIRED', message: 'Connect OneDrive to sync.' },
      401,
      { 'Set-Cookie': clearTokenCookieHeader(request, providerCookie) },
    )
  }

  let token: Awaited<ReturnType<typeof refreshOneDriveAccessToken>>
  try {
    token = await refreshOneDriveAccessToken(refreshToken, env)
  } catch (error) {
    const publicError = toPublicOneDriveError(error)
    return jsonResponse(publicError, publicError.status, {
      ...(publicError.status === 401
        ? { 'Set-Cookie': clearTokenCookieHeader(request, providerCookie) }
        : {}),
    })
  }

  // Microsoft rotates refresh tokens. The browser keeps the replacement and
  // Agent access stores its own copy; each stays valid as it is refreshed.
  const nextRefreshToken = token.refresh_token ?? refreshToken
  const browserCookie = await createTokenCookieHeader(request, providerCookie, nextRefreshToken)
  try {
    const [account, target] = await Promise.all([
      fetchOneDriveAccount(token.access_token),
      verifyOneDriveDailyTarget(token.access_token, input.target.folder),
    ])
    const profile = await mcpProfileRepository(env).createOrUpdate({
      provider: 'onedrive',
      providerAccountId: account.accountId,
      providerEmail: account.email,
      providerName: account.name,
      target,
      timeZone: input.timeZone,
      refreshToken: nextRefreshToken,
    })
    return jsonResponse(
      { enabled: true, profile },
      200,
      setCookieHeaders(
        browserCookie,
        await createMcpProfileSessionCookie(request, env, profile.profileId),
      ),
    )
  } catch (error) {
    if (error instanceof ProviderAccessError) {
      return jsonResponse(
        { code: error.code, message: error.message },
        error.status,
        { 'Set-Cookie': browserCookie },
      )
    }
    if (error instanceof ProviderProfileValidationError) {
      return jsonResponse(
        { code: 'INVALID_REQUEST', message: error.message },
        400,
        { 'Set-Cookie': browserCookie },
      )
    }
    return jsonResponse(
      {
        code: 'ENABLE_FAILED',
        message: 'OneDrive Agent access could not be enabled.',
      },
      500,
      { 'Set-Cookie': browserCookie },
    )
  }
}
