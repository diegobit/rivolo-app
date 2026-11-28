import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  authenticateMcpBearer,
  type AuthenticatedMcpBearer,
} from '../functions/_lib/mcpPersonalTokens.js'
import {
  authenticateMcpOAuthBearer,
  type AuthenticatedMcpOAuthBearer,
} from '../functions/_lib/mcpOAuth.js'
import {
  McpWriteNotAppliedError,
  McpWriteOperationRepository,
  createIdempotentWriter,
  type NormalizedMcpWriteInput,
} from '../functions/_lib/mcpWriteIdempotency.js'
import { ProviderProfileRepository } from '../functions/_lib/providerProfiles.js'
import {
  refreshDropboxAccessToken,
} from '../functions/_lib/dropboxOAuth.js'
import {
  refreshGoogleAccessToken,
} from '../functions/_lib/googleOAuth.js'
import { createGoogleDriveNotesSource } from './googleDriveNotesSource.js'
import { createHostedDailyNotes } from './hostedDailyNotes.js'
import {
  createProviderAccessTokenCache,
  providerAccessTokenKey,
  type ProviderAccessToken,
  type ProviderAccessTokenGrant,
} from './providerAccessTokenCache.js'
import { ProviderWriteNotAppliedError } from './providerWriteErrors.js'
import { createDropboxNotesAdapter } from './providers/dropboxNotes.js'
import { registerReadTools, type LoadNotes } from './readTools.js'
import {
  compactWriteResult,
  registerWriteTools,
  type AddToDayWriter,
  type CompactAddToDayWriterResult,
} from './writeTools.js'
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js'
import {
  createMcpBearerChallenge,
  type McpOAuthMetadataConfig,
} from '../src/lib/mcpOAuthMetadata.js'

const SERVER_VERSION = '0.2.0'
const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
}

type DropboxRefreshResult = Awaited<
  ReturnType<typeof refreshDropboxAccessToken>
>
type GoogleRefreshResult = Awaited<
  ReturnType<typeof refreshGoogleAccessToken>
>

export type RemoteMcpEnv = {
  MCP_DB: D1Database
  MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: string
  MCP_ALLOWED_ORIGINS?: string
  DROPBOX_CLIENT_ID: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  MCP_OAUTH_ISSUER_URL?: string
  MCP_RESOURCE_URL?: string
}

export type RemoteMcpPrincipal = {
  profile: AuthenticatedMcpBearer['profile']
  providerRefreshToken: string
  scopes: ReadonlyArray<'notes:read' | 'notes:write'>
}

type RemoteMcpAuthResult =
  | AuthenticatedMcpBearer
  | AuthenticatedMcpOAuthBearer

export type RemoteMcpDependencies = {
  authenticate: (
    request: Request,
    env: RemoteMcpEnv,
  ) => Promise<RemoteMcpAuthResult | null>
  fetch: typeof fetch
  refreshDropbox: (
    refreshToken: string,
    env: Pick<RemoteMcpEnv, 'DROPBOX_CLIENT_ID'>,
  ) => Promise<DropboxRefreshResult>
  refreshGoogle: (
    refreshToken: string,
    env: Pick<
      RemoteMcpEnv,
      'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'
    >,
  ) => Promise<GoogleRefreshResult>
}

type RemoteCompactWriteResult = CompactAddToDayWriterResult & {
  source: unknown
  warnings?: string[]
  conflictRetries?: number
  status?: 'written' | 'attention'
  recovered?: boolean
  attention?: string
}

const bearerValue = (request: Request) =>
  request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1] ?? null

export const authenticateRemoteMcpBearer = async (
  request: Request,
  env: RemoteMcpEnv,
  authenticators = {
    personal: authenticateMcpBearer,
    oauth: authenticateMcpOAuthBearer,
  },
): Promise<RemoteMcpAuthResult | null> => {
    const bearer = bearerValue(request)
    if (bearer?.startsWith('rva_')) {
      return authenticators.oauth(request, env)
    }
    if (bearer?.startsWith('rvl_')) {
      return authenticators.personal(request, env)
    }
    return null
  }

const defaultDependencies: RemoteMcpDependencies = {
  authenticate: (request, env) => authenticateRemoteMcpBearer(request, env),
  fetch,
  refreshDropbox: refreshDropboxAccessToken,
  refreshGoogle: refreshGoogleAccessToken,
}

