import { afterEach, describe, expect, it, vi } from 'vitest'
import { revokeAgentAccessToken } from './agentAccessTokens'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Agent access token API', () => {
  it('surfaces sanitized server errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Access token was not found.' }), {
          status: 404,
        }),
      ),
    )

    await expect(revokeAgentAccessToken('00000000-0000-4000-8000-000000000011')).rejects.toThrow(
      'Access token was not found.',
    )
  })
})
