import { useCallback, useEffect, useRef } from 'react'
import { getTabSyncBlockReason } from '../../lib/tabSyncCoordinator'
import {
  detectRemoteChangeWhileDirty,
  pullFromSyncAndRefresh,
  recordSyncAttention,
} from '../../store/syncActions'

type AutoPullStatus = {
  connected: boolean
  targetName: string | null
  localDirty: boolean
}

export const useAutoPullSync = (status: AutoPullStatus) => {
  const lastAutoPullAt = useRef(0)
  const autoPullInFlight = useRef(false)

  const maybeAutoPull = useCallback(
    (reason: 'start' | 'reconnect' | 'visibility') => {
      if (!navigator.onLine) return
      if (!status.connected || !status.targetName) return
      if (getTabSyncBlockReason()) return
      if (autoPullInFlight.current) return

      const now = Date.now()
      if (now - lastAutoPullAt.current < 2 * 60 * 1000) return

      autoPullInFlight.current = true
      lastAutoPullAt.current = now

      if (status.localDirty) {
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
            autoPullInFlight.current = false
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
          autoPullInFlight.current = false
        })
    },
    [status.connected, status.targetName, status.localDirty],
  )

  useEffect(() => {
    console.info('[Sync] auto-pull:event', { reason: 'start' })
    maybeAutoPull('start')
  }, [maybeAutoPull])

  useEffect(() => {
    const handleOnline = () => {
      console.info('[Sync] auto-pull:event', { reason: 'reconnect' })
      maybeAutoPull('reconnect')
    }
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      console.info('[Sync] auto-pull:event', { reason: 'visibility' })
      maybeAutoPull('visibility')
    }

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [maybeAutoPull])
}
