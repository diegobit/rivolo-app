import {
  McpPersonalTokenRepository,
  McpPersonalTokenValidationError,
} from '../../../_lib/mcpPersonalTokens'
import {
  clearMcpProfileSessionCookie,
  mcpAllowedOrigins,
  readActiveMcpProfileSession,
  type McpAgentAccessEnv,
} from '../../../_lib/mcpAgentAccess'
import { ProviderProfileValidationError } from '../../../_lib/providerProfiles'
import { jsonResponse, validateMutationRequest } from '../../../_lib/tokenCookie'

const unauthorizedResponse = (request: Request, env: McpAgentAccessEnv) =>
  jsonResponse(
    { code: 'AUTH_REQUIRED', message: 'Agent access is not enabled.' },
    401,
    { 'Set-Cookie': clearMcpProfileSessionCookie(request, env) },
  )

export const onRequestDelete: PagesFunction<McpAgentAccessEnv> = async ({
  request,
  env,
  params,
}) => {
  const validationError = validateMutationRequest(request, mcpAllowedOrigins(env))
  if (validationError) {
    return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)
  }

  try {
    const profileId = await readActiveMcpProfileSession(request, env)
    if (!profileId) return unauthorizedResponse(request, env)

    const tokenId = Array.isArray(params.id) ? params.id[0] : params.id
    if (!tokenId) {
      return jsonResponse(
        { code: 'INVALID_REQUEST', message: 'tokenId is invalid.' },
        400,
      )
    }
    const revoked = await new McpPersonalTokenRepository(env.MCP_DB).revoke(
      profileId,
      tokenId,
    )
    if (!revoked) {
      return jsonResponse(
        { code: 'TOKEN_NOT_FOUND', message: 'Access token was not found.' },
        404,
      )
    }
    return jsonResponse({ ok: true })
  } catch (error) {
    if (error instanceof ProviderProfileValidationError) {
      return unauthorizedResponse(request, env)
    }
    if (error instanceof McpPersonalTokenValidationError) {
      return jsonResponse(
        { code: 'INVALID_REQUEST', message: error.message },
        400,
      )
    }
    return jsonResponse(
      { code: 'TOKEN_REVOKE_FAILED', message: 'Access token could not be revoked.' },
      500,
    )
  }
}
