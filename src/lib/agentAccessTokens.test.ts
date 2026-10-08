import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAgentAccessToken,
  listAgentAccessTokens,
  revokeAgentAccessToken,
  type AgentAccessToken,
} from './agentAccessTokens'

const metadata: AgentAccessToken = {
  tokenId: '00000000-0000-4000-8000-000000000011',
  name: 'Claude',
  prefix: 'rvl_example1',
  scopes: ['notes:read', 'notes:write'],
  createdAt: '2026-07-16T10:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Agent access token API', () => {
  it('lists metadata with credentials and without caching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tokens: [metadata] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAgentAccessTokens()).resolves.toEqual([metadata])
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/mcp/tokens', {
      cache: 'no-store',
      credentials: 'include',
      signal: undefined,
    })
  })

  it('creates a named token with the CSRF header', async () => {
    const created = { ...metadata, token: 'rvl_one_time_secret' }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: created }), { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(createAgentAccessToken('Claude')).resolves.toEqual(created)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/mcp/tokens', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XmlHttpRequest',
      },
      body: JSON.stringify({ name: 'Claude' }),
    })
  })

  it('revokes the profile token with credentials and the CSRF header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await revokeAgentAccessToken(metadata.tokenId)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `/api/mcp/tokens/${metadata.tokenId}`,
      {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-Requested-With': 'XmlHttpRequest' },
      },
    )
  })

  it('surfaces sanitized server errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Access token was not found.' }), {
          status: 404,
        }),
      ),
    )

    await expect(revokeAgentAccessToken(metadata.tokenId)).rejects.toThrow(
      'Access token was not found.',
    )
  })
})
