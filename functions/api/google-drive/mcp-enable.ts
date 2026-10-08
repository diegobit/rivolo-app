import {
  googleAllowedOrigins,
  googleCookieConfig,
  refreshGoogleAccessToken,
  toPublicOAuthError,
  type GoogleOAuthEnv,
} from '../../_lib/googleOAuth'
import {
  createMcpProfileSessionCookie,
  mcpProfileRepository,
  parseGoogleDriveEnableBody,
  setCookieHeaders,
  type McpAgentAccessEnv,
} from '../../_lib/mcpAgentAccess'
import {
  fetchGoogleDriveAccount,
  fetchGoogleDriveTarget,
  ProviderAccessError,
} from '../../_lib/providerAccess'
import { ProviderProfileValidationError } from '../../_lib/providerProfiles'
import {
  clearTokenCookieHeader,
  createTokenCookieHeader,
  jsonResponse,
  readStoredToken,
  validateMutationRequest,
} from '../../_lib/tokenCookie'

type Env = GoogleOAuthEnv & McpAgentAccessEnv

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const validationError = validateMutationRequest(
    request,
    googleAllowedOrigins(env),
  )
  if (validationError) {
    return jsonResponse(
      { code: 'INVALID_REQUEST', message: validationError },
      403,
    )
  }

  let input: ReturnType<typeof parseGoogleDriveEnableBody>
  try {
    input = parseGoogleDriveEnableBody(await request.json().catch(() => null))
  } catch (error) {
    const message =
      error instanceof ProviderProfileValidationError
        ? error.message
        : 'Invalid Agent access request.'
    return jsonResponse({ code: 'INVALID_REQUEST', message }, 400)
  }

  const providerCookie = googleCookieConfig(env)
  const refreshToken = await readStoredToken(request, providerCookie)
  if (!refreshToken) {
    return jsonResponse(
      { code: 'AUTH_REQUIRED', message: 'Connect Google Drive to sync.' },
      401,
      { 'Set-Cookie': clearTokenCookieHeader(request, providerCookie) },
    )
  }

  let token: Awaited<ReturnType<typeof refreshGoogleAccessToken>>
  try {
    token = await refreshGoogleAccessToken(refreshToken, env)
  } catch (error) {
    const publicError = toPublicOAuthError(error)
    return jsonResponse(publicError, publicError.status, {
      ...(publicError.status === 401
        ? { 'Set-Cookie': clearTokenCookieHeader(request, providerCookie) }
        : {}),
    })
  }

  try {
    const nextRefreshToken = token.refresh_token ?? refreshToken
    const [account, target] = await Promise.all([
      fetchGoogleDriveAccount(token.access_token),
      fetchGoogleDriveTarget(token.access_token, input.target.fileId),
    ])
    const profile = await mcpProfileRepository(env).createOrUpdate({
      provider: 'google-drive',
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
        await createTokenCookieHeader(
          request,
          providerCookie,
          nextRefreshToken,
        ),
        await createMcpProfileSessionCookie(request, env, profile.profileId),
      ),
    )
  } catch (error) {
    if (error instanceof ProviderAccessError) {
      return jsonResponse(
        { code: error.code, message: error.message },
        error.status,
      )
    }
    if (error instanceof ProviderProfileValidationError) {
      return jsonResponse(
        { code: 'INVALID_REQUEST', message: error.message },
        400,
      )
    }
    return jsonResponse(
      {
        code: 'ENABLE_FAILED',
        message: 'Google Drive Agent access could not be enabled.',
      },
      500,
    )
  }
}
