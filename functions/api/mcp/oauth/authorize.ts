import {
  showOAuthConsent,
  submitOAuthConsent,
} from '../../../_lib/mcpOAuthHttp'
import type { McpOAuthEnv } from '../../../_lib/mcpOAuth'

export const onRequestGet: PagesFunction<McpOAuthEnv> = ({ request, env }) =>
  showOAuthConsent(request, env)

export const onRequestPost: PagesFunction<McpOAuthEnv> = ({ request, env }) =>
  submitOAuthConsent(request, env)
