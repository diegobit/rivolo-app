import { RIVOLO_MCP_ENDPOINT } from './agentAccess'

export function buildAgentSetupPrompt(token?: string): string {
  return `Configure a remote MCP server named rivolo in this coding agent's supported MCP configuration, preserving existing servers.

Transport: Streamable HTTP
URL: ${RIVOLO_MCP_ENDPOINT}
HTTP header: Authorization: Bearer ${token ?? '<YOUR_RIVOLO_TOKEN>'}

${token ? 'Use the supplied token for authentication.' : 'Ask me for my Rivolo personal access token to replace <YOUR_RIVOLO_TOKEN> before connecting.'}
Verify the connection by listing the available tools. Do not modify any notes.`
}
