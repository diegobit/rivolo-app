import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentAccessToken } from '../../lib/agentAccessTokens'
import { useAgentAccessTokens } from './useAgentAccessTokens'

const tokenApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}))

vi.mock('../../lib/agentAccessTokens', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/agentAccessTokens')>()
  return {
    ...original,
    listAgentAccessTokens: tokenApi.list,
    createAgentAccessToken: tokenApi.create,
    revokeAgentAccessToken: tokenApi.revoke,
  }
})

const metadata = (
  tokenId: string,
  name: string,
  revokedAt: string | null = null,
): AgentAccessToken => ({
  tokenId,
  name,
  prefix: `rvl_${tokenId.slice(-8)}`,
  scopes: ['notes:read', 'notes:write'],
  createdAt: '2026-07-16T10:00:00.000Z',
  lastUsedAt: null,
  revokedAt,
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useAgentAccessTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the newly created secret separate from list metadata and clears it on dismissal', async () => {
    const listed = metadata('00000000-0000-4000-8000-000000000011', 'Codex')
    tokenApi.list.mockResolvedValueOnce([])
    tokenApi.create.mockResolvedValueOnce({
      ...listed,
      token: 'rvl_one_time_secret',
    })

    const { result } = renderHook(() =>
      useAgentAccessTokens('00000000-0000-4000-8000-000000000001', true),
    )
    await waitFor(() => expect(result.current.view.state).toBe('ready'))

    await act(async () => {
      await result.current.create('Codex')
    })

    expect(result.current.createdToken).toBe('rvl_one_time_secret')
    expect(result.current.view.tokens).toEqual([listed])
    expect(JSON.stringify(result.current.view.tokens)).not.toContain('rvl_one_time_secret')

    act(() => result.current.dismissCreatedToken())
    expect(result.current.createdToken).toBeNull()
    expect(JSON.stringify(result.current)).not.toContain('rvl_one_time_secret')
  })

  it('discards stale token results and one-time secrets when the active profile changes', async () => {
    const profileA = '00000000-0000-4000-8000-000000000001'
    const profileB = '00000000-0000-4000-8000-000000000002'
    const requestA = deferred<AgentAccessToken[]>()
    const requestB = deferred<AgentAccessToken[]>()
    const tokenA = metadata('00000000-0000-4000-8000-000000000011', 'Profile A')
    const tokenB = metadata('00000000-0000-4000-8000-000000000022', 'Profile B')
    tokenApi.list.mockReturnValueOnce(requestA.promise).mockReturnValueOnce(requestB.promise)

    const { result, rerender } = renderHook(
      ({ profileId }) => useAgentAccessTokens(profileId, true),
      { initialProps: { profileId: profileA } },
    )

    rerender({ profileId: profileB })
    await act(async () => requestB.resolve([tokenB]))
    await waitFor(() => expect(result.current.view.tokens).toEqual([tokenB]))

    await act(async () => requestA.resolve([tokenA]))
    expect(result.current.view.tokens).toEqual([tokenB])
    expect(result.current.createdToken).toBeNull()
  })

  it('clears a stale in-flight action when the active profile changes', async () => {
    const profileA = '00000000-0000-4000-8000-000000000001'
    const profileB = '00000000-0000-4000-8000-000000000002'
    const pendingCreate = deferred<{
      token: string
    } & AgentAccessToken>()
    tokenApi.list.mockResolvedValue([])
    tokenApi.create.mockReturnValueOnce(pendingCreate.promise)

    const { result, rerender } = renderHook(
      ({ profileId }) => useAgentAccessTokens(profileId, true),
      { initialProps: { profileId: profileA } },
    )
    await waitFor(() => expect(result.current.view.state).toBe('ready'))

    let createPromise!: Promise<boolean>
    act(() => {
      createPromise = result.current.create('Profile A')
    })
    expect(result.current.busy).toBe(true)

    rerender({ profileId: profileB })
    await waitFor(() => {
      expect(result.current.view.state).toBe('ready')
      expect(result.current.busy).toBe(false)
    })

    await act(async () => {
      pendingCreate.resolve({
        ...metadata('00000000-0000-4000-8000-000000000011', 'Profile A'),
        token: 'rvl_stale_profile_secret',
      })
      await createPromise
    })
    expect(result.current.createdToken).toBeNull()
    expect(JSON.stringify(result.current)).not.toContain('rvl_stale_profile_secret')
  })

  it('revokes a token and reloads authoritative metadata', async () => {
    const active = metadata('00000000-0000-4000-8000-000000000011', 'Claude')
    const revoked = {
      ...active,
      revokedAt: '2026-07-16T11:00:00.000Z',
    }
    tokenApi.list.mockResolvedValueOnce([active]).mockResolvedValueOnce([revoked])
    tokenApi.revoke.mockResolvedValueOnce(undefined)

    const { result } = renderHook(() =>
      useAgentAccessTokens('00000000-0000-4000-8000-000000000001', true),
    )
    await waitFor(() => expect(result.current.view.tokens).toEqual([active]))

    await act(async () => {
      await result.current.revoke(active.tokenId)
    })

    expect(tokenApi.revoke).toHaveBeenCalledExactlyOnceWith(active.tokenId)
    expect(result.current.view.tokens).toEqual([revoked])
  })
})
