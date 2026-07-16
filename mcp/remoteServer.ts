import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  authenticateMcpBearer,
  type AuthenticatedMcpBearer,
} from '../functions/_lib/mcpPersonalTokens.js'
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
import { ProviderWriteNotAppliedError } from './providerWriteErrors.js'
import { createDropboxNotesAdapter } from './providers/dropboxNotes.js'
import { registerReadTools, type LoadNotes } from './readTools.js'
import {
  compactWriteResult,
  registerWriteTools,
  type AddToDayWriter,
  type CompactAddToDayWriterResult,
} from './writeTools.js'

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
}

export type RemoteMcpDependencies = {
  authenticate: typeof authenticateMcpBearer
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

const defaultDependencies: RemoteMcpDependencies = {
  authenticate: authenticateMcpBearer,
  fetch,
  refreshDropbox: refreshDropboxAccessToken,
  refreshGoogle: refreshGoogleAccessToken,
}

const jsonResponse = (payload: unknown, status: number, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...Object.fromEntries(new Headers(headers)) },
  })

const unauthorizedResponse = () =>
  jsonResponse(
    { error: 'MCP bearer authentication required.' },
    401,
    { 'WWW-Authenticate': 'Bearer realm="rivolo-mcp"' },
  )

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
  auth: AuthenticatedMcpBearer,
  scope: AuthenticatedMcpBearer['token']['scopes'][number],
) => auth.token.scopes.includes(scope)

const authorizedFetch = (
  getAccessToken: () => Promise<string>,
  providerFetch: typeof fetch,
) => async (input: string | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${await getAccessToken()}`)
  return providerFetch(input, { ...init, headers })
}

const createDropboxAccessToken = (
  auth: AuthenticatedMcpBearer,
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
  auth: AuthenticatedMcpBearer,
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

const compactProviderResult = (
  result: Parameters<typeof compactWriteResult>[0] & Record<string, unknown>,
): RemoteCompactWriteResult =>
  compactWriteResult(result) as RemoteCompactWriteResult

const createNotesRuntime = (
  auth: AuthenticatedMcpBearer,
  env: RemoteMcpEnv,
  dependencies: RemoteMcpDependencies,
): {
  loadNotes: LoadNotes
  addToDay: AddToDayWriter<RemoteCompactWriteResult>
} => {
  const providerFetch = dependencies.fetch

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
  auth: AuthenticatedMcpBearer,
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

  let auth: AuthenticatedMcpBearer | null
  try {
    auth = await dependencies.authenticate(request, env)
  } catch {
    return jsonResponse(
      { error: 'MCP authentication is temporarily unavailable.' },
      503,
    )
  }

  if (!auth) return unauthorizedResponse()

  const canRead = hasScope(auth, 'notes:read')
  const canWrite = hasScope(auth, 'notes:write')
  if (!canRead && !canWrite) {
    return jsonResponse({ error: 'MCP token has no usable scopes.' }, 403)
  }

  try {
    const runtime = createNotesRuntime(auth, env, dependencies)
    const server = new McpServer({
      name: 'rivolo-notes',
      version: SERVER_VERSION,
    })

    if (canRead) registerReadTools(server, runtime.loadNotes)
    if (canWrite) {
      registerWriteTools(
        server,
        createDurableWriter(auth, env, runtime.addToDay),
        auth.profile.timeZone,
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
