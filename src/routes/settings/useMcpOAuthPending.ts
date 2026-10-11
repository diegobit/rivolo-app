import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  getMcpOAuthPending,
  mcpOAuthCancelUrl,
  mcpOAuthResumeUrl,
  type McpOAuthPendingStatus,
} from '../../lib/mcpOAuthPendingClient'

export type McpOAuthPendingView =
  | { state: 'loading' }
  | { state: 'hidden' }
  | { state: 'restart' }
  | { state: 'error'; message: string }
  | {
      state: 'pending'
      clientLabel: string
      transactionId: string
      expiresAt: number
      ready: boolean
      replaced: boolean
      message: string | null
    }

const assignLocation = (url: string) => {
  window.location.assign(url)
}

export const useMcpOAuthPending = (
  online: boolean,
  options: { assign?: (url: string) => void } = {},
) => {
  const location = useLocation()
  const flagged = new URLSearchParams(location.search).get('mcp_oauth') === '1'
  const assign = options.assign ?? assignLocation
  const [view, setView] = useState<McpOAuthPendingView>({ state: 'loading' })
  const seenTransactionId = useRef<string | null>(null)
  const navigated = useRef(false)
  const expiredRefresh = useRef<string | null>(null)

  const applyStatus = useCallback(
    (status: McpOAuthPendingStatus, message: string | null = null) => {
      if (!status.pending) {
        seenTransactionId.current = null
        setView(flagged ? { state: 'restart' } : { state: 'hidden' })
        return status
      }
      const replaced =
        seenTransactionId.current !== null &&
        seenTransactionId.current !== status.transactionId
      seenTransactionId.current = status.transactionId
      setView({
        state: 'pending',
        clientLabel: status.clientLabel,
        transactionId: status.transactionId,
        expiresAt: status.expiresAt,
        ready: status.ready,
        replaced,
        message,
      })
      return status
    },
    [flagged],
  )

  const load = useCallback(async () => {
    if (!online) {
      setView((current) =>
        current.state === 'pending'
          ? { ...current, message: 'Go online to continue this connection.' }
          : flagged
            ? {
                state: 'error',
                message: 'Go online to continue this connection.',
              }
            : { state: 'hidden' },
      )
      return null
    }
    try {
      return applyStatus(await getMcpOAuthPending())
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'The ChatGPT connection could not be checked.'
      setView((current) => {
        if (current.state === 'pending') return { ...current, message }
        if (flagged) return { state: 'error', message }
        return { state: 'hidden' }
      })
      return null
    }
  }, [applyStatus, flagged, online])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (view.state !== 'pending') return
    const delay = view.expiresAt * 1000 - Date.now()
    if (delay <= 0 && expiredRefresh.current === view.transactionId) return
    if (delay <= 0) expiredRefresh.current = view.transactionId
    const timer = window.setTimeout(() => {
      void load()
    }, Math.max(0, delay))
    return () => window.clearTimeout(timer)
  }, [load, view])

  const continueAfterEnable = useCallback(async () => {
    const status = await load()
    if (navigated.current || !status || !status.pending || !status.ready) return false
    navigated.current = true
    assign(mcpOAuthResumeUrl(status.transactionId))
    return true
  }, [assign, load])

  const continueNow = useCallback(() => {
    if (view.state !== 'pending' || !view.ready || navigated.current) return
    navigated.current = true
    assign(mcpOAuthResumeUrl(view.transactionId))
  }, [assign, view])

  const cancel = useCallback(() => {
    if (view.state !== 'pending') return
    assign(mcpOAuthCancelUrl(view.transactionId))
  }, [assign, view])

  return {
    view,
    flagged,
    load,
    continueAfterEnable,
    continueNow,
    cancel,
  }
}
