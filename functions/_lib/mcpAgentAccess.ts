import {
  ProviderProfileRepository,
  ProviderProfileValidationError,
} from './providerProfiles'
import {
  clearTokenCookieHeader,
  createTokenCookieHeader,
  readStoredToken,
  type CookieConfig,
} from './tokenCookie'

export type McpAgentAccessEnv = {
  MCP_DB: D1Database
  MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: string
  MCP_PROFILE_SESSION_ENCRYPTION_KEY: string
  MCP_ALLOWED_ORIGINS?: string
}

type DropboxEnableBody = {
  timeZone: string
  dailyFolderId?: string
  target: {
    path: string
  }
}

type GoogleDriveEnableBody = {
  timeZone: string
  dailyFolderId?: string
  target: {
    fileId: string
  }
}

type OneDriveEnableBody = {
  timeZone: string
  target: {
    folder: string
  }
}

const MCP_PROFILE_SESSION_COOKIE = 'rivolo_mcp_profile'
const MCP_PROFILE_SESSION_PATH = '/api/mcp'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400

const requiredText = (value: unknown, field: string, maxLength: number) => {
  if (typeof value !== 'string') {
    throw new ProviderProfileValidationError(`${field} must be a string.`)
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new ProviderProfileValidationError(`${field} is invalid.`)
  }
  return normalized
}

const validateTimeZone = (value: unknown) => {
  const timeZone = requiredText(value, 'timeZone', 64)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
  } catch {
    throw new ProviderProfileValidationError('timeZone must be an IANA time zone.')
  }
  return timeZone
}

const dailyFolderId = (value: unknown, pattern: RegExp) => {
  if (value === undefined) return undefined
  const ref = requiredText(value, 'dailyFolderId', 512)
  if (!pattern.test(ref)) throw new ProviderProfileValidationError('dailyFolderId is invalid.')
  return ref
}

export const parseDropboxEnableBody = (body: unknown): DropboxEnableBody => {
  const input = body as { timeZone?: unknown; dailyFolderId?: unknown; target?: { path?: unknown } } | null
  const path = requiredText(input?.target?.path, 'target.path', 1024)
  if (
    !path.startsWith('/') ||
    path === '/' ||
    path.endsWith('/') ||
    path.includes('//') ||
    path.includes('\\')
  ) {
    throw new ProviderProfileValidationError(
      'target.path must be an absolute Dropbox file path.',
    )
  }
  return {
    timeZone: validateTimeZone(input?.timeZone),
    target: { path },
    dailyFolderId: dailyFolderId(input?.dailyFolderId, /^id:[A-Za-z0-9_-]+$/),
  }
}

export const parseGoogleDriveEnableBody = (body: unknown): GoogleDriveEnableBody => {
  const input = body as { timeZone?: unknown; dailyFolderId?: unknown; target?: { fileId?: unknown } } | null
  return {
    timeZone: validateTimeZone(input?.timeZone),
    dailyFolderId: dailyFolderId(input?.dailyFolderId, /^[A-Za-z0-9_-]+$/),
    target: {
      fileId: requiredText(input?.target?.fileId, 'target.fileId', 512),
    },
  }
}

// OneDrive notebooks are always daily: the target is the folder itself, as a
// canonical Graph item address.
export const parseOneDriveEnableBody = (body: unknown): OneDriveEnableBody => {
  const input = body as { timeZone?: unknown; target?: { folder?: unknown } } | null
  const folder = requiredText(input?.target?.folder, 'target.folder', 1023)
  if (!/^\/drives\/[A-Za-z0-9!_%.-]+\/items\/[A-Za-z0-9!_%.-]+$/.test(folder)) {
    throw new ProviderProfileValidationError('target.folder must be a OneDrive item address.')
  }
  return {
    timeZone: validateTimeZone(input?.timeZone),
    target: { folder },
  }
}

export const mcpAllowedOrigins = (env: McpAgentAccessEnv) =>
  (env.MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

export const mcpProfileRepository = (env: McpAgentAccessEnv) =>
  new ProviderProfileRepository(
    env.MCP_DB,
    env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
  )

export const mcpProfileSessionCookieConfig = (
  env: McpAgentAccessEnv,
): CookieConfig => ({
  name: MCP_PROFILE_SESSION_COOKIE,
  path: MCP_PROFILE_SESSION_PATH,
  secret: env.MCP_PROFILE_SESSION_ENCRYPTION_KEY,
  maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
  sameSite: 'Lax',
})

export const createMcpProfileSessionCookie = (
  request: Request,
  env: McpAgentAccessEnv,
  profileId: string,
) => createTokenCookieHeader(request, mcpProfileSessionCookieConfig(env), profileId)

export const clearMcpProfileSessionCookie = (
  request: Request,
  env: McpAgentAccessEnv,
) => clearTokenCookieHeader(request, mcpProfileSessionCookieConfig(env))

export const readMcpProfileSession = (request: Request, env: McpAgentAccessEnv) =>
  readStoredToken(request, mcpProfileSessionCookieConfig(env))

export const readActiveMcpProfileSession = async (
  request: Request,
  env: McpAgentAccessEnv,
) => {
  const profileId = await readMcpProfileSession(request, env)
  if (!profileId) return null
  const repository = mcpProfileRepository(env)
  const [profile, credential] = await Promise.all([
    repository.getMetadata(profileId),
    repository.decryptCredential(profileId),
  ])
  return profile && !profile.revokedAt && credential ? profileId : null
}

export const setCookieHeaders = (...cookies: string[]) => {
  const headers = new Headers()
  cookies.forEach((cookie) => headers.append('Set-Cookie', cookie))
  return headers
}
