import { useCallback, useEffect, useState } from 'react'
import {
  disableAgentAccess as disableAgentAccessRequest,
  enableAgentAccess as enableAgentAccessRequest,
  getAgentAccessStatus,
  type AgentAccessEnableTarget,
  type AgentAccessViewState,
} from '../../lib/agentAccess'

export type AgentAccessSafetyResult =
  | 'completed'
  | 'cancelled'
  | 'status-unknown'
  | 'disable-failed'

export const agentAccessDisableWarning = (actionDescription: string) =>
  `${actionDescription}. Existing agent access tokens will be revoked and must be recreated; connected agents must reconnect. Continue?`

export const runConfirmedAgentAccessDisable = async ({
  confirmDisable,
  disable,
}: {
  confirmDisable: (message: string) => boolean
  disable: () => Promise<boolean>
}) => {
  if (!confirmDisable(agentAccessDisableWarning('Disabling Agent access'))) return false
  return disable()
}

export const runWithAgentAccessSafety = async ({
  statusKnown,
  enabled,
  confirmDisable,
  disable,
  action,
}: {
  statusKnown: boolean
  enabled: boolean
  confirmDisable: () => boolean
  disable: () => Promise<boolean>
  action: () => Promise<void>
}): Promise<AgentAccessSafetyResult> => {
  if (!statusKnown) return 'status-unknown'
  if (enabled) {
    if (!confirmDisable()) return 'cancelled'
    if (!(await disable())) return 'disable-failed'
  }
  await action()
  return 'completed'
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

export const useAgentAccess = (online: boolean) => {
  const [view, setView] = useState<AgentAccessViewState>({
    state: 'loading',
    profile: null,
    message: null,
  })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!online) {
      setView((current) =>
        current.state === 'enabled' || current.state === 'disabled'
          ? { ...current, message: 'Go online to refresh Agent access.' }
          : {
              state: 'error',
              profile: null,
              message: 'Go online to check Agent access.',
            },
      )
      return
    }
    setView({ state: 'loading', profile: null, message: null })
    try {
      const status = await getAgentAccessStatus()
      setView(
        status.enabled
          ? { state: 'enabled', profile: status.profile, message: null }
          : { state: 'disabled', profile: null, message: null },
      )
    } catch (error) {
      setView({
        state: 'error',
        profile: null,
        message: errorMessage(error, 'Agent access status could not be loaded.'),
      })
    }
  }, [online])

  useEffect(() => {
    void load()
  }, [load])

  const enable = async (target: AgentAccessEnableTarget) => {
    if (!online) {
      setView({
        state: 'error',
        profile: null,
        message: 'Go online to enable Agent access.',
      })
      return false
    }
    setBusy(true)
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const status = await enableAgentAccessRequest(target, timeZone)
      setView({
        state: 'enabled',
        profile: status.profile,
        message: 'Agent access enabled.',
      })
      return true
    } catch (error) {
      setView({
        state: 'error',
        profile: null,
        message: errorMessage(error, 'Agent access could not be enabled.'),
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    if (view.state === 'disabled') return true
    if (!online) {
      setView((current) =>
        current.state === 'enabled'
          ? { ...current, message: 'Go online to disable Agent access.' }
          : {
              state: 'error',
              profile: null,
              message: 'Go online to disable Agent access.',
            },
      )
      return false
    }
    setBusy(true)
    try {
      await disableAgentAccessRequest()
      setView({
        state: 'disabled',
        profile: null,
        message: 'Agent access disabled.',
      })
      return true
    } catch (error) {
      const message = errorMessage(error, 'Agent access could not be disabled.')
      setView((current) =>
        current.state === 'enabled'
          ? { ...current, message }
          : { state: 'error', profile: null, message },
      )
      return false
    } finally {
      setBusy(false)
    }
  }

  return {
    view,
    busy,
    load,
    enable,
    disable,
    statusKnown: view.state === 'disabled' || view.state === 'enabled',
    enabled: view.state === 'enabled',
  }
}
