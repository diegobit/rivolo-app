import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { DaySearchResult } from '../../lib/dayRepository'

const DELETE_UNDO_WINDOW_MS = 6_000

type FinalizeDeleteOptions = {
  skipDateErrorCleanup?: boolean
  skipSearchResultsCleanup?: boolean
}

type UsePendingDayDeleteOptions = {
  clearDateError: (dayId: string) => void
  createdDayIdsRef: MutableRefObject<Set<string>>
  deleteDay: (dayId: string) => Promise<void>
  discardPendingDaySave: (dayId: string) => void
  flushPendingDaySave: (dayId: string) => Promise<void>
  markDaySavesStale: (dayId: string) => void
  onAutoPush: () => Promise<void> | void
  setSearchResults: Dispatch<SetStateAction<DaySearchResult[]>>
}

export const usePendingDayDelete = ({
  clearDateError,
  createdDayIdsRef,
  deleteDay,
  discardPendingDaySave,
  flushPendingDaySave,
  markDaySavesStale,
  onAutoPush,
  setSearchResults,
}: UsePendingDayDeleteOptions) => {
  const [pendingDeleteDayId, setPendingDeleteDayId] = useState<string | null>(null)
  const [committingDeleteDayIds, setCommittingDeleteDayIds] = useState<string[]>([])
  const pendingDeleteTimerRef = useRef<number | null>(null)
  const pendingDeleteDayIdRef = useRef<string | null>(null)
  const committingDeleteDayIdsRef = useRef(new Set<string>())
  const flushPendingDaySaveRef = useRef(flushPendingDaySave)
  const finalizeDeleteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const finalizeDeleteOnUnmountRef = useRef<(dayId: string) => Promise<void>>(async () => {})
  const isMountedRef = useRef(true)

  const hiddenDeleteDayIds = useMemo(() => {
    const next = new Set(committingDeleteDayIds)
    if (pendingDeleteDayId) {
      next.add(pendingDeleteDayId)
    }
    return next
  }, [committingDeleteDayIds, pendingDeleteDayId])

  const clearPendingDeleteTimer = useCallback(() => {
    if (pendingDeleteTimerRef.current !== null) {
      window.clearTimeout(pendingDeleteTimerRef.current)
      pendingDeleteTimerRef.current = null
    }
  }, [])

  const addCommittingDeleteDay = useCallback((dayId: string) => {
    if (committingDeleteDayIdsRef.current.has(dayId)) {
      return
    }

    committingDeleteDayIdsRef.current.add(dayId)
    if (isMountedRef.current) {
      setCommittingDeleteDayIds((state) => (state.includes(dayId) ? state : [...state, dayId]))
    }
  }, [])

  const removeCommittingDeleteDay = useCallback((dayId: string) => {
    if (!committingDeleteDayIdsRef.current.has(dayId)) {
      return
    }

    committingDeleteDayIdsRef.current.delete(dayId)
    if (isMountedRef.current) {
      setCommittingDeleteDayIds((state) => state.filter((value) => value !== dayId))
    }
  }, [])

  useEffect(() => {
    flushPendingDaySaveRef.current = flushPendingDaySave
  }, [flushPendingDaySave])

  const finalizeDeleteDayNow = useCallback(
    async (dayId: string, options?: FinalizeDeleteOptions) => {
      await flushPendingDaySaveRef.current(dayId)
      markDaySavesStale(dayId)
      discardPendingDaySave(dayId)
      createdDayIdsRef.current.delete(dayId)

      if (!options?.skipDateErrorCleanup && isMountedRef.current) {
        clearDateError(dayId)
      }

      if (!options?.skipSearchResultsCleanup && isMountedRef.current) {
        setSearchResults((state) => state.filter((result) => result.day.dayId !== dayId))
      }
      await deleteDay(dayId)
      void onAutoPush()
    },
    [
      clearDateError,
      createdDayIdsRef,
      deleteDay,
      discardPendingDaySave,
      markDaySavesStale,
      onAutoPush,
      setSearchResults,
    ],
  )

  const enqueueDeleteFinalization = useCallback(
    (dayId: string) => {
      if (committingDeleteDayIdsRef.current.has(dayId)) {
        return finalizeDeleteQueueRef.current
      }

      addCommittingDeleteDay(dayId)

      const run = async () => {
        try {
          await finalizeDeleteDayNow(dayId)
        } finally {
          removeCommittingDeleteDay(dayId)
        }
      }

      const queuedRun = finalizeDeleteQueueRef.current.then(run, run)
      finalizeDeleteQueueRef.current = queuedRun.then(
        () => undefined,
        () => undefined,
      )

      return queuedRun
    },
    [addCommittingDeleteDay, finalizeDeleteDayNow, removeCommittingDeleteDay],
  )

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    finalizeDeleteOnUnmountRef.current = (dayId: string) =>
      finalizeDeleteDayNow(dayId, { skipDateErrorCleanup: true, skipSearchResultsCleanup: true })
  }, [finalizeDeleteDayNow])

  useEffect(() => {
    return () => {
      if (pendingDeleteTimerRef.current !== null) {
        window.clearTimeout(pendingDeleteTimerRef.current)
        pendingDeleteTimerRef.current = null
      }

      const pendingDayId = pendingDeleteDayIdRef.current
      pendingDeleteDayIdRef.current = null
      if (pendingDayId) {
        void finalizeDeleteOnUnmountRef.current(pendingDayId)
      }
    }
  }, [])

  const finalizePendingDelete = useCallback(
    (dayId: string) => {
      if (pendingDeleteDayIdRef.current !== dayId) {
        return
      }

      clearPendingDeleteTimer()
      pendingDeleteDayIdRef.current = null
      setPendingDeleteDayId((current) => (current === dayId ? null : current))
      void enqueueDeleteFinalization(dayId)
    },
    [clearPendingDeleteTimer, enqueueDeleteFinalization],
  )

  const handleUndoDelete = useCallback(() => {
    clearPendingDeleteTimer()
    pendingDeleteDayIdRef.current = null
    setPendingDeleteDayId(null)
  }, [clearPendingDeleteTimer])

  const prepareDayForCreate = useCallback(
    async (dayId: string) => {
      if (pendingDeleteDayIdRef.current === dayId) {
        handleUndoDelete()
      }

      if (committingDeleteDayIdsRef.current.has(dayId)) {
        await finalizeDeleteQueueRef.current
      }
    },
    [handleUndoDelete],
  )

  const handleDeleteDay = useCallback(
    (dayId: string) => {
      const currentPendingDayId = pendingDeleteDayIdRef.current
      if (currentPendingDayId && currentPendingDayId !== dayId) {
        finalizePendingDelete(currentPendingDayId)
      }

      if (pendingDeleteDayIdRef.current === dayId || committingDeleteDayIdsRef.current.has(dayId)) {
        return
      }

      clearPendingDeleteTimer()
      pendingDeleteDayIdRef.current = dayId
      setPendingDeleteDayId(dayId)

      pendingDeleteTimerRef.current = window.setTimeout(() => {
        if (pendingDeleteDayIdRef.current !== dayId) {
          return
        }
        finalizePendingDelete(dayId)
      }, DELETE_UNDO_WINDOW_MS)
    },
    [clearPendingDeleteTimer, finalizePendingDelete],
  )

  return {
    finalizeDeleteDayNow,
    handleDeleteDay,
    handleUndoDelete,
    hiddenDeleteDayIds,
    pendingDeleteDayId,
    prepareDayForCreate,
  }
}
