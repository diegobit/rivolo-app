import { useCallback, useEffect, useRef } from 'react'
import { pullFromSyncAndRefresh } from '../../store/syncActions'

type AutoPullStatus = {
  connected: boolean
  filePath: string | null
  localDirty: boolean
}

export const useAutoPullSync = (status: AutoPullStatus) => {
  const lastAutoPullAt = useRef(0)
  const autoPullInFlight = useRef(false)

  const maybeAutoPull = useCallback(
    (reason: 'start' | 'reconnect' | 'visibility') => {
      if (!navigator.onLine) return
      if (!status.connected || !status.filePath) return
      if (status.localDirty) return
      if (autoPullInFlight.current) return

      const now = Date.now()
      if (now - lastAutoPullAt.current < 2 * 60 * 1000) return

      autoPullInFlight.current = true
      lastAutoPullAt.current = now
      console.info('[Sync] auto-pull:trigger', { reason })
      void pullFromSyncAndRefresh({ allowDirty: false })
        .catch(() => {
          // Auto-pull failures are handled by manual sync.
        })
        .finally(() => {
          autoPullInFlight.current = false
        })
    },
    [status.connected, status.filePath, status.localDirty],
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
