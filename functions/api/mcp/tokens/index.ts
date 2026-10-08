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

export const onRequestGet: PagesFunction<McpAgentAccessEnv> = async ({
  request,
  env,
}) => {
  try {
    const profileId = await readActiveMcpProfileSession(request, env)
    if (!profileId) return unauthorizedResponse(request, env)
    const tokens = await new McpPersonalTokenRepository(env.MCP_DB).list(profileId)
    return jsonResponse({ tokens })
  } catch (error) {
    if (error instanceof ProviderProfileValidationError) {
      return unauthorizedResponse(request, env)
    }
    return jsonResponse(
      { code: 'TOKENS_FAILED', message: 'Access tokens could not be loaded.' },
      500,
    )
  }
}

export const onRequestPost: PagesFunction<McpAgentAccessEnv> = async ({
  request,
  env,
}) => {
  const validationError = validateMutationRequest(request, mcpAllowedOrigins(env))
  if (validationError) {
    return jsonResponse({ code: 'INVALID_REQUEST', message: validationError }, 403)
  }

  try {
    const profileId = await readActiveMcpProfileSession(request, env)
    if (!profileId) return unauthorizedResponse(request, env)
    const body = (await request.json().catch(() => null)) as { name?: unknown } | null
    const token = await new McpPersonalTokenRepository(env.MCP_DB).create(
      profileId,
      body?.name,
    )
    return jsonResponse({ token }, 201)
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
      { code: 'TOKEN_CREATE_FAILED', message: 'Access token could not be created.' },
      500,
    )
  }
}
