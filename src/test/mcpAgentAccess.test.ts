// @vitest-environment node
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
import { onRequestPost as disableAgentAccess } from '../../functions/api/mcp/disable'
import { onRequestGet as getAgentAccessStatus } from '../../functions/api/mcp/status'

type StoredRow = {
  profile_id: string
  provider: 'dropbox' | 'google-drive'
  provider_account_id: string
  provider_email: string | null
  provider_name: string | null
  dropbox_path: string | null
  google_file_id: string | null
  google_folder_id: string | null
  google_file_name: string | null
  time_zone: string
  encrypted_refresh_token: string
  created_at: string
  updated_at: string
  revoked_at: string | null
}

class FakeD1 {
  readonly rows = new Map<string, StoredRow>()

  prepare(sql: string) {
    return {
      bind: (...values: unknown[]) => ({
        first: async <T>() => this.first(sql, values) as T | null,
        run: async () => this.run(sql, values),
      }),
    }
  }

  private first(sql: string, values: unknown[]) {
    if (sql.includes('INSERT INTO mcp_provider_profiles')) {
      const [
        profileId,
        provider,
        providerAccountId,
        providerEmail,
        providerName,
        dropboxPath,
        googleFileId,
        googleFolderId,
        googleFileName,
        timeZone,
        encryptedRefreshToken,
        createdAt,
        updatedAt,
      ] = values as [
        string,
        StoredRow['provider'],
        string,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string,
        string,
        string,
        string,
      ]
      const existing = [...this.rows.values()].find(
        (row) =>
          row.provider === provider &&
          row.provider_account_id === providerAccountId,
      )
      const row: StoredRow = existing
        ? {
            ...existing,
            provider_email: providerEmail,
            provider_name: providerName,
            dropbox_path: dropboxPath,
            google_file_id: googleFileId,
            google_folder_id: googleFolderId,
            google_file_name: googleFileName,
            time_zone: timeZone,
            encrypted_refresh_token: encryptedRefreshToken,
            updated_at: updatedAt,
            revoked_at: null,
          }
        : {
            profile_id: profileId,
            provider,
            provider_account_id: providerAccountId,
            provider_email: providerEmail,
            provider_name: providerName,
            dropbox_path: dropboxPath,
            google_file_id: googleFileId,
            google_folder_id: googleFolderId,
            google_file_name: googleFileName,
            time_zone: timeZone,
            encrypted_refresh_token: encryptedRefreshToken,
            created_at: createdAt,
            updated_at: updatedAt,
            revoked_at: null,
          }
      this.rows.set(row.profile_id, row)
      return row
    }

    const row = this.rows.get(String(values[0]))
    if (!row) return null
    if (sql.includes('SELECT encrypted_refresh_token')) {
      return row.revoked_at
        ? null
        : { encrypted_refresh_token: row.encrypted_refresh_token }
    }
    return row
  }

  private async run(sql: string, values: unknown[]) {
    if (!sql.includes('UPDATE mcp_provider_profiles')) {
      throw new Error(`Unexpected query: ${sql}`)
    }
    const [updatedAt, revokedAt, profileId] = values as [string, string, string]
    const row = this.rows.get(profileId)
    if (!row || row.revoked_at) return { meta: { changes: 0 } }
    this.rows.set(profileId, {
      ...row,
      encrypted_refresh_token: '',
      updated_at: updatedAt,
      revoked_at: revokedAt,
    })
    return { meta: { changes: 1 } }
  }
}

type TestEnv = McpAgentAccessEnv & {
  DROPBOX_CLIENT_ID: string
  DROPBOX_TOKEN_ENCRYPTION_KEY: string
  DROPBOX_ALLOWED_ORIGINS: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GOOGLE_TOKEN_ENCRYPTION_KEY: string
  GOOGLE_ALLOWED_ORIGINS: string
}

const createEnv = (db: FakeD1): TestEnv => ({
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
    const env = createEnv(new FakeD1())
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

  it('keeps existing provider refresh cookies SameSite=Strict', async () => {
    const env = createEnv(new FakeD1())
    const request = new Request('https://rivolo.app/api/dropbox/token')

    const dropboxHeader = await createTokenCookieHeader(
      request,
      dropboxCookieConfig(env),
      'dropbox-refresh',
    )
    const googleHeader = await createTokenCookieHeader(
      request,
      googleCookieConfig(env),
      'google-refresh',
    )

    expect(dropboxHeader).toContain('SameSite=Strict')
    expect(googleHeader).toContain('SameSite=Strict')
    expect(dropboxHeader).not.toContain('SameSite=Lax')
    expect(googleHeader).not.toContain('SameSite=Lax')
  })

  it('rejects malformed enable input before contacting a provider', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const db = new FakeD1()
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
    const db = new FakeD1()
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
    expect([...db.rows.values()][0]?.encrypted_refresh_token).not.toContain(
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
      createEnv(new FakeD1()),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enables Google Drive from authoritative account, file, and capability data', async () => {
    const db = new FakeD1()
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
    const db = new FakeD1()
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
      createEnv(new FakeD1()),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'AUTH_REQUIRED' })
  })
})
