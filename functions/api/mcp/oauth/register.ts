import {
  registerOAuthClient,
} from '../../../_lib/mcpOAuthHttp'
import type { McpOAuthEnv } from '../../../_lib/mcpOAuth'

export const onRequestPost: PagesFunction<McpOAuthEnv> = ({ request, env }) =>
  registerOAuthClient(request, env)
