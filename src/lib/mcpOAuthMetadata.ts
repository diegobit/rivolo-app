export const MCP_OAUTH_SCOPES = ['notes:read', 'notes:write'] as const
export const DEFAULT_MCP_RESOURCE_URL = 'https://mcp.rivolo.app/mcp'
export const DEFAULT_MCP_OAUTH_ISSUER_URL = 'https://rivolo.app/api/mcp/oauth'

export type McpOAuthMetadataConfig = {
  resourceUrl?: string
  issuerUrl?: string
}

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, '')

export const resolveMcpOAuthConfig = ({
  resourceUrl = DEFAULT_MCP_RESOURCE_URL,
  issuerUrl = DEFAULT_MCP_OAUTH_ISSUER_URL,
}: McpOAuthMetadataConfig = {}) => {
  const resource = new URL(resourceUrl)
  const issuer = new URL(issuerUrl)
  if (
    resource.protocol !== 'https:' ||
    issuer.protocol !== 'https:' ||
    resource.search ||
    resource.hash ||
    issuer.search ||
    issuer.hash
  ) {
    throw new Error('MCP OAuth URLs must be canonical HTTPS URLs.')
  }
  return {
    resourceUrl: withoutTrailingSlash(resource.href),
    issuerUrl: withoutTrailingSlash(issuer.href),
  }
}

export const createMcpProtectedResourceMetadata = (
  config?: McpOAuthMetadataConfig,
) => {
  const { resourceUrl, issuerUrl } = resolveMcpOAuthConfig(config)
  return {
    resource: resourceUrl,
    authorization_servers: [issuerUrl],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Rivolo notes',
  }
}

export const createMcpAuthorizationServerMetadata = (
  config?: McpOAuthMetadataConfig,
) => {
  const { issuerUrl } = resolveMcpOAuthConfig(config)
  return {
    issuer: issuerUrl,
    authorization_endpoint: `${issuerUrl}/authorize`,
    token_endpoint: `${issuerUrl}/token`,
    registration_endpoint: `${issuerUrl}/register`,
    revocation_endpoint: `${issuerUrl}/revoke`,
    scopes_supported: [...MCP_OAUTH_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  }
}

export const getMcpProtectedResourceMetadataUrl = (
  config?: McpOAuthMetadataConfig,
) => {
  const { resourceUrl } = resolveMcpOAuthConfig(config)
  const resource = new URL(resourceUrl)
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`
}

export const createMcpBearerChallenge = (
  config?: McpOAuthMetadataConfig,
  scopes: readonly string[] = MCP_OAUTH_SCOPES,
) =>
  `Bearer resource_metadata="${getMcpProtectedResourceMetadataUrl(config)}", scope="${scopes.join(' ')}"`
