import {
  handleRemoteMcpRequest,
  type RemoteMcpEnv,
} from './remoteServer.js'
import { createMcpProtectedResourceMetadata } from '../src/lib/mcpOAuthMetadata.js'
import { runMcpD1Cleanup } from '../functions/_lib/mcpCleanup.js'
import { refreshIdleOneDriveCredentials } from '../functions/_lib/mcpCredentialKeepAlive.js'
import { refreshOneDriveAccessToken } from '../functions/_lib/oneDriveOAuth.js'

const metadataResponse = (env: RemoteMcpEnv) =>
  Response.json(
    createMcpProtectedResourceMetadata({
      issuerUrl: env.MCP_OAUTH_ISSUER_URL,
      resourceUrl: env.MCP_RESOURCE_URL,
    }),
    { headers: { 'Cache-Control': 'no-store' } },
  )

export default {
  async fetch(request: Request, env: RemoteMcpEnv, ctx?: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (
      request.method === 'GET' &&
      pathname === '/.well-known/oauth-protected-resource/mcp'
    ) {
      return metadataResponse(env)
    }
    if (pathname !== '/mcp') {
      return new Response('Not found.', { status: 404 })
    }
    return handleRemoteMcpRequest(request, env, {}, ctx)
  },

  async scheduled(
    _controller: ScheduledController,
    env: RemoteMcpEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      runMcpD1Cleanup(env.MCP_DB)
        .then((stats) => {
          console.log('[mcp-d1-cleanup]', JSON.stringify(stats))
        })
        .catch((error) => {
          console.error('[mcp-d1-cleanup] failed', error)
        }),
    )
    const { ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET } = env
    if (!ONEDRIVE_CLIENT_ID || !ONEDRIVE_CLIENT_SECRET) {
      console.warn('[mcp-credential-keepalive] skipped: OneDrive client is not configured')
      return
    }
    ctx.waitUntil(
      refreshIdleOneDriveCredentials(
        env.MCP_DB,
        env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
        (refreshToken) => refreshOneDriveAccessToken(refreshToken, { ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET }),
      )
        .then((stats) => {
          console.log('[mcp-credential-keepalive]', JSON.stringify(stats))
        })
        .catch((error) => {
          console.error('[mcp-credential-keepalive] failed', error)
        }),
    )
  },
}
