import {
  clearMcpProfileSessionCookie,
  mcpAllowedOrigins,
  mcpProfileRepository,
  readMcpProfileSession,
  type McpAgentAccessEnv,
} from '../../_lib/mcpAgentAccess'
import { ProviderProfileValidationError } from '../../_lib/providerProfiles'
import { jsonResponse, validateMutationRequest } from '../../_lib/tokenCookie'

const unauthorizedResponse = (request: Request, env: McpAgentAccessEnv) =>
  jsonResponse(
    { code: 'AUTH_REQUIRED', message: 'Agent access is not enabled.' },
    401,
    { 'Set-Cookie': clearMcpProfileSessionCookie(request, env) },
  )

export const onRequestPost: PagesFunction<McpAgentAccessEnv> = async ({
  request,
  env,
}) => {
  const validationError = validateMutationRequest(
    request,
    mcpAllowedOrigins(env),
  )
  if (validationError) {
    return jsonResponse(
      { code: 'INVALID_REQUEST', message: validationError },
      403,
    )
  }

  const profileId = await readMcpProfileSession(request, env)
  if (!profileId) return unauthorizedResponse(request, env)

  try {
    const repository = mcpProfileRepository(env)
    const profile = await repository.getMetadata(profileId)
    if (!profile || profile.revokedAt) {
      return unauthorizedResponse(request, env)
    }

    await repository.revoke(profileId)
    return jsonResponse(
      { ok: true, enabled: false },
      200,
      { 'Set-Cookie': clearMcpProfileSessionCookie(request, env) },
    )
  } catch (error) {
    if (error instanceof ProviderProfileValidationError) {
      return unauthorizedResponse(request, env)
    }
    return jsonResponse(
      { code: 'DISABLE_FAILED', message: 'Agent access could not be disabled.' },
      500,
    )
  }
}
