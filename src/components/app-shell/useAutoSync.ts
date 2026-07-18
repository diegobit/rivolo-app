import { useCallback, useEffect, useRef } from 'react'
import { getTabSyncBlockReason } from '../../lib/tabSyncCoordinator'
import {
  blockedPushMessage,
  pullFromSyncAndRefresh,
  pushToSyncAndRefresh,
  recordSyncAttention,
} from '../../store/syncActions'

type AutoSyncStatus = {
  connected: boolean
  targetName: string | null
  localDirty: boolean
}

const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 1000
const FOREGROUND_BACKGROUND_MIN_MS = 15 * 1000

type AutoSyncReason = 'start' | 'reconnect' | 'foreground' | 'interval' | 'queued'

export const useAutoSync = (status: AutoSyncStatus) => {
  const statusRef = useRef(status)
  const lastAutoSyncAt = useRef(0)
  const autoSyncInFlight = useRef(false)
  const autoSyncRequestedWhileRunning = useRef(false)
  const backgroundedAt = useRef<number | null>(null)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const reconcileOnce = useCallback(
    async (reason: AutoSyncReason) => {
      const currentStatus = statusRef.current
      if (!navigator.onLine) return
      if (!currentStatus.connected || !currentStatus.targetName) return
      if (getTabSyncBlockReason()) return

      const now = Date.now()
      if (reason === 'interval' && now - lastAutoSyncAt.current < AUTO_SYNC_INTERVAL_MS) {
        return
      }

      lastAutoSyncAt.current = now

      if (currentStatus.localDirty) {
        console.info('[Sync] auto-push:trigger', { reason })
        try {
          const result = await pushToSyncAndRefresh(false)
          if (result.status === 'blocked') {
            recordSyncAttention('push', blockedPushMessage(result.reason))
          }
        } catch (error: unknown) {
          recordSyncAttention(
            'push',
            error instanceof Error ? error.message : 'Automatic push failed.',
          )
        }
        return
      }

      console.info('[Sync] auto-pull:trigger', { reason })
      try {
        await pullFromSyncAndRefresh({ force: false })
      } catch (error: unknown) {
        recordSyncAttention(
          'pull',
          error instanceof Error ? error.message : 'Automatic pull failed.',
        )
      }
    },
    [],
  )

  const maybeAutoSync = useCallback(
    async (reason: AutoSyncReason) => {
      if (autoSyncInFlight.current) {
        autoSyncRequestedWhileRunning.current = true
        return
      }

      autoSyncInFlight.current = true
      try {
        let nextReason = reason
        do {
          autoSyncRequestedWhileRunning.current = false
          await reconcileOnce(nextReason)
          nextReason = 'queued'
        } while (autoSyncRequestedWhileRunning.current)
      } finally {
        autoSyncInFlight.current = false
      }
    },
    [reconcileOnce],
  )

  useEffect(() => {
    console.info('[Sync] auto-sync:event', { reason: 'start' })
    void maybeAutoSync('start')
  }, [maybeAutoSync, status.connected, status.targetName])

  useEffect(() => {
    if (!status.connected || !status.targetName) return

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      console.info('[Sync] auto-sync:event', { reason: 'interval' })
      void maybeAutoSync('interval')
    }, AUTO_SYNC_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [maybeAutoSync, status.connected, status.targetName])

  useEffect(() => {
    const handleOnline = () => {
      console.info('[Sync] auto-sync:event', { reason: 'reconnect' })
      void maybeAutoSync('reconnect')
    }
    const handleBackground = () => {
      if (backgroundedAt.current === null) {
        backgroundedAt.current = Date.now()
      }
    }
    const handleForeground = () => {
      if (document.visibilityState !== 'visible') return

      const startedAt = backgroundedAt.current
      backgroundedAt.current = null
      if (
        startedAt === null ||
        Date.now() - startedAt < FOREGROUND_BACKGROUND_MIN_MS
      ) {
        return
      }

      console.info('[Sync] auto-sync:event', { reason: 'foreground' })
      void maybeAutoSync('foreground')
    }
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') {
        handleBackground()
        return
      }
      handleForeground()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('blur', handleBackground)
    window.addEventListener('focus', handleForeground)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('blur', handleBackground)
      window.removeEventListener('focus', handleForeground)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [maybeAutoSync])
}
