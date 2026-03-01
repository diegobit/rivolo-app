import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { debugLog, getNowMs, startDebugTimer, toElapsedMs } from '../../lib/debugLogs'
import type { Day } from '../../lib/dayRepository'

const LOG_SCOPE = 'TimelinePerf'

type FocusPosition = 'start' | 'end'

type PendingFocus = {
  dayId: string
  position: FocusPosition
}

export type EditorPinReason = 'interaction' | 'citation' | 'loadDay' | 'dateMove' | 'edit'

type UseEditorMountWindowParams = {
  days: Day[]
  isSearchMode: boolean
  isTimelineVisible: boolean
  supportsIntersectionObserver: boolean
  initialEditorMountCount: number
  editorHydrateObserverMargin: string
  editorPinTtlMs: number
  editorPinPruneIntervalMs: number
  editorRefs: React.MutableRefObject<Map<string, EditorView>>
  dayRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  pendingFocusRef: React.MutableRefObject<PendingFocus | null>
  focusDayEditor: (dayId: string, position: FocusPosition, shouldScroll?: boolean) => boolean
}

const areStringSetsEqual = (a: Set<string>, b: Set<string>) => {
  if (a.size !== b.size) return false

  for (const value of a) {
    if (!b.has(value)) {
      return false
    }
  }

  return true
}

