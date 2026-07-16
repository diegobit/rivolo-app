# Remote MCP OAuth integration

Rivolo acts as its own OAuth 2.1 authorization server while keeping each
user's active Dropbox or Google Drive profile as the identity boundary.

## Public endpoints

The authorization server issuer is `https://rivolo.app/api/mcp/oauth`.

- `GET /.well-known/oauth-authorization-server/api/mcp/oauth`
- `POST /api/mcp/oauth/register`
- `GET|POST /api/mcp/oauth/authorize`
- `POST /api/mcp/oauth/token`
- `POST /api/mcp/oauth/revoke`

The protected MCP resource is `https://mcp.rivolo.app/mcp`. The remote Worker
must serve `createMcpProtectedResourceMetadata()` from
`/.well-known/oauth-protected-resource/mcp`. Every unauthenticated `/mcp`
response must be `401` with the `WWW-Authenticate` value returned by
`createMcpBearerChallenge()`.

The authorization and token requests require
`resource=https://mcp.rivolo.app/mcp`. Access-token authentication verifies
that exact audience again.

## Remote Worker authentication

Use `authenticateMcpOAuthBearer(request, env)` for OAuth access tokens. Its
return value contains the active profile, granted scopes, client id, expiry,
resource, and the decrypted provider refresh token needed by the storage
adapter. The refresh token is internal-only: never serialize or log the
principal.

Keep `authenticateMcpBearer(request, env)` as the personal-token fallback.
OAuth access tokens begin with `rva_`; personal tokens begin with `rvl_`, so a
transport can dispatch without trial queries. Enforce `notes:read` and
`notes:write` at the relevant MCP tool boundary.

## Client compatibility

This release uses OAuth Dynamic Client Registration for clients that cannot
configure a static bearer token. Public clients must use authorization code,
S256 PKCE, an exact registered redirect URI, and refresh-token rotation.
Redirects are limited to HTTPS or HTTP loopback addresses.

OAuth Client ID Metadata Documents are intentionally not enabled yet. Doing so
safely requires a defined SSRF policy, redirect handling, response-size limit,
cache policy, and URL revalidation. DCR remains the compatibility path for
current broad MCP clients; Rivolo personal tokens cover clients that can set a
static bearer header.

## Deployment controls

The public DCR endpoint persists registrations and therefore can grow D1 under
abuse. Before production enablement, add Cloudflare rate-limit or WAF rules for:

- `/api/mcp/oauth/register` (strictest; primary storage-abuse boundary)
- `/api/mcp/oauth/token` (credential guessing and refresh replay)
- `/api/mcp/oauth/authorize` (request/consent abuse)

Keep the application-level validation in place; the edge rule is an additional
deployment requirement, not a replacement. Periodically remove expired
authorization codes and old revoked token families with a scheduled cleanup.

The Pages/Worker environment uses the existing `MCP_DB` and
`MCP_PROVIDER_TOKEN_ENCRYPTION_KEY` bindings. Optional
`MCP_OAUTH_ISSUER_URL` and `MCP_RESOURCE_URL` overrides are for non-production
environments; both must be canonical HTTPS URLs.
