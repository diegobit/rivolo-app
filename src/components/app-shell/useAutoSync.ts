import { useCallback, useEffect, useRef } from 'react'
import { getTabSyncBlockReason } from '../../lib/tabSyncCoordinator'
import { getActiveProviderStatus, type SyncProviderId } from '../../lib/sync'
import { getPendingEditorDayIds } from '../../lib/pendingEditorSaves'
import {
  pullFromSyncAndRefresh,
  pushToSyncAndRefresh,
  recordBlockedPush,
  recordSyncAttention,
} from '../../store/syncActions'

type AutoSyncStatus = {
  connected: boolean
  targetName: string | null
  localDirty: boolean
  lastRemoteVersion?: string | null
  notebookChannel?: string | null
  daily?: boolean
}

const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 1000
const FOREGROUND_BACKGROUND_MIN_MS = 15 * 1000

type AutoSyncReason = 'start' | 'reconnect' | 'foreground' | 'interval' | 'queued' | 'draft-wait'

export const useAutoSync = (status: AutoSyncStatus, provider: SyncProviderId | null = null) => {
  const statusRef = useRef({ ...status, provider })
  const retryAt = useRef(0)
  const failures = useRef(0)
  const pendingDays = useRef(new Set<string>())
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const reconcileRef = useRef<((reason: AutoSyncReason) => Promise<void>) | null>(null)
  const mounted = useRef(true)
  const scheduleRetry = useCallback((delay: number, reason: AutoSyncReason = 'queued') => {
    if (!mounted.current) return
    clearTimeout(retryTimer.current)
    retryTimer.current = setTimeout(() => { void reconcileRef.current?.(reason) }, delay)
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(retryTimer.current) }
  }, [])
  const lastAutoSyncAt = useRef(0)
  const autoSyncInFlight = useRef(false)
  const autoSyncRequestedWhileRunning = useRef(false)
  const backgroundedAt = useRef<number | null>(null)

  useEffect(() => {
    statusRef.current = { ...status, provider }
  }, [status, provider])

  useEffect(() => {
    retryAt.current = 0
    failures.current = 0
    clearTimeout(retryTimer.current)
  }, [provider, status.targetName, status.connected])

  const reconcileOnce = useCallback(
    async (reason: AutoSyncReason) => {
      const currentStatus = statusRef.current
      if (!mounted.current || !navigator.onLine) return
      if (!currentStatus.connected || !currentStatus.targetName) return
      if (getTabSyncBlockReason()) return

      const now = Date.now()
      const daily = Boolean(currentStatus.daily)
      if (daily && document.visibilityState !== 'visible') return
      if (daily && now < retryAt.current) { scheduleRetry(retryAt.current - now); return }
      // While a draft is still unsaved, the timer only checks locally whether
      // typing has paused. It checks the cloud again once the draft is saved.
      if (daily && reason === 'draft-wait' && getPendingEditorDayIds().size) { scheduleRetry(1000, 'draft-wait'); return }
      if (reason === 'interval' && now - lastAutoSyncAt.current < AUTO_SYNC_INTERVAL_MS) {
        return
      }

      lastAutoSyncAt.current = now
      const failed = () => {
        if (daily) {
          failures.current += 1
          retryAt.current = Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(failures.current, 4))
          scheduleRetry(retryAt.current - Date.now())
        }
      }
      const succeeded = () => { failures.current = 0; retryAt.current = 0; clearTimeout(retryTimer.current) }

      let localDirty = currentStatus.localDirty
      if (daily) {
        try { localDirty = (await getActiveProviderStatus()).localDirty }
        catch (error) {
          failed()
          recordSyncAttention('pull', error instanceof Error ? error.message : 'Unable to read sync state.')
          return
        }
      }
      if (!mounted.current) return
      if (localDirty) {
        console.info('[Sync] auto-push:trigger', { reason })
        try {
          const result = await pushToSyncAndRefresh(false)
          succeeded()
          if (result.status === 'blocked') {
            recordBlockedPush(result.reason)
          }
        } catch (error: unknown) {
          failed()
          recordSyncAttention(
            'push',
            error instanceof Error ? error.message : 'Automatic push failed.',
          )
        }
        if (!daily || retryAt.current > Date.now()) return
      }

      console.info('[Sync] auto-pull:trigger', { reason })
      try {
        const dayIds = reason === 'queued' || reason === 'draft-wait' ? [...pendingDays.current] : []
        // Claim the deferred days before the request: one deferred while it
        // runs stays queued for the next pass instead of being cleared here.
        for (const id of dayIds) pendingDays.current.delete(id)
        let result
        try { result = await pullFromSyncAndRefresh({ force: false, ...(daily && dayIds.length ? { dayIds } : {}) }) }
        catch (error) {
          for (const id of dayIds) pendingDays.current.add(id)
          throw error
        }
        succeeded()
        if (daily && (result.deferredDayIds?.length || getPendingEditorDayIds().size)) {
          for (const id of result.deferredDayIds ?? []) pendingDays.current.add(id)
          scheduleRetry(1000, 'draft-wait')
        }
      } catch (error: unknown) {
        failed()
        recordSyncAttention(
          'pull',
          error instanceof Error ? error.message : 'Automatic pull failed.',
        )
      }
    },
    [scheduleRetry],
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

  useEffect(() => { reconcileRef.current = maybeAutoSync }, [maybeAutoSync])

  useEffect(() => {
    console.info('[Sync] auto-sync:event', { reason: 'start' })
    void maybeAutoSync('start')
  }, [maybeAutoSync, status.connected, status.targetName, provider])

  useEffect(() => {
    if (!status.connected || !status.targetName) return

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      console.info('[Sync] auto-sync:event', { reason: 'interval' })
      void maybeAutoSync('interval')
    }, AUTO_SYNC_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [maybeAutoSync, status.connected, status.targetName, provider])

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
        (!statusRef.current.daily && Date.now() - startedAt < FOREGROUND_BACKGROUND_MIN_MS)
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
