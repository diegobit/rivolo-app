import { useCallback, useEffect, useRef } from 'react'
import {
  flushDatabaseSave,
  getCommittedDayDraftGeneration,
  getPendingDayDraft,
  invalidatePendingDayDraft,
  registerPendingDayDraft,
} from '../../lib/db'
import { commitDayDraftInDatabase } from '../../lib/dayRepository'
import { flushAutoPushToSync } from '../../store/syncActions'

type UseDaySaveQueueOptions = {
  canSync: boolean
  updateDayContent: (dayId: string, content: string, generation?: number) => Promise<boolean | void>
  onAutoPush: () => Promise<void> | void
  // Called once a day's content is written to the database.
  onDaySaved?: (dayId: string) => void
}

export const useDaySaveQueue = ({ canSync, updateDayContent, onAutoPush, onDaySaved }: UseDaySaveQueueOptions) => {
  const onDaySavedRef = useRef(onDaySaved)
  useEffect(() => {
    onDaySavedRef.current = onDaySaved
  }, [onDaySaved])
  const saveTimeouts = useRef(new Map<string, number>())
  const pendingSaveContentRef = useRef(new Map<string, { content: string; generation: number }>())
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
      invalidatePendingDayDraft(dayId)
    },
    [getDaySaveToken],
  )

  const clearDaySaveToken = useCallback((dayId: string) => {
    daySaveTokensRef.current.delete(dayId)
  }, [])

  const setPendingSaveContent = useCallback((dayId: string, content: string) => {
    const generation = registerPendingDayDraft(dayId, content, commitDayDraftInDatabase)
    pendingSaveContentRef.current.set(dayId, { content, generation })
  }, [])

  const discardPendingDaySave = useCallback((dayId: string) => {
    pendingSaveContentRef.current.delete(dayId)
    invalidatePendingDayDraft(dayId)
  }, [])

  const enqueueDaySave = useCallback(
    (dayId: string, content: string, generation: number) => {
      const queue = daySaveQueueRef.current
      const saveToken = getDaySaveToken(dayId)
      const previous = queue.get(dayId) ?? Promise.resolve()

      const queuedRun = previous
        .catch(() => undefined)
        .then(async () => {
          if (getDaySaveToken(dayId) !== saveToken) {
            return
          }

          const saved = await updateDayContent(dayId, content, generation)
          if (saved === false) return
          if (getDaySaveToken(dayId) !== saveToken) {
            return
          }

          const committedGeneration = getCommittedDayDraftGeneration(dayId)
          const pending = pendingSaveContentRef.current.get(dayId)
          if (pending && pending.generation <= committedGeneration) {
            pendingSaveContentRef.current.delete(dayId)
          }

          onDaySavedRef.current?.(dayId)
          await onAutoPush()
        })
        .catch((error: unknown) => {
          console.error('[Timeline] saveDay:failed', { dayId, error })
          throw error
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
      const generation = registerPendingDayDraft(dayId, content, commitDayDraftInDatabase)
      pendingSaveContentRef.current.set(dayId, { content, generation })
      const existing = saveTimeouts.current.get(dayId)
      if (existing) {
        window.clearTimeout(existing)
      }
      const handle = window.setTimeout(() => {
        saveTimeouts.current.delete(dayId)
        const pendingDraft = pendingSaveContentRef.current.get(dayId) ?? { content, generation }
        void enqueueDaySave(dayId, pendingDraft.content, pendingDraft.generation).catch(() => undefined)
      }, 1000)
      saveTimeouts.current.set(dayId, handle)
    },
    [enqueueDaySave],
  )

  const flushPendingDaySave = useCallback(
    (dayId: string) => {
      const pendingDraft = pendingSaveContentRef.current.get(dayId)
      if (!pendingDraft) {
        if (getPendingDayDraft(dayId)) return flushDatabaseSave()
        return daySaveQueueRef.current.get(dayId) ?? Promise.resolve()
      }

      clearPendingSaveTimeout(dayId)
      return enqueueDaySave(dayId, pendingDraft.content, pendingDraft.generation)
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
      const generation = registerPendingDayDraft(dayId, content, commitDayDraftInDatabase)
      pendingSaveContentRef.current.set(dayId, { content, generation })
      return enqueueDaySave(dayId, content, generation)
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

    const handleWindowBlur = () => {
      flushTimelineSaves()
    }

    window.addEventListener('blur', handleWindowBlur)

    return () => {
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
