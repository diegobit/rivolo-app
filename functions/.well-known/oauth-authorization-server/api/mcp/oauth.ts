import { oauthMetadataResponse } from '../../../../_lib/mcpOAuthHttp'
import type { McpOAuthEnv } from '../../../../_lib/mcpOAuth'

export const onRequestGet: PagesFunction<McpOAuthEnv> = ({ env }) =>
  oauthMetadataResponse(env)
