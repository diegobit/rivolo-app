// @vitest-environment node
import { SqliteD1, closeTestDatabases } from './helpers/d1'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMcpProfileSessionCookie,
  readMcpProfileSession,
  type McpAgentAccessEnv,
} from '../../functions/_lib/mcpAgentAccess'
import { ProviderProfileRepository } from '../../functions/_lib/providerProfiles'
import { dropboxCookieConfig } from '../../functions/_lib/dropboxOAuth'
import { googleCookieConfig } from '../../functions/_lib/googleOAuth'
import { createTokenCookieHeader } from '../../functions/_lib/tokenCookie'
import { onRequestPost as enableDropbox } from '../../functions/api/dropbox/mcp-enable'
import { onRequestPost as enableGoogleDrive } from '../../functions/api/google-drive/mcp-enable'
import { onRequestPost as enableOneDrive } from '../../functions/api/onedrive/mcp-enable'
import { oneDriveCookieConfig } from '../../functions/_lib/oneDriveOAuth'
import { decryptToken } from '../../functions/_lib/tokenCookie'
import { onRequestPost as disableAgentAccess } from '../../functions/api/mcp/disable'
import { onRequestGet as getAgentAccessStatus } from '../../functions/api/mcp/status'

type TestEnv = McpAgentAccessEnv & {
  DROPBOX_CLIENT_ID: string
  DROPBOX_TOKEN_ENCRYPTION_KEY: string
  DROPBOX_ALLOWED_ORIGINS: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GOOGLE_TOKEN_ENCRYPTION_KEY: string
  GOOGLE_ALLOWED_ORIGINS: string
}

const createEnv = (db: SqliteD1): TestEnv => ({
  MCP_DB: db as unknown as D1Database,
  MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: 'profile-token-secret',
  MCP_PROFILE_SESSION_ENCRYPTION_KEY: 'profile-session-secret',
  MCP_ALLOWED_ORIGINS: 'https://rivolo.app',
  DROPBOX_CLIENT_ID: 'dropbox-client',
  DROPBOX_TOKEN_ENCRYPTION_KEY: 'dropbox-cookie-secret',
  DROPBOX_ALLOWED_ORIGINS: 'https://rivolo.app',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-client-secret',
  GOOGLE_TOKEN_ENCRYPTION_KEY: 'google-cookie-secret',
  GOOGLE_ALLOWED_ORIGINS: 'https://rivolo.app',
})

