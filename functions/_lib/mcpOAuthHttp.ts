import {
  createMcpAuthorizationServerMetadata,
  createMcpProtectedResourceMetadata,
  type McpOAuthMetadataConfig,
} from '../../src/lib/mcpOAuthMetadata'
import {
  buildAuthorizationCallbackUrl,
  classifyOAuthServiceFailure,
  formActionOriginForRedirect,
  getMcpOAuthConfig,
  hasAuthorizationFields,
  McpOAuthGrantDeniedError,
  McpOAuthProtocolError,
  McpOAuthRepository,
  McpOAuthTrustError,
  OAUTH_AUTHORIZATION_FIELDS,
  assertBoundedAuthorizationInput,
  assertUniqueFields,
  type AuthorizationCallbackResult,
  type McpOAuthEnv,
  type OAuthAuthorizationRequest,
  type OAuthCallbackContext,
} from './mcpOAuth'
import { readActiveMcpProfileSession } from './mcpAgentAccess'
import {
  clearPendingCookieHeader,
  createPendingPayload,
  pendingAuthorizationParams,
  pendingCookieHeader,
  readPendingRequest,
  submittedAuthorizationMatches,
  withPendingPhase,
  type PendingPayload,
} from './mcpOAuthPending'
import { ProviderProfileRepository } from './providerProfiles'
import { jsonResponse } from './tokenCookie'

const LOCAL_MESSAGES = new Set([
  'The authorization request is ambiguous.',
  'The authorization request is too large.',
  'Client is not registered.',
  'The registered client is invalid.',
  'redirect_uri is invalid.',
  'redirect_uri does not match the registered value.',
  'redirect_uri is not allowed.',
  'state is invalid.',
  'Consent origin is invalid.',
  'Content-Type must be application/x-www-form-urlencoded.',
  'This connection expired. Start again from the client.',
  'Start again from the client that sent you here.',
])

const REDIRECT_DESCRIPTIONS = new Set([
  'response_type must be code.',
  'S256 PKCE is required.',
  'resource does not match the Rivolo MCP server.',
  'Requested scope is not supported.',
  'The authorization decision is invalid.',
  'The Rivolo notes profile changed. Review access again.',
  'The authorization request did not match the reviewed connection.',
  'The authorization request is too large to continue.',
  'The request was denied.',
  'Rivolo agent access is not active.',
  'Rivolo agent access is not active. Start again from the client.',
  'The authorization server encountered an error.',
  'Authorization is temporarily unavailable. Try again from the client.',
])

const CONSENT_FIELDS = ['decision', 'profile_id', 'transaction_id'] as const

