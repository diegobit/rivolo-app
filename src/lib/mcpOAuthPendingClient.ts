export type McpOAuthPendingStatus =
  | { pending: false }
  | {
      pending: true
      clientLabel: string
      transactionId: string
      expiresAt: number
      ready: boolean
    }

const isPendingStatus = (value: unknown): value is McpOAuthPendingStatus => {
  if (!value || typeof value !== 'object') return false
  const status = value as McpOAuthPendingStatus
  if (status.pending === false) return true
  return (
    status.pending === true &&
    typeof status.clientLabel === 'string' &&
    typeof status.transactionId === 'string' &&
    typeof status.expiresAt === 'number' &&
    typeof status.ready === 'boolean'
  )
}

export const getMcpOAuthPending = async (): Promise<McpOAuthPendingStatus> => {
  const response = await fetch('/api/mcp/oauth/pending', {
    cache: 'no-store',
    credentials: 'include',
  })
  const payload = (await response.json().catch(() => null)) as unknown
  if (!response.ok || !isPendingStatus(payload)) {
    throw new Error('The ChatGPT connection could not be checked.')
  }
  if (!payload.pending) return { pending: false }
  return {
    pending: true,
    clientLabel: payload.clientLabel,
    transactionId: payload.transactionId,
    expiresAt: payload.expiresAt,
    ready: payload.ready,
  }
}

export const mcpOAuthResumeUrl = (transactionId: string) =>
  `/api/mcp/oauth/authorize?resume=${encodeURIComponent(transactionId)}`

export const mcpOAuthCancelUrl = (transactionId: string) =>
  `${mcpOAuthResumeUrl(transactionId)}&cancel=1`
