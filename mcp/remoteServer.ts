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
import { refreshOneDriveAccessToken, toPublicOneDriveError } from '../functions/_lib/oneDriveOAuth.js'
import { roomName } from '../functions/_lib/oneDriveNotebook.js'
import { relayFetch } from '../functions/_lib/oneDriveRelay.js'
import { createHostedDailyNotes, createHostedOneDriveNotes } from './hostedDailyNotes.js'
import { createGoogleDriveNotesSource } from './googleDriveNotesSource.js'
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
  DEFAULT_MCP_RESOURCE_URL,
  type McpOAuthMetadataConfig,
} from '../src/lib/mcpOAuthMetadata.js'
import type { DailyRemoteFile } from '../src/lib/notebookDays.js'

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
  ONEDRIVE_CLIENT_ID?: string
  ONEDRIVE_CLIENT_SECRET?: string
  ONEDRIVE_EVENTS?: DurableObjectNamespace
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
  refreshOneDrive: typeof refreshOneDriveAccessToken
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
  refreshOneDrive: refreshOneDriveAccessToken,
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
  return new Set([new URL(env.MCP_RESOURCE_URL || DEFAULT_MCP_RESOURCE_URL).origin, ...configured]).has(origin)
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

const authorizedFetch = (
  getAccessToken: () => Promise<string>,
  providerFetch: typeof fetch,
) => async (input: string | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${await getAccessToken()}`)
  return providerFetch(input, { ...init, headers })
}

const createDropboxAccessToken = (
  auth: RemoteMcpPrincipal,
  env: RemoteMcpEnv,
  dependencies: RemoteMcpDependencies,
) => {
  let accessToken: Promise<string> | undefined
  return () => {
    accessToken ??= dependencies
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
        return token.access_token
      })
      .catch(() => {
        throw new Error('Dropbox authorization failed. Reconnect Dropbox in Rivolo.')
      })
    return accessToken
  }
}

const createGoogleAccessToken = (
  auth: RemoteMcpPrincipal,
  env: RemoteMcpEnv,
  dependencies: RemoteMcpDependencies,
) => {
  let accessToken: Promise<string> | undefined
  return () => {
    accessToken ??= dependencies
      .refreshGoogle(auth.providerRefreshToken, env)
      .then((token) => token.access_token)
      .catch(() => {
        throw new Error(
          'Google Drive authorization failed. Reconnect Google Drive in Rivolo.',
        )
      })
    return accessToken
  }
}

const createOneDriveAccessToken = (
  auth: RemoteMcpPrincipal,
  env: RemoteMcpEnv,
  dependencies: RemoteMcpDependencies,
) => {
  let accessToken: Promise<string> | undefined
  return () => accessToken ??= (async () => {
    const { ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET } = env
    if (!ONEDRIVE_CLIENT_ID || !ONEDRIVE_CLIENT_SECRET) {
      throw new Error('OneDrive Agent access is temporarily unavailable.')
    }
    const token = await dependencies
      .refreshOneDrive(auth.providerRefreshToken, { ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET })
      .catch((error: unknown) => {
        if (toPublicOneDriveError(error).status === 401) {
          throw new Error('OneDrive authorization expired. Reconnect OneDrive and enable Agent access again in Rivolo.')
        }
        throw new Error('OneDrive authorization is temporarily unavailable. Retry the request.')
      })
    await new ProviderProfileRepository(
      env.MCP_DB,
      env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
    ).updateCredential(auth.profile.profileId, token.refresh_token ?? auth.providerRefreshToken)
    return token.access_token
  })()
}

const publishOneDriveDay = async (
  relay: RemoteMcpEnv['ONEDRIVE_EVENTS'],
  folder: string,
  dayId: string,
  file: DailyRemoteFile,
) => {
  try {
    if (!relay) throw new Error('Missing relay binding.')
    const room = await roomName(`daily:${folder}`)
    const channel = relay.get(relay.idFromName(room))
    const response = await relayFetch(channel, '/publish', {
      method: 'POST',
      body: JSON.stringify({ type: 'day-changed', dayId, item: file.ref, revision: file.revision, sender: '' }),
    })
    if (!response.ok) throw new Error('The relay rejected the update.')
  } catch {
    console.warn('[mcp-onedrive] Could not notify subscribers of a committed day.')
  }
}

const compactProviderResult = (
  result: Parameters<typeof compactWriteResult>[0] & Record<string, unknown>,
): RemoteCompactWriteResult =>
  compactWriteResult(result) as RemoteCompactWriteResult

const createNotesRuntime = (
  auth: RemoteMcpPrincipal,
  env: RemoteMcpEnv,
  dependencies: RemoteMcpDependencies,
  ctx?: Pick<ExecutionContext, 'waitUntil'>,
): {
  loadNotes: LoadNotes
  addToDay: AddToDayWriter<RemoteCompactWriteResult>
} => {
  const providerFetch = dependencies.fetch

  if (auth.profile.provider === 'onedrive') {
    const { target: { folder }, providerAccountId, providerName } = auth.profile
    const token = createOneDriveAccessToken(auth, env, dependencies)
    const graphFetch = authorizedFetch(token, providerFetch)
    const notes = createHostedOneDriveNotes(folder, {
      authorizedFetch: (url, init) => graphFetch(url, { ...init, redirect: 'manual' }),
      accountKey: async () => providerAccountId,
      fetch: providerFetch,
    }, providerName ? `Agent · ${providerName}` : 'Agent', async (dayId, file) => {
      const notification = publishOneDriveDay(env.ONEDRIVE_EVENTS, folder, dayId, file)
      if (ctx) ctx.waitUntil(notification)
      else await notification
    })
    return { loadNotes: notes.loadNotes, addToDay: async (input) => compactProviderResult(await notes.add(input)) }
  }

  if (auth.profile.dailyFolderId) {
    const token = auth.profile.provider === 'dropbox'
      ? createDropboxAccessToken(auth, env, dependencies)
      : createGoogleAccessToken(auth, env, dependencies)
    const notes = createHostedDailyNotes(auth.profile.provider, auth.profile.dailyFolderId, authorizedFetch(token, providerFetch))
    return { loadNotes: notes.loadNotes, addToDay: async (input) => compactProviderResult(await notes.add(input)) }
  }


  if (auth.profile.provider === 'dropbox') {
    const adapter = createDropboxNotesAdapter({
      authorizedFetch: authorizedFetch(
        createDropboxAccessToken(auth, env, dependencies),
        providerFetch,
      ),
      path: auth.profile.target.path,
    })
    return {
      loadNotes: adapter.loadNotes,
      addToDay: async (input) => compactProviderResult(await adapter.addToDay(input)),
    }
  }

  const source = createGoogleDriveNotesSource(
    authorizedFetch(
      createGoogleAccessToken(auth, env, dependencies),
      providerFetch,
    ),
    auth.profile.target,
  )
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
  ctx?: Pick<ExecutionContext, 'waitUntil'>,
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
    const runtime = createNotesRuntime(principal, env, dependencies, ctx)
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
