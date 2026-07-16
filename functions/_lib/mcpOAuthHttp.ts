import {
  createMcpAuthorizationServerMetadata,
  createMcpProtectedResourceMetadata,
  type McpOAuthMetadataConfig,
} from '../../src/lib/mcpOAuthMetadata'
import {
  getMcpOAuthConfig,
  McpOAuthProtocolError,
  McpOAuthRepository,
  type McpOAuthEnv,
  type OAuthAuthorizationRequest,
} from './mcpOAuth'
import { readActiveMcpProfileSession } from './mcpAgentAccess'
import { ProviderProfileRepository } from './providerProfiles'
import { jsonResponse } from './tokenCookie'

const htmlHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Rivolo</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #172033; }
    main { box-sizing: border-box; width: min(100% - 2rem, 34rem); padding: 1.5rem; border: 1px solid #d9e0ea; border-radius: 1rem; background: #fff; box-shadow: 0 1rem 3rem rgb(15 23 42 / 8%); }
    h1 { margin: 0 0 .5rem; font-size: 1.35rem; }
    p { line-height: 1.5; color: #526078; }
    dl { display: grid; gap: .75rem; margin: 1.25rem 0; }
    dt { font-size: .78rem; color: #667085; }
    dd { margin: .15rem 0 0; overflow-wrap: anywhere; }
    .scopes { margin: .25rem 0 0; padding-left: 1.2rem; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin-top: 1.25rem; }
    button { min-height: 2.8rem; border-radius: .7rem; border: 1px solid #cbd5e1; font: inherit; font-weight: 650; cursor: pointer; }
    button[name="decision"][value="allow"] { background: #172033; color: white; border-color: #172033; }
    button[name="decision"][value="deny"] { background: white; color: #172033; }
    @media (prefers-color-scheme: dark) {
      body { background: #0f172a; color: #e5edf8; }
      main { background: #172033; border-color: #334155; }
      p, dt { color: #aebbd0; }
      button[name="decision"][value="allow"] { background: #e5edf8; color: #172033; border-color: #e5edf8; }
      button[name="decision"][value="deny"] { background: #172033; color: #e5edf8; border-color: #64748b; }
    }
  </style>
</head>
<body><main>${body}</main></body>
</html>`,
    { status, headers: htmlHeaders },
  )

const errorPage = (message: string, status = 400) =>
  page(
    'Agent access',
    `<h1>Connection could not continue</h1><p>${escapeHtml(message)}</p>`,
    status,
  )

const hidden = (name: string, value: string | null) =>
  value === null
    ? ''
    : `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`

const consentPage = (
  authorization: OAuthAuthorizationRequest,
  accountLabel: string,
  issuerUrl: string,
) => {
  const clientLabel = authorization.client.clientName ?? 'An MCP client'
  const redirectHost = new URL(authorization.redirectUri).host
  const scopeItems = authorization.scopes
    .map((scope) =>
      scope === 'notes:read'
        ? '<li>Read your cloud-synced Rivolo notes</li>'
        : '<li>Add content to your cloud-synced Rivolo notes</li>',
    )
    .join('')
  return page(
    'Allow agent access',
    `<h1>Allow ${escapeHtml(clientLabel)}?</h1>
<p>This connects the client to the Rivolo notes profile for <strong>${escapeHtml(accountLabel)}</strong>.</p>
<dl>
  <div><dt>Client callback</dt><dd>${escapeHtml(redirectHost)}</dd></div>
  <div><dt>Access requested</dt><dd><ul class="scopes">${scopeItems}</ul></dd></div>
</dl>
<p>Only the latest cloud-synced state is available. The client never receives your Dropbox or Google Drive credential.</p>
<form method="post" action="${escapeHtml(`${issuerUrl}/authorize`)}">
  ${hidden('response_type', 'code')}
  ${hidden('client_id', authorization.client.clientId)}
  ${hidden('redirect_uri', authorization.redirectUri)}
  ${hidden('state', authorization.state)}
  ${hidden('scope', authorization.scopes.join(' '))}
  ${hidden('code_challenge', authorization.codeChallenge)}
  ${hidden('code_challenge_method', 'S256')}
  ${hidden('resource', authorization.resource)}
  <div class="actions">
    <button type="submit" name="decision" value="deny">Cancel</button>
    <button type="submit" name="decision" value="allow">Allow</button>
  </div>
</form>`,
  )
}

const oauthErrorResponse = (error: unknown, status = 400) => {
  if (error instanceof McpOAuthProtocolError) {
    return jsonResponse(
      { error: error.code, error_description: error.message },
      status,
    )
  }
  return jsonResponse(
    { error: 'server_error', error_description: 'The request could not be completed.' },
    500,
  )
}

const requireFormBody = async (request: Request) => {
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    throw new McpOAuthProtocolError(
      'invalid_request',
      'Content-Type must be application/x-www-form-urlencoded.',
    )
  }
  return new URLSearchParams(await request.text())
}

const validateConsentOrigin = (request: Request, issuerUrl: string) => {
  if (request.headers.get('Origin') !== new URL(issuerUrl).origin) {
    throw new McpOAuthProtocolError('invalid_request', 'Consent origin is invalid.')
  }
}

const redirectResponse = (url: URL) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: url.href,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })

export const oauthMetadataResponse = (env: McpOAuthEnv) => {
  const config = getMcpOAuthConfig(env)
  return jsonResponse(createMcpAuthorizationServerMetadata(config))
}

export const protectedResourceMetadataResponse = (env: McpOAuthEnv) => {
  const config = getMcpOAuthConfig(env)
  return jsonResponse(createMcpProtectedResourceMetadata(config))
}

export const registerOAuthClient = async (request: Request, env: McpOAuthEnv) => {
  try {
    const contentType = request.headers.get('Content-Type') ?? ''
    if (!contentType.toLowerCase().startsWith('application/json')) {
      throw new McpOAuthProtocolError(
        'invalid_request',
        'Content-Type must be application/json.',
      )
    }
    const body = (await request.json().catch(() => null)) as {
      redirect_uris?: unknown
      client_name?: unknown
      token_endpoint_auth_method?: unknown
      grant_types?: unknown
      response_types?: unknown
    } | null
    if (!body) {
      throw new McpOAuthProtocolError('invalid_request', 'Request body is invalid.')
    }
    const client = await new McpOAuthRepository(env.MCP_DB).registerClient({
      redirectUris: body.redirect_uris,
      clientName: body.client_name,
      tokenEndpointAuthMethod: body.token_endpoint_auth_method,
      grantTypes: body.grant_types,
      responseTypes: body.response_types,
    })
    return jsonResponse(
      {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
        redirect_uris: client.redirectUris,
        client_name: client.clientName ?? undefined,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
      201,
    )
  } catch (error) {
    if (error instanceof McpOAuthProtocolError) {
      const registrationError = error.message.includes('redirect')
        ? 'invalid_redirect_uri'
        : 'invalid_client_metadata'
      return jsonResponse(
        { error: registrationError, error_description: error.message },
        400,
      )
    }
    return oauthErrorResponse(error)
  }
}

export const showOAuthConsent = async (request: Request, env: McpOAuthEnv) => {
  try {
    const profileId = await readActiveMcpProfileSession(request, env)
    if (!profileId) {
      return errorPage(
        'Open Rivolo Settings, connect Dropbox or Google Drive, and enable agent access before trying again.',
        401,
      )
    }
    const config = getMcpOAuthConfig(env)
    const authorization = await new McpOAuthRepository(
      env.MCP_DB,
    ).parseAuthorizationRequest(new URL(request.url).searchParams, config.resourceUrl)
    const profile = await new ProviderProfileRepository(
      env.MCP_DB,
      env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
    ).getMetadata(profileId)
    if (!profile || profile.revokedAt) {
      return errorPage('Rivolo agent access is not active.', 401)
    }
    const accountLabel =
      profile.providerEmail ?? profile.providerName ?? profile.providerAccountId
    return consentPage(authorization, accountLabel, config.issuerUrl)
  } catch (error) {
    return errorPage(
      error instanceof McpOAuthProtocolError
        ? error.message
        : 'The authorization request could not be loaded.',
    )
  }
}

export const submitOAuthConsent = async (request: Request, env: McpOAuthEnv) => {
  try {
    const config = getMcpOAuthConfig(env)
    validateConsentOrigin(request, config.issuerUrl)
    const body = await requireFormBody(request)
    const authorization = await new McpOAuthRepository(
      env.MCP_DB,
    ).parseAuthorizationRequest(body, config.resourceUrl)
    const profileId = await readActiveMcpProfileSession(request, env)
    if (!profileId) return errorPage('Rivolo agent access is not active.', 401)

    const target = new URL(authorization.redirectUri)
    target.searchParams.set('iss', config.issuerUrl)
    if (authorization.state !== null) {
      target.searchParams.set('state', authorization.state)
    }
    if (body.get('decision') !== 'allow') {
      target.searchParams.set('error', 'access_denied')
      return redirectResponse(target)
    }
    const code = await new McpOAuthRepository(env.MCP_DB).issueAuthorizationCode(
      profileId,
      authorization,
    )
    target.searchParams.set('code', code)
    return redirectResponse(target)
  } catch (error) {
    return errorPage(
      error instanceof McpOAuthProtocolError
        ? error.message
        : 'The authorization request could not be completed.',
    )
  }
}

export const exchangeOAuthToken = async (request: Request, env: McpOAuthEnv) => {
  try {
    const body = await requireFormBody(request)
    if (body.get('client_secret')) {
      throw new McpOAuthProtocolError(
        'invalid_client',
        'Only public clients are supported.',
      )
    }
    const clientId = body.get('client_id') ?? ''
    const resource = body.get('resource') ?? ''
    const config = getMcpOAuthConfig(env)
    if (resource !== config.resourceUrl) {
      throw new McpOAuthProtocolError(
        'invalid_request',
        'resource does not match the Rivolo MCP server.',
      )
    }
    const repository = new McpOAuthRepository(env.MCP_DB)
    const grantType = body.get('grant_type')
    const token =
      grantType === 'authorization_code'
        ? await repository.exchangeAuthorizationCode({
            clientId,
            code: body.get('code') ?? '',
            codeVerifier: body.get('code_verifier') ?? '',
            redirectUri: body.get('redirect_uri') ?? '',
            resource,
          })
        : grantType === 'refresh_token'
          ? await repository.exchangeRefreshToken({
              clientId,
              refreshToken: body.get('refresh_token') ?? '',
              scopes: body.get('scope') ?? undefined,
              resource,
            })
          : (() => {
              throw new McpOAuthProtocolError(
                'unsupported_grant_type',
                'grant_type is not supported.',
              )
            })()
    return jsonResponse(token)
  } catch (error) {
    return oauthErrorResponse(error)
  }
}

export const revokeOAuthToken = async (request: Request, env: McpOAuthEnv) => {
  try {
    const body = await requireFormBody(request)
    if (body.get('client_secret')) {
      throw new McpOAuthProtocolError(
        'invalid_client',
        'Only public clients are supported.',
      )
    }
    await new McpOAuthRepository(env.MCP_DB).revokeToken(
      body.get('client_id') ?? '',
      body.get('token') ?? '',
    )
    return new Response(null, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return oauthErrorResponse(error)
  }
}

export const oauthMetadataConfig = (env: McpOAuthEnv): McpOAuthMetadataConfig =>
  getMcpOAuthConfig(env)
