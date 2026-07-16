import {
  clearMcpProfileSessionCookie,
  mcpProfileRepository,
  readMcpProfileSession,
  type McpAgentAccessEnv,
} from '../../_lib/mcpAgentAccess'
import { ProviderProfileValidationError } from '../../_lib/providerProfiles'
import { jsonResponse } from '../../_lib/tokenCookie'

const disabledResponse = (request: Request, env: McpAgentAccessEnv) =>
  jsonResponse(
    { enabled: false },
    200,
    { 'Set-Cookie': clearMcpProfileSessionCookie(request, env) },
  )

export const onRequestGet: PagesFunction<McpAgentAccessEnv> = async ({
  request,
  env,
}) => {
  const profileId = await readMcpProfileSession(request, env)
  if (!profileId) return disabledResponse(request, env)

  try {
    const profile = await mcpProfileRepository(env).getMetadata(profileId)
    if (!profile || profile.revokedAt) return disabledResponse(request, env)
    return jsonResponse({ enabled: true, profile })
  } catch (error) {
    if (error instanceof ProviderProfileValidationError) {
      return disabledResponse(request, env)
    }
    return jsonResponse(
      { code: 'STATUS_FAILED', message: 'Agent access status could not be loaded.' },
      500,
    )
  }
}
