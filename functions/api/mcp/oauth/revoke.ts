import { revokeOAuthToken } from '../../../_lib/mcpOAuthHttp'
import type { McpOAuthEnv } from '../../../_lib/mcpOAuth'

export const onRequestPost: PagesFunction<McpOAuthEnv> = ({ request, env }) =>
  revokeOAuthToken(request, env)
