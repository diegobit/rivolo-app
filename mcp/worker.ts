import {
  handleRemoteMcpRequest,
  type RemoteMcpEnv,
} from './remoteServer.js'
import { createMcpProtectedResourceMetadata } from '../src/lib/mcpOAuthMetadata.js'

const metadataResponse = (env: RemoteMcpEnv) =>
  Response.json(
    createMcpProtectedResourceMetadata({
      issuerUrl: env.MCP_OAUTH_ISSUER_URL,
      resourceUrl: env.MCP_RESOURCE_URL,
    }),
    { headers: { 'Cache-Control': 'no-store' } },
  )

export default {
  async fetch(request: Request, env: RemoteMcpEnv): Promise<Response> {
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
    return handleRemoteMcpRequest(request, env)
  },
}