const cookiePair = (setCookie: string, name: string) => {
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`))
  if (!match) throw new Error(`Missing ${name} cookie.`)
  return `${name}=${match[1]}`
}

const mutationRequest = (
  path: string,
  body?: unknown,
  cookie?: string,
) =>
  new Request(`https://rivolo.app${path}`, {
    method: 'POST',
    headers: {
      Origin: 'https://rivolo.app',
      'X-Requested-With': 'XmlHttpRequest',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const invoke = <Env>(
  handler: PagesFunction<Env>,
  request: Request,
  env: Env,
) =>
  handler({
    request,
    env,
  } as Parameters<PagesFunction<Env>>[0]) as Promise<Response>

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MCP provider profile session', () => {
  it('stores only an encrypted profile id in a secure Lax /api/mcp cookie', async () => {
    const env = createEnv(new SqliteD1())
    const profileId = '11111111-1111-4111-8111-111111111111'
    const request = new Request('https://rivolo.app/api/dropbox/mcp-enable')
    const header = await createMcpProfileSessionCookie(request, env, profileId)

    expect(header).toContain('Path=/api/mcp')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Secure')
    expect(header).not.toContain(profileId)

    const sessionRequest = new Request('https://rivolo.app/api/mcp/status', {
      headers: { Cookie: cookiePair(header, 'rivolo_mcp_profile') },
    })
    expect(await readMcpProfileSession(sessionRequest, env)).toBe(profileId)
  })

  it('rejects malformed enable input before contacting a provider', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const db = new SqliteD1()
    const env = createEnv(db)
    const baseRequest = new Request('https://rivolo.app/api/dropbox/mcp-enable')
    const providerCookie = await createTokenCookieHeader(
      baseRequest,
      dropboxCookieConfig(env),
      'dropbox-refresh',
    )

    const response = await invoke(
      enableDropbox,
      mutationRequest(
        '/api/dropbox/mcp-enable',
        {
          timeZone: 'Not/A_Time_Zone',
          target: { path: 'relative/inbox.md' },
        },
        cookiePair(providerCookie, 'rivolo_dropbox_refresh'),
      ),
      env,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('provider-specific MCP enable endpoints', () => {
  it('enables Dropbox from the refresh cookie and authoritative provider data', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const baseRequest = new Request('https://rivolo.app/api/dropbox/mcp-enable')
    const providerCookie = await createTokenCookieHeader(
      baseRequest,
      dropboxCookieConfig(env),
      'dropbox-refresh',
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'dropbox-access',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            account_id: 'dbid:authoritative',
            email: 'dropbox@example.com',
            name: { display_name: 'Dropbox User' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            '.tag': 'file',
            path_display: '/Journal/inbox.md',
            is_downloadable: true,
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const response = await invoke(
      enableDropbox,
      mutationRequest(
        '/api/dropbox/mcp-enable',
        {
          timeZone: 'Europe/Rome',
          target: { path: '/journal/inbox.md' },
        },
        cookiePair(providerCookie, 'rivolo_dropbox_refresh'),
      ),
      env,
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      enabled: true,
      profile: {
        provider: 'dropbox',
        providerAccountId: 'dbid:authoritative',
        providerEmail: 'dropbox@example.com',
        providerName: 'Dropbox User',
        timeZone: 'Europe/Rome',
        target: { path: '/Journal/inbox.md' },
      },
    })
    expect(response.headers.get('Set-Cookie')).toContain('rivolo_mcp_profile=')
    expect(db.get('SELECT * FROM mcp_provider_profiles')?.encrypted_refresh_token).not.toContain(
      'dropbox-refresh',
    )
  })

  it('requires the existing Dropbox provider cookie', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await invoke(
      enableDropbox,
      mutationRequest('/api/dropbox/mcp-enable', {
        timeZone: 'Europe/Rome',
        target: { path: '/inbox.md' },
      }),
      createEnv(new SqliteD1()),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enables Google Drive from authoritative account, file, and capability data', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const baseRequest = new Request(
      'https://rivolo.app/api/google-drive/mcp-enable',
    )
    const providerCookie = await createTokenCookieHeader(
      baseRequest,
      googleCookieConfig(env),
      'google-refresh',
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'google-access',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              permissionId: 'google-authoritative',
              emailAddress: 'google@example.com',
              displayName: 'Google User',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'drive-file-1',
            name: 'inbox.md',
            mimeType: 'text/markdown',
            parents: ['drive-folder-1'],
            capabilities: {
              canDownload: true,
              canEdit: true,
              canModifyContent: true,
            },
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const response = await invoke(
      enableGoogleDrive,
      mutationRequest(
        '/api/google-drive/mcp-enable',
        {
          timeZone: 'Europe/Rome',
          target: { fileId: 'drive-file-1' },
        },
        cookiePair(providerCookie, 'rivolo_gdrive_refresh'),
      ),
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      enabled: true,
      profile: {
        provider: 'google-drive',
        providerAccountId: 'google-authoritative',
        providerEmail: 'google@example.com',
        target: {
          fileId: 'drive-file-1',
          folderId: 'drive-folder-1',
          fileName: 'inbox.md',
        },
      },
    })
  })
})

describe('MCP status and disable endpoints', () => {
  it('returns non-secret metadata and destroys the stored credential on disable', async () => {
    const db = new SqliteD1()
    const env = createEnv(db)
    const repository = new ProviderProfileRepository(
      env.MCP_DB,
      env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY,
    )
    const profile = await repository.createOrUpdate({
      provider: 'dropbox',
      providerAccountId: 'dbid:account',
      target: { path: '/inbox.md' },
      timeZone: 'Europe/Rome',
      refreshToken: 'stored-refresh-token',
    })
    const sessionHeader = await createMcpProfileSessionCookie(
      new Request('https://rivolo.app/api/dropbox/mcp-enable'),
      env,
      profile.profileId,
    )
    const sessionCookie = cookiePair(sessionHeader, 'rivolo_mcp_profile')

    const status = await invoke(
      getAgentAccessStatus,
      new Request('https://rivolo.app/api/mcp/status', {
        headers: { Cookie: sessionCookie },
      }),
      env,
    )
    const statusPayload = await status.json()
    expect(status.status).toBe(200)
    expect(statusPayload).toMatchObject({
      enabled: true,
      profile: {
        profileId: profile.profileId,
        provider: 'dropbox',
        target: { path: '/inbox.md' },
      },
    })
    expect(JSON.stringify(statusPayload)).not.toContain('stored-refresh-token')

    const disabled = await invoke(
      disableAgentAccess,
      mutationRequest('/api/mcp/disable', undefined, sessionCookie),
      env,
    )
    expect(disabled.status).toBe(200)
    expect(await repository.decryptCredential(profile.profileId)).toBeNull()
    expect(disabled.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })

  it('rejects disable without a profile session', async () => {
    const response = await invoke(
      disableAgentAccess,
      mutationRequest('/api/mcp/disable'),
      createEnv(new SqliteD1()),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'AUTH_REQUIRED' })
  })
})

afterEach(closeTestDatabases)

describe('OneDrive MCP enable endpoint', () => {
  const folder = '/drives/drive-1/items/notebook-1'
  const oneDriveEnv = (db: SqliteD1) => ({
    ...createEnv(db),
    ONEDRIVE_CLIENT_ID: 'onedrive-client',
    ONEDRIVE_CLIENT_SECRET: 'onedrive-client-secret',
    ONEDRIVE_TOKEN_ENCRYPTION_KEY: 'onedrive-cookie-secret',
    ONEDRIVE_ALLOWED_ORIGINS: 'https://rivolo.app',
  })
  const routeMicrosoft = (item: object) => vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === 'https://login.microsoftonline.com/common/oauth2/v2.0/token') {
      return Response.json({ access_token: 'graph-access', expires_in: 3600, refresh_token: 'rotated-refresh' })
    }
    if (url.startsWith('https://graph.microsoft.com/v1.0/me?')) {
      return Response.json({ id: 'ms-user-1', displayName: 'Ada', mail: null, userPrincipalName: 'ada@example.com' })
    }
    if (url.startsWith(`https://graph.microsoft.com/v1.0${folder}?`)) return Response.json(item)
    return new Response(null, { status: 404 })
  })
  const enable = async (env: ReturnType<typeof oneDriveEnv>, target: unknown) => {
    const providerCookie = await createTokenCookieHeader(
      new Request('https://rivolo.app/api/onedrive/mcp-enable'),
      oneDriveCookieConfig(env),
      'browser-refresh',
    )
    return invoke(
      enableOneDrive,
      mutationRequest(
        '/api/onedrive/mcp-enable',
        { timeZone: 'Europe/Rome', target },
        cookiePair(providerCookie, 'rivolo_onedrive_refresh'),
      ),
      env,
    )
  }
  const storedBrowserToken = async (response: Response, env: ReturnType<typeof oneDriveEnv>) => {
    const cookie = cookiePair(response.headers.get('Set-Cookie') ?? '', 'rivolo_onedrive_refresh')
    return decryptToken(decodeURIComponent(cookie.split('=')[1]), env.ONEDRIVE_TOKEN_ENCRYPTION_KEY)
  }

  it('binds a daily profile to the verified folder and keeps the rotated token on both sides', async () => {
    const db = new SqliteD1()
    const env = oneDriveEnv(db)
    vi.stubGlobal('fetch', routeMicrosoft({
      id: 'notebook-1', name: 'Rivolo', folder: { childCount: 2 }, parentReference: { driveId: 'drive-1' },
    }))

    const response = await enable(env, { folder })
    const payload = await response.json() as { profile: { profileId: string } }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      enabled: true,
      profile: {
        provider: 'onedrive',
        providerAccountId: 'ms-user-1',
        providerEmail: 'ada@example.com',
        providerName: 'Ada',
        dailyFolderId: folder,
        target: { folder, folderName: 'Rivolo' },
      },
    })
    expect(await new ProviderProfileRepository(env.MCP_DB, env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY)
      .decryptCredential(payload.profile.profileId)).toBe('rotated-refresh')
    expect(await storedBrowserToken(response, env)).toBe('rotated-refresh')
    expect(response.headers.get('Set-Cookie')).toContain('rivolo_mcp_profile=')
  })

  it('refuses a folder whose Graph address is not the one the app sent, without losing the rotated token', async () => {
    const db = new SqliteD1()
    const env = oneDriveEnv(db)
    // A shortcut or alias resolves to an item in another drive.
    vi.stubGlobal('fetch', routeMicrosoft({
      id: 'notebook-1', name: 'Rivolo', folder: {}, parentReference: { driveId: 'other-drive' },
    }))

    const response = await enable(env, { folder })

    expect(response.status).toBe(409)
    expect(db.get('SELECT COUNT(*) AS count FROM mcp_provider_profiles')?.count).toBe(0)
    expect(await storedBrowserToken(response, env)).toBe('rotated-refresh')
  })

  it('rejects a path or link instead of a Graph item address before contacting Microsoft', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await enable(oneDriveEnv(new SqliteD1()), { folder: '/Rivolo' })

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
