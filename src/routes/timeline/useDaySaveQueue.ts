import { useCallback, useEffect, useRef } from 'react'
import { flushDatabaseSave } from '../../lib/db'
import { flushAutoPushToSync } from '../../store/syncActions'

type UseDaySaveQueueOptions = {
  canSync: boolean
  updateDayContent: (dayId: string, content: string) => Promise<void>
  onAutoPush: () => Promise<void> | void
}

export const useDaySaveQueue = ({ canSync, updateDayContent, onAutoPush }: UseDaySaveQueueOptions) => {
  const saveTimeouts = useRef(new Map<string, number>())
  const pendingSaveContentRef = useRef(new Map<string, string>())
  const daySaveQueueRef = useRef(new Map<string, Promise<void>>())
  const daySaveTokensRef = useRef(new Map<string, number>())

  const clearPendingSaveTimeout = useCallback((dayId: string) => {
    const existing = saveTimeouts.current.get(dayId)
    if (existing) {
      window.clearTimeout(existing)
      saveTimeouts.current.delete(dayId)
    }
  }, [])

  const getDaySaveToken = useCallback((dayId: string) => daySaveTokensRef.current.get(dayId) ?? 0, [])

  const markDaySavesStale = useCallback(
    (dayId: string) => {
      daySaveTokensRef.current.set(dayId, getDaySaveToken(dayId) + 1)
    },
    [getDaySaveToken],
  )

  const clearDaySaveToken = useCallback((dayId: string) => {
    daySaveTokensRef.current.delete(dayId)
  }, [])

  const setPendingSaveContent = useCallback((dayId: string, content: string) => {
    pendingSaveContentRef.current.set(dayId, content)
  }, [])

  const discardPendingDaySave = useCallback((dayId: string) => {
    pendingSaveContentRef.current.delete(dayId)
  }, [])

  const enqueueDaySave = useCallback(
    (dayId: string, content: string) => {
      const queue = daySaveQueueRef.current
      const saveToken = getDaySaveToken(dayId)
      const previous = queue.get(dayId) ?? Promise.resolve()

      const queuedRun = previous
        .catch(() => undefined)
        .then(async () => {
          if (getDaySaveToken(dayId) !== saveToken) {
            return
          }

          await updateDayContent(dayId, content)
          if (getDaySaveToken(dayId) !== saveToken) {
            return
          }

          await onAutoPush()
        })
        .catch((error: unknown) => {
          console.error('[Timeline] saveDay:failed', { dayId, error })
        })

      const trackedRun = queuedRun.finally(() => {
        if (queue.get(dayId) === trackedRun) {
          queue.delete(dayId)
        }
      })

      queue.set(dayId, trackedRun)
      return trackedRun
    },
    [getDaySaveToken, onAutoPush, updateDayContent],
  )

  const scheduleSave = useCallback(
    (dayId: string, content: string) => {
      pendingSaveContentRef.current.set(dayId, content)
      const existing = saveTimeouts.current.get(dayId)
      if (existing) {
        window.clearTimeout(existing)
      }
      const handle = window.setTimeout(() => {
        saveTimeouts.current.delete(dayId)
        const pendingContent = pendingSaveContentRef.current.get(dayId) ?? content
        pendingSaveContentRef.current.delete(dayId)
        void enqueueDaySave(dayId, pendingContent)
      }, 1000)
      saveTimeouts.current.set(dayId, handle)
    },
    [enqueueDaySave],
  )

  const flushPendingDaySave = useCallback(
    (dayId: string) => {
      const pendingContent = pendingSaveContentRef.current.get(dayId)
      if (pendingContent === undefined) {
        return daySaveQueueRef.current.get(dayId) ?? Promise.resolve()
      }

      clearPendingSaveTimeout(dayId)
      pendingSaveContentRef.current.delete(dayId)
      return enqueueDaySave(dayId, pendingContent)
    },
    [clearPendingSaveTimeout, enqueueDaySave],
  )

  const flushAllPendingDaySaves = useCallback(async () => {
    const pendingDayIds = [...pendingSaveContentRef.current.keys()]
    await Promise.all(pendingDayIds.map((dayId) => flushPendingDaySave(dayId)))
    await Promise.all([...daySaveQueueRef.current.values()])
  }, [flushPendingDaySave])

  const saveDayImmediately = useCallback(
    (dayId: string, content: string) => {
      clearPendingSaveTimeout(dayId)
      pendingSaveContentRef.current.delete(dayId)
      return enqueueDaySave(dayId, content)
    },
    [clearPendingSaveTimeout, enqueueDaySave],
  )

  useEffect(() => {
    const pendingTimeouts = saveTimeouts.current

    const flushTimelineSaves = () => {
      void flushAllPendingDaySaves()
        .then(() => flushDatabaseSave())
        .then(() => {
          if (!canSync || !navigator.onLine) {
            return undefined
          }

          return flushAutoPushToSync()
        })
        .catch((error: unknown) => {
          console.error('[Timeline] flush pending saves failed', { error })
        })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushTimelineSaves()
      }
    }

    const handlePageHide = () => {
      flushTimelineSaves()
    }

    const handleWindowBlur = () => {
      flushTimelineSaves()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('blur', handleWindowBlur)
      flushTimelineSaves()

      for (const handle of pendingTimeouts.values()) {
        window.clearTimeout(handle)
      }
      pendingTimeouts.clear()
    }
  }, [canSync, flushAllPendingDaySaves])

  return {
    clearDaySaveToken,
    discardPendingDaySave,
    flushPendingDaySave,
    markDaySavesStale,
    saveDayImmediately,
    scheduleSave,
    setPendingSaveContent,
  }
}
