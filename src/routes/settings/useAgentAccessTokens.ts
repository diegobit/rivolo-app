import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createAgentAccessToken,
  listAgentAccessTokens,
  revokeAgentAccessToken,
  type AgentAccessToken,
} from '../../lib/agentAccessTokens'

export type AgentAccessTokensView =
  | { state: 'idle'; tokens: AgentAccessToken[]; message: null }
  | { state: 'loading'; tokens: AgentAccessToken[]; message: null }
  | { state: 'ready'; tokens: AgentAccessToken[]; message: null }
  | { state: 'error'; tokens: AgentAccessToken[]; message: string }

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError'

export const useAgentAccessTokens = (profileId: string | null, online: boolean) => {
  const [view, setView] = useState<AgentAccessTokensView>({
    state: 'idle',
    tokens: [],
    message: null,
  })
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const profileIdRef = useRef(profileId)
  profileIdRef.current = profileId

  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setCreatedToken(null)
    setActionError(null)
    if (!profileId) {
      setView({ state: 'idle', tokens: [], message: null })
      return
    }
    if (!online) {
      setView({
        state: 'error',
        tokens: [],
        message: 'Go online to load access tokens.',
      })
      return
    }

    setView((current) => ({ state: 'loading', tokens: current.tokens, message: null }))
    try {
      const tokens = await listAgentAccessTokens()
      if (requestVersion.current !== version || profileIdRef.current !== profileId) return
      setView({ state: 'ready', tokens, message: null })
    } catch (error) {
      if (isAbortError(error) || requestVersion.current !== version) return
      setView({
        state: 'error',
        tokens: [],
        message: errorMessage(error, 'Access tokens could not be loaded.'),
      })
    }
  }, [online, profileId])

  useEffect(() => {
    let disposed = false
    const version = ++requestVersion.current
    setBusy(false)
    setCreatedToken(null)
    setActionError(null)

    if (!profileId) {
      setView({ state: 'idle', tokens: [], message: null })
      return
    }
    if (!online) {
      setView({
        state: 'error',
        tokens: [],
        message: 'Go online to load access tokens.',
      })
      return
    }

    const controller = new AbortController()
    setView({ state: 'loading', tokens: [], message: null })
    void listAgentAccessTokens(controller.signal)
      .then((tokens) => {
        if (
          disposed ||
          requestVersion.current !== version ||
          profileIdRef.current !== profileId
        ) {
          return
        }
        setView({ state: 'ready', tokens, message: null })
      })
      .catch((error) => {
        if (disposed || isAbortError(error) || requestVersion.current !== version) return
        setView({
          state: 'error',
          tokens: [],
          message: errorMessage(error, 'Access tokens could not be loaded.'),
        })
      })

    return () => {
      disposed = true
      controller.abort()
    }
  }, [online, profileId])

  const create = async (name: string) => {
    const activeProfileId = profileId
    if (!activeProfileId || !online) return false
    setBusy(true)
    setActionError(null)
    try {
      const { token, ...metadata } = await createAgentAccessToken(name)
      if (profileIdRef.current !== activeProfileId) return false
      setCreatedToken(token)
      setView((current) => ({
        state: 'ready',
        tokens: [metadata, ...current.tokens.filter((item) => item.tokenId !== metadata.tokenId)],
        message: null,
      }))
      return true
    } catch (error) {
      if (profileIdRef.current !== activeProfileId) return false
      setActionError(errorMessage(error, 'Access token could not be created.'))
      return false
    } finally {
      if (profileIdRef.current === activeProfileId) setBusy(false)
    }
  }

  const revoke = async (tokenId: string) => {
    const activeProfileId = profileId
    if (!activeProfileId || !online) return false
    setBusy(true)
    setActionError(null)
    try {
      await revokeAgentAccessToken(tokenId)
      if (profileIdRef.current !== activeProfileId) return false
      const tokens = await listAgentAccessTokens()
      if (profileIdRef.current !== activeProfileId) return false
      setView({ state: 'ready', tokens, message: null })
      return true
    } catch (error) {
      if (profileIdRef.current !== activeProfileId) return false
      setActionError(errorMessage(error, 'Access token could not be revoked.'))
      return false
    } finally {
      if (profileIdRef.current === activeProfileId) setBusy(false)
    }
  }

  return {
    view,
    busy,
    actionError,
    createdToken,
    load,
    create,
    revoke,
    dismissCreatedToken: () => setCreatedToken(null),
  }
}
