export type AgentAccessToken = {
  tokenId: string
  name: string
  prefix: string
  scopes: ['notes:read', 'notes:write']
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export type CreatedAgentAccessToken = AgentAccessToken & {
  token: string
}

type ErrorPayload = {
  message?: unknown
}

const readResponse = async <T>(response: Response): Promise<T> => {
  const payload = (await response.json().catch(() => null)) as ErrorPayload | null
  if (!response.ok) {
    throw new Error(
      typeof payload?.message === 'string' ? payload.message : 'Access token request failed.',
    )
  }
  return payload as T
}

export const listAgentAccessTokens = async (
  signal?: AbortSignal,
): Promise<AgentAccessToken[]> => {
  const response = await fetch('/api/mcp/tokens', {
    cache: 'no-store',
    credentials: 'include',
    signal,
  })
  const payload = await readResponse<{ tokens: AgentAccessToken[] }>(response)
  return payload.tokens
}

export const createAgentAccessToken = async (
  name: string,
): Promise<CreatedAgentAccessToken> => {
  const response = await fetch('/api/mcp/tokens', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XmlHttpRequest',
    },
    body: JSON.stringify({ name }),
  })
  const payload = await readResponse<{ token: CreatedAgentAccessToken }>(response)
  return payload.token
}

export const revokeAgentAccessToken = async (tokenId: string): Promise<void> => {
  const response = await fetch(`/api/mcp/tokens/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XmlHttpRequest' },
  })
  await readResponse<{ ok: true }>(response)
}