export const useEditorMountWindow = ({
  days,
  isSearchMode,
  isTimelineVisible,
  supportsIntersectionObserver,
  initialEditorMountCount,
  editorHydrateObserverMargin,
  editorPinTtlMs,
  editorPinPruneIntervalMs,
  editorRefs,
  dayRefs,
  pendingFocusRef,
  focusDayEditor,
}: UseEditorMountWindowParams) => {
  const [mountedDayIds, setMountedDayIds] = useState<Set<string>>(() => new Set())
  const mountedDayIdsRef = useRef(new Set<string>())
  const nearViewportDayIdsRef = useRef(new Set<string>())
  const pinnedDayExpiryRef = useRef(new Map<string, number>())
  const dayOrderRef = useRef<string[]>([])
  const maxMountedCountRef = useRef(0)
  const hydrationRequestedAtRef = useRef(new Map<string, number>())
  const dayHydrationObserverRef = useRef<IntersectionObserver | null>(null)

  const applyMountedDayIds = useCallback((next: Set<string>, reason: string) => {
    const previous = mountedDayIdsRef.current
    if (areStringSetsEqual(previous, next)) {
      return
    }

    let addedCount = 0
    let removedCount = 0
    for (const dayId of next) {
      if (!previous.has(dayId)) {
        addedCount += 1
      }
    }
    for (const dayId of previous) {
      if (!next.has(dayId)) {
        removedCount += 1
      }
    }

    mountedDayIdsRef.current = next
    setMountedDayIds(next)
    maxMountedCountRef.current = Math.max(maxMountedCountRef.current, next.size)

    debugLog(LOG_SCOPE, 'editorMountWindow:update', {
      reason,
      mountedCount: next.size,
      addedCount,
      removedCount,
      nearViewportCount: nearViewportDayIdsRef.current.size,
      pinnedCount: pinnedDayExpiryRef.current.size,
      maxMountedCount: maxMountedCountRef.current,
    })
  }, [])

  const recomputeMountedEditors = useCallback(
    (reason: string) => {
      const dayOrder = dayOrderRef.current
      if (!dayOrder.length) {
        applyMountedDayIds(new Set(), reason)
        return
      }

      if (isSearchMode) {
        applyMountedDayIds(new Set(dayOrder), reason)
        return
      }

      const dayOrderSet = new Set(dayOrder)
      const now = getNowMs()
      for (const [dayId, expiresAt] of pinnedDayExpiryRef.current) {
        if (expiresAt > now) continue
        pinnedDayExpiryRef.current.delete(dayId)
      }

      const next = new Set<string>()

      if (!supportsIntersectionObserver) {
        for (const dayId of dayOrder) {
          next.add(dayId)
        }
        applyMountedDayIds(next, reason)
        return
      }

      for (let index = 0; index < Math.min(initialEditorMountCount, dayOrder.length); index += 1) {
        next.add(dayOrder[index])
      }

      for (const dayId of nearViewportDayIdsRef.current) {
        if (dayOrderSet.has(dayId)) {
          next.add(dayId)
        }
      }

      for (const dayId of pinnedDayExpiryRef.current.keys()) {
        if (dayOrderSet.has(dayId)) {
          next.add(dayId)
        }
      }

      const pendingDayId = pendingFocusRef.current?.dayId
      if (pendingDayId && dayOrderSet.has(pendingDayId)) {
        next.add(pendingDayId)
      }

      for (const [dayId, view] of editorRefs.current) {
        if (!view.hasFocus) continue
        if (dayOrderSet.has(dayId)) {
          next.add(dayId)
        }
      }

      applyMountedDayIds(next, reason)
    },
    [
      applyMountedDayIds,
      editorRefs,
      initialEditorMountCount,
      isSearchMode,
      pendingFocusRef,
      supportsIntersectionObserver,
    ],
  )

  const pinDayForEditorMount = useCallback(
    (dayId: string, reason: EditorPinReason, recompute = true) => {
      const now = getNowMs()
      const nextExpiry = now + editorPinTtlMs
      const currentExpiry = pinnedDayExpiryRef.current.get(dayId) ?? 0
      pinnedDayExpiryRef.current.set(dayId, nextExpiry)

      if (nextExpiry - currentExpiry > 500) {
        debugLog(LOG_SCOPE, 'editorMountWindow:pin', {
          dayId,
          reason,
          ttlMs: editorPinTtlMs,
        })
      }

      if (recompute) {
        recomputeMountedEditors(`pin:${reason}`)
      }
    },
    [editorPinTtlMs, recomputeMountedEditors],
  )

  const requestDayEditorMount = useCallback(
    (dayId: string, position: FocusPosition) => {
      const hydrateTimer = startDebugTimer(LOG_SCOPE, 'editorHydrate:request', {
        dayId,
        position,
      })

      hydrationRequestedAtRef.current.set(dayId, getNowMs())
      const wasMounted = mountedDayIdsRef.current.has(dayId)
      pinDayForEditorMount(dayId, 'interaction')
      pendingFocusRef.current = { dayId, position }

      requestAnimationFrame(() => {
        const focusedImmediately = focusDayEditor(dayId, position, false)
        if (focusedImmediately) {
          pendingFocusRef.current = null
        }

        hydrateTimer.end('editorHydrate:request:raf', {
          dayId,
          focusedImmediately,
          wasMounted,
          mountedAfterRequest: mountedDayIdsRef.current.has(dayId),
        })
      })
    },
    [focusDayEditor, pendingFocusRef, pinDayForEditorMount],
  )

  const registerEditor = useCallback(
    (dayId: string, view: EditorView | null) => {
      if (view) {
        editorRefs.current.set(dayId, view)

        const requestedAt = hydrationRequestedAtRef.current.get(dayId)
        if (requestedAt != null) {
          hydrationRequestedAtRef.current.delete(dayId)
          debugLog(LOG_SCOPE, 'editorHydrate:mounted', {
            dayId,
            elapsedMs: toElapsedMs(requestedAt),
          })
        }

        const pending = pendingFocusRef.current
        if (pending && pending.dayId === dayId) {
          focusDayEditor(dayId, pending.position, false)
          pendingFocusRef.current = null
        }

        recomputeMountedEditors('registerEditor')
        return
      }

      editorRefs.current.delete(dayId)
      recomputeMountedEditors('unregisterEditor')
    },
    [editorRefs, focusDayEditor, pendingFocusRef, recomputeMountedEditors],
  )

  const registerDayRef = useCallback(
    (dayId: string, node: HTMLDivElement | null) => {
      const previousNode = dayRefs.current.get(dayId)
      if (previousNode && previousNode !== node) {
        dayHydrationObserverRef.current?.unobserve(previousNode)
      }

      if (node) {
        node.dataset.dayId = dayId
        dayRefs.current.set(dayId, node)
        if (isTimelineVisible) {
          dayHydrationObserverRef.current?.observe(node)
        }
        return
      }

      if (previousNode) {
        dayHydrationObserverRef.current?.unobserve(previousNode)
      }
      dayRefs.current.delete(dayId)
      nearViewportDayIdsRef.current.delete(dayId)
    },
    [dayRefs, isTimelineVisible],
  )

  useEffect(() => {
    if (!supportsIntersectionObserver || !isTimelineVisible) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false
        for (const entry of entries) {
          if (!(entry.target instanceof HTMLElement)) continue
          const dayId = entry.target.dataset.dayId
          if (!dayId) continue

          if (entry.isIntersecting) {
            if (!nearViewportDayIdsRef.current.has(dayId)) {
              nearViewportDayIdsRef.current.add(dayId)
              changed = true
            }
            continue
          }

          if (nearViewportDayIdsRef.current.delete(dayId)) {
            changed = true
          }
        }

        if (changed) {
          recomputeMountedEditors('nearViewportObserver')
        }
      },
      {
        root: null,
        rootMargin: editorHydrateObserverMargin,
        threshold: 0,
      },
    )

    dayHydrationObserverRef.current = observer
    const nearViewportDayIds = nearViewportDayIdsRef.current
    for (const node of dayRefs.current.values()) {
      observer.observe(node)
    }

    return () => {
      observer.disconnect()
      nearViewportDayIds.clear()
      dayHydrationObserverRef.current = null
    }
  }, [dayRefs, editorHydrateObserverMargin, isTimelineVisible, recomputeMountedEditors, supportsIntersectionObserver])

  useEffect(() => {
    if (!isTimelineVisible) return

    const interval = window.setInterval(() => {
      recomputeMountedEditors('pinTtlPrune')
    }, editorPinPruneIntervalMs)

    return () => {
      window.clearInterval(interval)
    }
  }, [editorPinPruneIntervalMs, isTimelineVisible, recomputeMountedEditors])

  useEffect(() => {
    const loadedDayIds = new Set(days.map((day) => day.dayId))
    let changed = false

    for (const dayId of nearViewportDayIdsRef.current) {
      if (loadedDayIds.has(dayId)) continue
      nearViewportDayIdsRef.current.delete(dayId)
      changed = true
    }

    for (const dayId of mountedDayIdsRef.current) {
      if (loadedDayIds.has(dayId)) continue
      mountedDayIdsRef.current.delete(dayId)
      changed = true
    }

    for (const dayId of pinnedDayExpiryRef.current.keys()) {
      if (loadedDayIds.has(dayId)) continue
      pinnedDayExpiryRef.current.delete(dayId)
      changed = true
    }

    for (const dayId of hydrationRequestedAtRef.current.keys()) {
      if (loadedDayIds.has(dayId)) continue
      hydrationRequestedAtRef.current.delete(dayId)
      changed = true
    }

    if (pendingFocusRef.current && !loadedDayIds.has(pendingFocusRef.current.dayId)) {
      pendingFocusRef.current = null
      changed = true
    }

    if (changed) {
      debugLog(LOG_SCOPE, 'editorMountWindow:prune', {
        loadedCount: days.length,
      })
    }

    recomputeMountedEditors(changed ? 'daysPruned' : 'daysChanged')
  }, [days, pendingFocusRef, recomputeMountedEditors])

  const setDayOrder = useCallback(
    (dayOrder: string[]) => {
      dayOrderRef.current = dayOrder
      recomputeMountedEditors('dayOrderChanged')
    },
    [recomputeMountedEditors],
  )

  return {
    mountedDayIds,
    pinDayForEditorMount,
    requestDayEditorMount,
    registerEditor,
    registerDayRef,
    recomputeMountedEditors,
    setDayOrder,
  }
}
