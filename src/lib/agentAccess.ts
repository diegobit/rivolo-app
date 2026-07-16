export const RIVOLO_MCP_ENDPOINT = 'https://mcp.rivolo.app/mcp'

type AgentAccessProfileBase = {
  profileId: string
  providerAccountId: string
  providerEmail: string | null
  providerName: string | null
  timeZone: string
  createdAt: string
  updatedAt: string
  revokedAt: string | null
}

export type AgentAccessProfile = AgentAccessProfileBase &
  (
    | {
        provider: 'dropbox'
        target: { path: string }
      }
    | {
        provider: 'google-drive'
        target: {
          fileId: string
          folderId: string | null
          fileName: string
        }
      }
  )

export type AgentAccessStatus =
  | { enabled: false }
  | { enabled: true; profile: AgentAccessProfile }

export type AgentAccessViewState =
  | { state: 'loading'; profile: null; message: null }
  | { state: 'disabled'; profile: null; message: string | null }
  | { state: 'enabled'; profile: AgentAccessProfile; message: string | null }
  | { state: 'error'; profile: null; message: string }

export type AgentAccessEnableTarget =
  | { provider: 'dropbox'; path: string }
  | { provider: 'google-drive'; fileId: string }

type AgentAccessErrorPayload = {
  message?: unknown
}

const readResponse = async <T>(response: Response): Promise<T> => {
  const payload = (await response.json().catch(() => null)) as AgentAccessErrorPayload | null
  if (!response.ok) {
    throw new Error(
      typeof payload?.message === 'string' ? payload.message : 'Agent access request failed.',
    )
  }
  return payload as T
}

export const getAgentAccessStatus = async (): Promise<AgentAccessStatus> => {
  const response = await fetch('/api/mcp/status', {
    cache: 'no-store',
    credentials: 'include',
  })
  return readResponse<AgentAccessStatus>(response)
}

export const enableAgentAccess = async (
  target: AgentAccessEnableTarget,
  timeZone: string,
): Promise<Extract<AgentAccessStatus, { enabled: true }>> => {
  const body =
    target.provider === 'dropbox'
      ? { timeZone, target: { path: target.path } }
      : { timeZone, target: { fileId: target.fileId } }
  const response = await fetch(`/api/${target.provider}/mcp-enable`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XmlHttpRequest',
    },
    body: JSON.stringify(body),
  })
  return readResponse<Extract<AgentAccessStatus, { enabled: true }>>(response)
}

export const disableAgentAccess = async (): Promise<{ enabled: false }> => {
  const response = await fetch('/api/mcp/disable', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XmlHttpRequest' },
  })
  return readResponse<{ enabled: false }>(response)
}

export const agentAccessTargetLabel = (profile: AgentAccessProfile) =>
  profile.provider === 'dropbox' ? profile.target.path : profile.target.fileName
