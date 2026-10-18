import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  enableAgentAccess,
  type AgentAccessProfile,
} from './agentAccess'

const profile: AgentAccessProfile = {
  profileId: '00000000-0000-4000-8000-000000000001',
  provider: 'dropbox',
  providerAccountId: 'dbid:one',
  providerEmail: 'person@example.com',
  providerName: 'Person',
  target: { path: '/inbox.md' },
  timeZone: 'Europe/Rome',
  createdAt: '2026-07-16T10:00:00.000Z',
  updatedAt: '2026-07-16T10:00:00.000Z',
  revokedAt: null,
}

describe('Agent access API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('enables Google Drive with the authoritative file ID and timezone', async () => {
    const googleProfile: AgentAccessProfile = {
      ...profile,
      provider: 'google-drive',
      target: {
        fileId: 'drive-file-1',
        folderId: 'drive-folder-1',
        fileName: 'inbox.md',
      },
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ enabled: true, profile: googleProfile }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await enableAgentAccess(
      { provider: 'google-drive', fileId: 'drive-file-1' },
      'America/New_York',
    )

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/google-drive/mcp-enable', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XmlHttpRequest',
      },
      body: JSON.stringify({
        timeZone: 'America/New_York',
        target: { fileId: 'drive-file-1' },
      }),
    })
  })

  it('surfaces the server error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Connect Dropbox to sync.' }), { status: 401 }),
      ),
    )

    await expect(
      enableAgentAccess({ provider: 'dropbox', path: '/inbox.md' }, 'Europe/Rome'),
    ).rejects.toThrow('Connect Dropbox to sync.')
  })
})
