import {
  dropboxAllowedOrigins,
  dropboxCookieConfig,
  refreshDropboxAccessToken,
  toPublicDropboxError,
  type DropboxOAuthEnv,
} from '../../_lib/dropboxOAuth'
import {
  createMcpProfileSessionCookie,
  mcpProfileRepository,
  parseDropboxEnableBody,
  setCookieHeaders,
  type McpAgentAccessEnv,
} from '../../_lib/mcpAgentAccess'
import {
  fetchDropboxAccount,
  fetchDropboxTarget,
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

type Env = DropboxOAuthEnv & McpAgentAccessEnv

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const validationError = validateMutationRequest(
    request,
    dropboxAllowedOrigins(env),
  )
  if (validationError) {
    return jsonResponse(
      { code: 'INVALID_REQUEST', message: validationError },
      403,
    )
  }

  let input: ReturnType<typeof parseDropboxEnableBody>
  try {
    input = parseDropboxEnableBody(await request.json().catch(() => null))
  } catch (error) {
    const message =
      error instanceof ProviderProfileValidationError
        ? error.message
        : 'Invalid Agent access request.'
    return jsonResponse({ code: 'INVALID_REQUEST', message }, 400)
  }

  const providerCookie = dropboxCookieConfig(env)
  const refreshToken = await readStoredToken(request, providerCookie)
  if (!refreshToken) {
    return jsonResponse(
      { code: 'AUTH_REQUIRED', message: 'Connect Dropbox to sync.' },
      401,
      { 'Set-Cookie': clearTokenCookieHeader(request, providerCookie) },
    )
  }

  let token: Awaited<ReturnType<typeof refreshDropboxAccessToken>>
  try {
    token = await refreshDropboxAccessToken(refreshToken, env)
  } catch (error) {
    const publicError = toPublicDropboxError(error)
    return jsonResponse(publicError, publicError.status, {
      ...(publicError.status === 401
        ? { 'Set-Cookie': clearTokenCookieHeader(request, providerCookie) }
        : {}),
    })
  }

  try {
    const nextRefreshToken = token.refresh_token ?? refreshToken
    const [account, target] = await Promise.all([
      fetchDropboxAccount(token.access_token),
      fetchDropboxTarget(token.access_token, input.target.path),
    ])
    const profile = await mcpProfileRepository(env).createOrUpdate({
      provider: 'dropbox',
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
        message: 'Dropbox Agent access could not be enabled.',
      },
      500,
    )
  }
}