const jsonResponse = (payload: unknown, status: number, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...Object.fromEntries(new Headers(headers)) },
  })

const oauthMetadataConfig = (env: RemoteMcpEnv): McpOAuthMetadataConfig => ({
  issuerUrl: env.MCP_OAUTH_ISSUER_URL,
  resourceUrl: env.MCP_RESOURCE_URL,
})

const unauthorizedResponse = (env: RemoteMcpEnv) =>
  jsonResponse(
    { error: 'MCP bearer authentication required.' },
    401,
    { 'WWW-Authenticate': createMcpBearerChallenge(oauthMetadataConfig(env)) },
  )

const unsupportedProtocolVersion = (request: Request) => {
  const protocolVersion = request.headers.get('mcp-protocol-version')
  if (
    protocolVersion === null ||
    SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)
  ) {
    return null
  }
  const versionLabel = /^[A-Za-z0-9._-]{1,32}$/.test(protocolVersion)
    ? protocolVersion
    : 'unsupported'
  return jsonResponse(
    {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: `Bad Request: Unsupported protocol version: ${versionLabel} (supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')})`,
      },
      id: null,
    },
    400,
  )
}

const validateOrigin = (request: Request, env: RemoteMcpEnv) => {
  const origin = request.headers.get('Origin')
  if (!origin) return true
  const configured = (env.MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return new Set(['https://mcp.rivolo.app', ...configured]).has(origin)
}

const hasScope = (
  principal: RemoteMcpPrincipal,
  scope: RemoteMcpPrincipal['scopes'][number],
) => principal.scopes.includes(scope)

const toPrincipal = (auth: RemoteMcpAuthResult): RemoteMcpPrincipal => ({
  profile: auth.profile,
  providerRefreshToken: auth.providerRefreshToken,
  scopes: 'token' in auth ? auth.token.scopes : auth.scopes,
})

// Lives for the isolate, shared by requests that already passed MCP auth.
const providerAccessTokens = createProviderAccessTokenCache()

type ProviderAccessTokens = {
  get: () => Promise<ProviderAccessToken>
  reject: (accessToken: string) => Promise<void>
}

const cachedProviderAccessTokens = (
  auth: RemoteMcpPrincipal,
  load: () => Promise<ProviderAccessTokenGrant>,
): ProviderAccessTokens => {
  let key: Promise<string> | undefined
  const cacheKey = () =>
    (key ??= providerAccessTokenKey(
      auth.profile.profileId,
      auth.providerRefreshToken,
    ))
  return {
    get: async () => providerAccessTokens.get(await cacheKey(), load),
    reject: async (accessToken) =>
      providerAccessTokens.reject(await cacheKey(), accessToken),
  }
}

const authorizedFetch = (
  accessTokens: ProviderAccessTokens,
  providerFetch: typeof fetch,
) => async (input: string | URL, init: RequestInit = {}) => {
  const send = (accessToken: string) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    return providerFetch(input, { ...init, headers })
  }

  const token = await accessTokens.get()
  const response = await send(token.accessToken)
  if (response.status !== 401 || !token.cached) return response

  // A cached token can be revoked or expire early. A 401 means the provider
  // did not apply the request, so refresh once and send it again.
  await response.body?.cancel().catch(() => undefined)
  await accessTokens.reject(token.accessToken)
  return send((await accessTokens.get()).accessToken)
}

const loadDropboxAccessToken = (
  auth: RemoteMcpPrincipal,
  env: RemoteMcpEnv,
  dependencies: RemoteMcpDependencies,
) => () =>
  dependencies
    .refreshDropbox(auth.providerRefreshToken, env)
    .then(async (token) => {
      if (
        token.refresh_token
        && token.refresh_token !== auth.providerRefreshToken
      ) {
        await new ProviderProfileRepository(
          env.MCP_DB,
          env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
        ).updateCredential(auth.profile.profileId, token.refresh_token)
      }
      return {
        accessToken: token.access_token,
        expiresInSeconds: token.expires_in,
      }
    })
    .catch(() => {
      throw new Error('Dropbox authorization failed. Reconnect Dropbox in Rivolo.')
    })

const loadGoogleAccessToken = (
  auth: RemoteMcpPrincipal,
  env: RemoteMcpEnv,
  dependencies: RemoteMcpDependencies,
) => () =>
  dependencies
    .refreshGoogle(auth.providerRefreshToken, env)
    .then((token) => ({
      accessToken: token.access_token,
      expiresInSeconds: token.expires_in,
    }))
    .catch(() => {
      throw new Error(
        'Google Drive authorization failed. Reconnect Google Drive in Rivolo.',
      )
    })