const baseHtmlHeaders = () => {
  const headers = new Headers()
  headers.set('Content-Type', 'text/html; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  headers.set(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  )
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Content-Type-Options', 'nosniff')
  return headers
}

export const applyCookieHeaders = (headers: Headers, cookies: string[]) => {
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return headers
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const page = (
  title: string,
  body: string,
  status = 200,
  options: { formActionOrigin?: string; cookies?: string[] } = {},
) => {
  const headers = baseHtmlHeaders()
  if (options.formActionOrigin) {
    headers.set(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${options.formActionOrigin}; base-uri 'none'; frame-ancestors 'none'`,
    )
  }
  applyCookieHeaders(headers, options.cookies ?? [])
  return new Response(
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
    button, a.button { min-height: 2.8rem; border-radius: .7rem; border: 1px solid #cbd5e1; font: inherit; font-weight: 650; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; padding: 0 .75rem; }
    button[name="decision"][value="allow"] { background: #172033; color: white; border-color: #172033; }
    button[name="decision"][value="deny"], a.button { background: white; color: #172033; }
    @media (max-width: 32rem) { .actions { grid-template-columns: 1fr; } }
    @media (prefers-color-scheme: dark) {
      body { background: #0f172a; color: #e5edf8; }
      main { background: #172033; border-color: #334155; }
      p, dt { color: #aebbd0; }
      button[name="decision"][value="allow"] { background: #e5edf8; color: #172033; border-color: #e5edf8; }
      button[name="decision"][value="deny"], a.button { background: #172033; color: #e5edf8; border-color: #64748b; }
    }
  </style>
</head>
<body><main>${body}</main></body>
</html>`,
    { status, headers },
  )
}

const localMessage = (error: unknown) => {
  if (
    (error instanceof McpOAuthTrustError || error instanceof McpOAuthProtocolError) &&
    LOCAL_MESSAGES.has(error.message)
  ) {
    return error.message
  }
  if (classifyOAuthServiceFailure(error) === 'transient') {
    return 'Authorization is temporarily unavailable.'
  }
  return 'The authorization request could not be completed.'
}

const localStatus = (error: unknown) => {
  if (error instanceof McpOAuthTrustError || error instanceof McpOAuthProtocolError) return 400
  return classifyOAuthServiceFailure(error) === 'transient' ? 503 : 500
}

const localAuthorizationError = (error: unknown, cookies: string[] = []) =>
  page(
    'Agent access',
    `<h1>Connection could not continue</h1><p>${escapeHtml(localMessage(error))}</p>`,
    localStatus(error),
    { cookies },
  )

const hidden = (name: string, value: string | null) =>
  value === null
    ? ''
    : `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`

const settingsContinuationUrl = (issuerUrl: string) => {
  const url = new URL('/settings', new URL(issuerUrl).origin)
  url.searchParams.set('mcp_oauth', '1')
  return url
}

const redirectResponse = (url: URL, cookies: string[] = []) => {
  const headers = new Headers()
  headers.set('Location', url.href)
  headers.set('Cache-Control', 'no-store')
  headers.set('Referrer-Policy', 'no-referrer')
  applyCookieHeaders(headers, cookies)
  return new Response(null, { status: 302, headers })
}

const safeRedirectDescription = (description: string) =>
  REDIRECT_DESCRIPTIONS.has(description)
    ? description
    : 'The authorization server encountered an error.'

const callbackRedirect = (
  issuerUrl: string,
  context: OAuthCallbackContext,
  result: AuthorizationCallbackResult,
  cookies: string[] = [],
) =>
  redirectResponse(
    buildAuthorizationCallbackUrl(
      context,
      issuerUrl,
      result.type === 'code'
        ? result
        : { ...result, description: safeRedirectDescription(result.description) },
    ),
    cookies,
  )

const serviceRedirect = (
  issuerUrl: string,
  context: OAuthCallbackContext,
  error: unknown,
  cookies: string[] = [],
) => {
  if (error instanceof McpOAuthGrantDeniedError) {
    return callbackRedirect(
      issuerUrl,
      context,
      {
        type: 'error',
        error: 'access_denied',
        description: 'Rivolo agent access is not active.',
      },
      cookies,
    )
  }
  if (error instanceof McpOAuthProtocolError && REDIRECT_DESCRIPTIONS.has(error.message)) {
    const errorCode =
      error.code === 'invalid_scope' ||
      error.code === 'unsupported_response_type' ||
      error.code === 'access_denied' ||
      error.code === 'invalid_request'
        ? error.code
        : classifyOAuthServiceFailure(error) === 'transient'
          ? 'temporarily_unavailable'
          : 'server_error'
    return callbackRedirect(
      issuerUrl,
      context,
      { type: 'error', error: errorCode, description: error.message },
      cookies,
    )
  }
  const transient = classifyOAuthServiceFailure(error) === 'transient'
  return callbackRedirect(
    issuerUrl,
    context,
    {
      type: 'error',
      error: transient ? 'temporarily_unavailable' : 'server_error',
      description: transient
        ? 'Authorization is temporarily unavailable. Try again from the client.'
        : 'The authorization server encountered an error.',
    },
    cookies,
  )
}

const consentFields = (
  authorization: OAuthAuthorizationRequest,
  transactionId: string,
  profileId: string | null,
) => `${hidden('transaction_id', transactionId)}
  ${hidden('profile_id', profileId)}
  ${hidden('response_type', 'code')}
  ${hidden('client_id', authorization.client.clientId)}
  ${hidden('redirect_uri', authorization.redirectUri)}
  ${hidden('state', authorization.state)}
  ${hidden('scope', authorization.scopes.join(' '))}
  ${hidden('code_challenge', authorization.codeChallenge)}
  ${hidden('code_challenge_method', 'S256')}
  ${hidden('resource', authorization.resource)}`

const consentPage = (
  authorization: OAuthAuthorizationRequest,
  profileId: string,
  accountLabel: string,
  issuerUrl: string,
  transactionId: string,
  cookies: string[],
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
  ${consentFields(authorization, transactionId, profileId)}
  <div class="actions">
    <button type="submit" name="decision" value="deny">Cancel</button>
    <button type="submit" name="decision" value="allow">Allow</button>
  </div>
</form>`,
    200,
    {
      formActionOrigin: formActionOriginForRedirect(authorization.redirectUri),
      cookies,
    },
  )
}

const cancelForm = (issuerUrl: string, transactionId: string) =>
  `<form method="post" action="${escapeHtml(`${issuerUrl}/pending`)}">
    ${hidden('decision', 'deny')}
    ${hidden('transaction_id', transactionId)}
    <div class="actions">
      <button type="submit">Cancel connection</button>
    </div>
  </form>`

const continuationPage = (
  title: string,
  body: string,
  redirectUri: string,
  cookies: string[] = [],
) =>
  page(title, body, 200, {
    formActionOrigin: formActionOriginForRedirect(redirectUri),
    cookies,
  })

const accountLabelFor = async (env: McpOAuthEnv, profileId: string) => {
  const profile = await new ProviderProfileRepository(
    env.MCP_DB,
    env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
  ).getMetadata(profileId)
  if (!profile || profile.revokedAt) return null
  return profile.providerEmail ?? profile.providerName ?? profile.providerAccountId
}

const repository = (env: McpOAuthEnv) => new McpOAuthRepository(env.MCP_DB)

const revalidatePending = async (env: McpOAuthEnv, payload: PendingPayload) => {
  const params = pendingAuthorizationParams(payload.authorization)
  const context = await repository(env).resolveCallbackContext(params)
  const authorization = repository(env).validateAuthorizationDetails(
    context,
    params,
    getMcpOAuthConfig(env).resourceUrl,
  )
  return { context, authorization }
}

const stashPending = async (
  request: Request,
  env: McpOAuthEnv,
  authorization: OAuthAuthorizationRequest,
  phase: PendingPayload['phase'],
  existing?: PendingPayload,
) => {
  const now = new Date()
  const payload = existing
    ? withPendingPhase(existing, phase)
    : createPendingPayload(authorization, phase, now)
  const cookie = await pendingCookieHeader(
    request,
    env.MCP_PROFILE_SESSION_ENCRYPTION_KEY,
    payload,
    now,
  )
  if (!cookie.ok) return cookie
  return { ok: true as const, header: cookie.header, payload }
}

const pendingCookieFailure = (
  request: Request,
  issuerUrl: string,
  context: OAuthCallbackContext,
  reason: 'expired' | 'too_large',
) =>
  reason === 'too_large'
    ? oversizedRedirect(request, issuerUrl, context)
    : localAuthorizationError(
        new McpOAuthTrustError('This connection expired. Start again from the client.'),
        [clearPendingCookieHeader(request)],
      )

const oversizedRedirect = (
  request: Request,
  issuerUrl: string,
  context: OAuthCallbackContext,
) =>
  callbackRedirect(
    issuerUrl,
    context,
    {
      type: 'error',
      error: 'invalid_request',
      description: 'The authorization request is too large to continue.',
    },
    [clearPendingCookieHeader(request)],
  )

export const showOAuthConsent = async (request: Request, env: McpOAuthEnv) => {
  let config: ReturnType<typeof getMcpOAuthConfig>
  try {
    config = getMcpOAuthConfig(env)
    const url = new URL(request.url)
    assertBoundedAuthorizationInput(url.search)
    assertUniqueFields(url.searchParams, ['resume', 'cancel'])
    const resume = url.searchParams.get('resume')
    const cancel = url.searchParams.get('cancel')
    if (cancel !== null && (cancel !== '1' || resume === null)) {
      throw new McpOAuthTrustError('The authorization request is ambiguous.')
    }
    if (resume !== null) {
      if (hasAuthorizationFields(url.searchParams)) {
        throw new McpOAuthTrustError('The authorization request is ambiguous.')
      }
      return resumeAuthorization(request, env, config.issuerUrl, resume, cancel === '1')
    }
    assertUniqueFields(url.searchParams, OAUTH_AUTHORIZATION_FIELDS)
    return startAuthorization(request, env, config.issuerUrl, url.searchParams)
  } catch (error) {
    return localAuthorizationError(error)
  }
}

const startAuthorization = async (
  request: Request,
  env: McpOAuthEnv,
  issuerUrl: string,
  params: URLSearchParams,
) => {
  let context: OAuthCallbackContext | null = null
  try {
    context = await repository(env).resolveCallbackContext(params)
    const resource = getMcpOAuthConfig(env).resourceUrl
    const authorization = repository(env).validateAuthorizationDetails(
      context,
      params,
      resource,
    )
    const profileId = await readActiveMcpProfileSession(request, env)
    const cookie = await stashPending(
      request,
      env,
      authorization,
      profileId ? 'consent' : 'setup',
    )
    if (!cookie.ok) return pendingCookieFailure(request, issuerUrl, context, cookie.reason)
    if (!profileId) {
      return redirectResponse(settingsContinuationUrl(issuerUrl), [cookie.header])
    }
    const accountLabel = await accountLabelFor(env, profileId)
    if (!accountLabel) {
      return callbackRedirect(
        issuerUrl,
        context,
        {
          type: 'error',
          error: 'access_denied',
          description: 'Rivolo agent access is not active.',
        },
        [clearPendingCookieHeader(request)],
      )
    }
    return consentPage(
      authorization,
      profileId,
      accountLabel,
      issuerUrl,
      cookie.payload.transactionId,
      [cookie.header],
    )
  } catch (error) {
    if (context && !(error instanceof McpOAuthTrustError)) {
      return serviceRedirect(issuerUrl, context, error)
    }
    return localAuthorizationError(error)
  }
}

const resumeAuthorization = async (
  request: Request,
  env: McpOAuthEnv,
  issuerUrl: string,
  resume: string,
  cancel: boolean,
) => {
  const pending = await readPendingRequest(request, env.MCP_PROFILE_SESSION_ENCRYPTION_KEY)
  if (pending.status !== 'valid') {
    return localAuthorizationError(
      new McpOAuthTrustError('This connection expired. Start again from the client.'),
      pending.status === 'invalid' ? [clearPendingCookieHeader(request)] : [],
    )
  }
  if (pending.payload.transactionId !== resume) {
    return localAuthorizationError(
      new McpOAuthTrustError('Start again from the client that sent you here.'),
    )
  }
  let context: OAuthCallbackContext | null = null
  try {
    const revalidated = await revalidatePending(env, pending.payload)
    context = revalidated.context
    if (cancel) {
      const clientLabel = revalidated.authorization.client.clientName ?? 'An MCP client'
      return continuationPage(
        'Cancel connection',
        `<h1>Cancel this connection?</h1>
<p>${escapeHtml(clientLabel)} will not receive access to your Rivolo notes.</p>
${cancelForm(issuerUrl, pending.payload.transactionId)}`,
        revalidated.authorization.redirectUri,
      )
    }
    const profileId = await readActiveMcpProfileSession(request, env)
    if (!profileId) {
      return continuationPage(
        'Finish connecting',
        `<h1>Finish connecting Rivolo</h1>
<p>Open Settings in this browser, connect Dropbox or Google Drive, and enable Agent access. Then continue from Settings. Nothing is approved until you review it.</p>
<div class="actions">
  <a class="button" href="${escapeHtml(settingsContinuationUrl(issuerUrl).href)}">Open Settings</a>
</div>
${cancelForm(issuerUrl, pending.payload.transactionId)}`,
        revalidated.authorization.redirectUri,
      )
    }
    const cookie = await stashPending(
      request,
      env,
      revalidated.authorization,
      'consent',
      pending.payload,
    )
    if (!cookie.ok) return pendingCookieFailure(request, issuerUrl, context, cookie.reason)
    const accountLabel = await accountLabelFor(env, profileId)
    if (!accountLabel) {
      return callbackRedirect(
        issuerUrl,
        context,
        {
          type: 'error',
          error: 'access_denied',
          description: 'Rivolo agent access is not active.',
        },
        [clearPendingCookieHeader(request)],
      )
    }
    return consentPage(
      revalidated.authorization,
      profileId,
      accountLabel,
      issuerUrl,
      pending.payload.transactionId,
      [cookie.header],
    )
  } catch (error) {
    const cookies = [clearPendingCookieHeader(request)]
    if (context && !(error instanceof McpOAuthTrustError)) {
      return serviceRedirect(issuerUrl, context, error, cookies)
    }
    return localAuthorizationError(error, cookies)
  }
}

const requireUrlEncodedBody = async (request: Request) => {
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    throw new McpOAuthTrustError('Content-Type must be application/x-www-form-urlencoded.')
  }
  const body = await request.text()
  assertBoundedAuthorizationInput(body)
  return new URLSearchParams(body)
}

const validateConsentOrigin = (request: Request, issuerUrl: string) => {
  if (request.headers.get('Origin') !== new URL(issuerUrl).origin) {
    throw new McpOAuthTrustError('Consent origin is invalid.')
  }
}

export const submitOAuthConsent = async (request: Request, env: McpOAuthEnv) => {
  let issuerUrl = ''
  try {
    issuerUrl = getMcpOAuthConfig(env).issuerUrl
    validateConsentOrigin(request, issuerUrl)
  } catch (error) {
    return localAuthorizationError(error)
  }

  let context: OAuthCallbackContext | null = null
  try {
    const body = await requireUrlEncodedBody(request)
    assertUniqueFields(body, [...OAUTH_AUTHORIZATION_FIELDS, ...CONSENT_FIELDS])
    const pending = await readPendingRequest(request, env.MCP_PROFILE_SESSION_ENCRYPTION_KEY)
    if (pending.status !== 'valid') {
      return localAuthorizationError(
        new McpOAuthTrustError('This connection expired. Start again from the client.'),
        pending.status === 'invalid' ? [clearPendingCookieHeader(request)] : [],
      )
    }
    const transactionId = body.get('transaction_id')
    if (!transactionId || transactionId !== pending.payload.transactionId) {
      return localAuthorizationError(
        new McpOAuthTrustError('Start again from the client that sent you here.'),
      )
    }
    const revalidated = await revalidatePending(env, pending.payload)
    context = revalidated.context
    const clear = [clearPendingCookieHeader(request)]
    if (!submittedAuthorizationMatches(body, pending.payload.authorization)) {
      return callbackRedirect(
        issuerUrl,
        context,
        {
          type: 'error',
          error: 'invalid_request',
          description: 'The authorization request did not match the reviewed connection.',
        },
        clear,
      )
    }
    const decision = body.get('decision')
    if (decision !== 'allow' && decision !== 'deny') {
      return callbackRedirect(
        issuerUrl,
        context,
        {
          type: 'error',
          error: 'invalid_request',
          description: 'The authorization decision is invalid.',
        },
        clear,
      )
    }
    const profileId = await readActiveMcpProfileSession(request, env)
    if (!profileId) {
      return callbackRedirect(
        issuerUrl,
        context,
        {
          type: 'error',
          error: 'access_denied',
          description: 'Rivolo agent access is not active. Start again from the client.',
        },
        clear,
      )
    }
    if (body.get('profile_id') !== profileId) {
      return callbackRedirect(
        issuerUrl,
        context,
        {
          type: 'error',
          error: 'invalid_request',
          description: 'The Rivolo notes profile changed. Review access again.',
        },
        clear,
      )
    }
    if (decision === 'deny') {
      return callbackRedirect(
        issuerUrl,
        context,
        { type: 'error', error: 'access_denied', description: 'The request was denied.' },
        clear,
      )
    }
    const code = await repository(env).issueAuthorizationCode(profileId, revalidated.authorization)
    return callbackRedirect(issuerUrl, context, { type: 'code', code }, clear)
  } catch (error) {
    const cookies = context ? [clearPendingCookieHeader(request)] : []
    if (context && !(error instanceof McpOAuthTrustError)) {
      return serviceRedirect(issuerUrl, context, error, cookies)
    }
    return localAuthorizationError(error, cookies)
  }
}

export const readOAuthPendingStatus = async (request: Request, env: McpOAuthEnv) => {
  try {
    const pending = await readPendingRequest(request, env.MCP_PROFILE_SESSION_ENCRYPTION_KEY)
    if (pending.status !== 'valid') {
      return jsonResponse(
        { pending: false },
        200,
        pending.status === 'invalid'
          ? { 'Set-Cookie': clearPendingCookieHeader(request) }
          : {},
      )
    }
    let clientLabel = 'An MCP client'
    try {
      const client = await repository(env).getClient(pending.payload.authorization.client_id)
      if (client?.clientName) clientLabel = client.clientName
    } catch (error) {
      if (!(error instanceof McpOAuthProtocolError)) throw error
    }
    const ready = Boolean(await readActiveMcpProfileSession(request, env))
    return jsonResponse({
      pending: true,
      clientLabel,
      transactionId: pending.payload.transactionId,
      expiresAt: pending.payload.expiresAt,
      ready,
    })
  } catch (error) {
    return jsonResponse(
      {
        error: 'server_error',
        error_description: 'Authorization is temporarily unavailable.',
      },
      classifyOAuthServiceFailure(error) === 'transient' ? 503 : 500,
    )
  }
}

export const submitOAuthPendingCancellation = async (request: Request, env: McpOAuthEnv) => {
  let issuerUrl = ''
  try {
    issuerUrl = getMcpOAuthConfig(env).issuerUrl
    validateConsentOrigin(request, issuerUrl)
  } catch (error) {
    return localAuthorizationError(error)
  }
  let context: OAuthCallbackContext | null = null
  try {
    const body = await requireUrlEncodedBody(request)
    assertUniqueFields(body, ['decision', 'transaction_id'])
    if (body.get('decision') !== 'deny') {
      throw new McpOAuthTrustError('The authorization decision is invalid.')
    }
    const pending = await readPendingRequest(request, env.MCP_PROFILE_SESSION_ENCRYPTION_KEY)
    if (pending.status !== 'valid') {
      return localAuthorizationError(
        new McpOAuthTrustError('This connection expired. Start again from the client.'),
        pending.status === 'invalid' ? [clearPendingCookieHeader(request)] : [],
      )
    }
    if (body.get('transaction_id') !== pending.payload.transactionId) {
      return localAuthorizationError(
        new McpOAuthTrustError('Start again from the client that sent you here.'),
      )
    }
    const revalidated = await revalidatePending(env, pending.payload)
    context = revalidated.context
    return callbackRedirect(
      issuerUrl,
      context,
      { type: 'error', error: 'access_denied', description: 'The request was denied.' },
      [clearPendingCookieHeader(request)],
    )
  } catch (error) {
    const cookies = context ? [clearPendingCookieHeader(request)] : []
    if (context && !(error instanceof McpOAuthTrustError)) {
      return serviceRedirect(issuerUrl, context, error, cookies)
    }
    return localAuthorizationError(
      error instanceof McpOAuthTrustError &&
        error.message === 'The authorization decision is invalid.'
        ? new McpOAuthTrustError('The authorization request could not be completed.')
        : error,
      cookies,
    )
  }
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
    const oauthRepository = new McpOAuthRepository(env.MCP_DB)
    const grantType = body.get('grant_type')
    const token =
      grantType === 'authorization_code'
        ? await oauthRepository.exchangeAuthorizationCode({
            clientId,
            code: body.get('code') ?? '',
            codeVerifier: body.get('code_verifier') ?? '',
            redirectUri: body.get('redirect_uri') ?? '',
            resource,
          })
        : grantType === 'refresh_token'
          ? await oauthRepository.exchangeRefreshToken({
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
