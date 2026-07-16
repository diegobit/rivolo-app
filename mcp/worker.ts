import {
  handleRemoteMcpRequest,
  type RemoteMcpEnv,
} from './remoteServer.js'

export default {
  async fetch(request: Request, env: RemoteMcpEnv): Promise<Response> {
    if (new URL(request.url).pathname !== '/mcp') {
      return new Response('Not found.', { status: 404 })
    }
    return handleRemoteMcpRequest(request, env)
  },
}