const compactProviderResult = (
  result: Parameters<typeof compactWriteResult>[0] & Record<string, unknown>,
): RemoteCompactWriteResult =>
  compactWriteResult(result) as RemoteCompactWriteResult

const createNotesRuntime = (
  auth: RemoteMcpPrincipal,
  env: RemoteMcpEnv,
  dependencies: RemoteMcpDependencies,
): {
  loadNotes: LoadNotes
  addToDay: AddToDayWriter<RemoteCompactWriteResult>
} => {
  const providerFetch = dependencies.fetch
  const loadToken = auth.profile.provider === 'dropbox'
    ? loadDropboxAccessToken(auth, env, dependencies)
    : loadGoogleAccessToken(auth, env, dependencies)
  const fetchForProfile = authorizedFetch(cachedProviderAccessTokens(auth, loadToken), providerFetch)

  // A profile moved to daily sync reads and writes one file per day.
  if (auth.profile.dailyFolderId) {
    const notes = createHostedDailyNotes(auth.profile.provider, auth.profile.dailyFolderId, fetchForProfile)
    return { loadNotes: notes.loadNotes, addToDay: async (input) => compactProviderResult(await notes.add(input)) }
  }

  if (auth.profile.provider === 'dropbox') {
    const adapter = createDropboxNotesAdapter({
      authorizedFetch: fetchForProfile,
      path: auth.profile.target.path,
    })
    return {
      loadNotes: adapter.loadNotes,
      addToDay: async (input) => compactProviderResult(await adapter.addToDay(input)),
    }
  }

  const source = createGoogleDriveNotesSource(fetchForProfile, auth.profile.target)
  return {
    loadNotes: source.read,
    addToDay: async (input) => compactProviderResult(await source.addToDay(input)),
  }
}

const createDurableWriter = (
  auth: RemoteMcpPrincipal,
  env: RemoteMcpEnv,
  writer: AddToDayWriter<RemoteCompactWriteResult>,
) =>
  createIdempotentWriter(
    new McpWriteOperationRepository(env.MCP_DB),
    auth.profile.profileId,
    async (input: NormalizedMcpWriteInput) => {
      try {
        return await writer(input)
      } catch (error) {
        if (error instanceof ProviderWriteNotAppliedError) {
          throw new McpWriteNotAppliedError(error.message, { cause: error })
        }
        throw error
      }
    },
  )

export const handleRemoteMcpRequest = async (
  request: Request,
  env: RemoteMcpEnv,
  overrides: Partial<RemoteMcpDependencies> = {},
): Promise<Response> => {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (!validateOrigin(request, env)) {
    return jsonResponse({ error: 'Origin is not allowed.' }, 403)
  }

  let auth: RemoteMcpAuthResult | null
  try {
    auth = await dependencies.authenticate(request, env)
  } catch {
    return jsonResponse(
      { error: 'MCP authentication is temporarily unavailable.' },
      503,
    )
  }

  if (!auth) return unauthorizedResponse(env)

  const principal = toPrincipal(auth)

  const canRead = hasScope(principal, 'notes:read')
  const canWrite = hasScope(principal, 'notes:write')
  if (!canRead && !canWrite) {
    return jsonResponse({ error: 'MCP token has no usable scopes.' }, 403)
  }

  const protocolError = unsupportedProtocolVersion(request)
  if (protocolError) return protocolError

  if (request.method === 'GET') {
    return new Response('Method not allowed.', {
      status: 405,
      headers: {
        Allow: 'POST',
        'Cache-Control': 'no-store',
      },
    })
  }

  try {
    const runtime = createNotesRuntime(principal, env, dependencies)
    const server = new McpServer({
      name: 'rivolo-notes',
      version: SERVER_VERSION,
    })

    if (canRead) registerReadTools(server, runtime.loadNotes)
    if (canWrite) {
      registerWriteTools(
        server,
        createDurableWriter(principal, env, runtime.addToDay),
        principal.profile.timeZone,
      )
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    })
    await server.connect(transport)
    return await transport.handleRequest(request)
  } catch {
    return jsonResponse(
      { error: 'The Rivolo MCP request could not be processed.' },
      500,
    )
  }
}
