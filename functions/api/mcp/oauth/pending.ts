import {
  readOAuthPendingStatus,
  submitOAuthPendingCancellation,
} from '../../../_lib/mcpOAuthHttp'
import type { McpOAuthEnv } from '../../../_lib/mcpOAuth'

export const onRequestGet: PagesFunction<McpOAuthEnv> = ({ request, env }) =>
  readOAuthPendingStatus(request, env)

export const onRequestPost: PagesFunction<McpOAuthEnv> = ({ request, env }) =>
  submitOAuthPendingCancellation(request, env)
