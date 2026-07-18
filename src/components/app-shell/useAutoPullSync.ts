import { useCallback, useEffect, useRef } from 'react'
import { getTabSyncBlockReason } from '../../lib/tabSyncCoordinator'
import {
  blockedPushMessage,
  detectRemoteChangeWhileDirty,
  pullFromSyncAndRefresh,
  pushToSyncAndRefresh,
  recordSyncAttention,
} from '../../store/syncActions'

type AutoPullStatus = {
  connected: boolean
  targetName: string | null
  localDirty: boolean
}

const DIRTY_REMOTE_CHECK_INTERVAL_MS = 2 * 60 * 1000
const CLEAN_PULL_INTERVAL_MS = 3 * 60 * 1000
const FOREGROUND_BACKGROUND_MIN_MS = 15 * 1000

export const useAutoPullSync = (status: AutoPullStatus) => {
  const statusRef = useRef(status)
  const lastAutoSyncAt = useRef(0)
  const autoSyncInFlight = useRef(false)
  const backgroundedAt = useRef<number | null>(null)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const maybeAutoSync = useCallback(
    (reason: 'start' | 'reconnect' | 'foreground' | 'interval') => {
      const currentStatus = statusRef.current
      if (!navigator.onLine) return
      if (!currentStatus.connected || !currentStatus.targetName) return
      if (getTabSyncBlockReason()) return
      if (autoSyncInFlight.current) return

      const now = Date.now()
      const intervalMs = currentStatus.localDirty
        ? DIRTY_REMOTE_CHECK_INTERVAL_MS
        : CLEAN_PULL_INTERVAL_MS
      if (reason === 'interval' && now - lastAutoSyncAt.current < intervalMs) {
        return
      }

      autoSyncInFlight.current = true
      lastAutoSyncAt.current = now

      if (currentStatus.localDirty && reason === 'interval') {
        // Never auto-pull while dirty (it would overwrite unsynced edits), but
        // still detect a remote that advanced so the device isn't silently
        // diverged — surfaces the existing sync-attention / Push-Pull recovery.
        console.info('[Sync] auto-pull:detect-while-dirty', { reason })
        void detectRemoteChangeWhileDirty()
          .catch((error: unknown) => {
            recordSyncAttention(
              'pull',
              error instanceof Error ? error.message : 'Remote change check failed.',
            )
          })
          .finally(() => {
            autoSyncInFlight.current = false
          })
        return
      }

      if (currentStatus.localDirty) {
        console.info('[Sync] auto-push:trigger', { reason })
        void pushToSyncAndRefresh(false)
          .then((result) => {
            if (result.status === 'blocked') {
              recordSyncAttention('push', blockedPushMessage(result.reason))
            }
          })
          .catch((error: unknown) => {
            recordSyncAttention(
              'push',
              error instanceof Error ? error.message : 'Automatic push failed.',
            )
          })
          .finally(() => {
            autoSyncInFlight.current = false
          })
        return
      }

      console.info('[Sync] auto-pull:trigger', { reason })
      void pullFromSyncAndRefresh({ force: false })
        .catch((error: unknown) => {
          recordSyncAttention(
            'pull',
            error instanceof Error ? error.message : 'Automatic pull failed.',
          )
        })
        .finally(() => {
          autoSyncInFlight.current = false
        })
    },
    [],
  )

  useEffect(() => {
    console.info('[Sync] auto-sync:event', { reason: 'start' })
    maybeAutoSync('start')
  }, [maybeAutoSync, status.connected, status.targetName])

  useEffect(() => {
    if (!status.connected || !status.targetName) return

    const intervalMs = status.localDirty
      ? DIRTY_REMOTE_CHECK_INTERVAL_MS
      : CLEAN_PULL_INTERVAL_MS

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      console.info('[Sync] auto-sync:event', { reason: 'interval' })
      maybeAutoSync('interval')
    }, intervalMs)

    return () => window.clearInterval(intervalId)
  }, [maybeAutoSync, status.connected, status.targetName, status.localDirty])

  useEffect(() => {
    const handleOnline = () => {
      console.info('[Sync] auto-sync:event', { reason: 'reconnect' })
      maybeAutoSync('reconnect')
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
      maybeAutoSync('foreground')
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
