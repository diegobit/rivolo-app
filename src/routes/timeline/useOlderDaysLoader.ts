import { useCallback, useEffect } from 'react'
import { debugLog, startDebugTimer } from '../../lib/debugLogs'
import { useDaysStore } from '../../store/useDaysStore'

const LOG_SCOPE = 'TimelinePerf'

type LoadOlderDaysSource = 'observer' | 'button'

type UseOlderDaysLoaderParams = {
  loadOlderDays: () => Promise<void>
  isTimelineVisible: boolean
  supportsIntersectionObserver: boolean
  hasMorePast: boolean
  loading: boolean
  loadingMore: boolean
  olderDaysSentinelRef: React.MutableRefObject<HTMLDivElement | null>
  olderDaysObserverMargin: string
}

export const useOlderDaysLoader = ({
  loadOlderDays,
  isTimelineVisible,
  supportsIntersectionObserver,
  hasMorePast,
  loading,
  loadingMore,
  olderDaysSentinelRef,
  olderDaysObserverMargin,
}: UseOlderDaysLoaderParams) => {
  const handleLoadOlderDays = useCallback(
    (source: LoadOlderDaysSource) => {
      const before = useDaysStore.getState()
      const loadMoreTimer = startDebugTimer(LOG_SCOPE, 'olderDays:trigger', {
        source,
        loadedCountBefore: before.days.length,
        hasMorePastBefore: before.hasMorePast,
      })

      void loadOlderDays().then(() => {
        const after = useDaysStore.getState()
        loadMoreTimer.end('olderDays:done', {
          source,
          loadedCountAfter: after.days.length,
          hasMorePastAfter: after.hasMorePast,
          loadingMoreAfter: after.loadingMore,
        })
      })
    },
    [loadOlderDays],
  )

  useEffect(() => {
    if (!isTimelineVisible) return
    if (!supportsIntersectionObserver || !hasMorePast) return

    const sentinelNode = olderDaysSentinelRef.current
    if (!sentinelNode) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        if (loading || loadingMore) return

        const state = useDaysStore.getState()

        debugLog(LOG_SCOPE, 'olderDays:observerIntersection', {
          loadedCount: state.days.length,
          loading,
          loadingMore,
          hasMorePast,
        })

        handleLoadOlderDays('observer')
      },
      {
        root: null,
        rootMargin: olderDaysObserverMargin,
        threshold: 0,
      },
    )

    observer.observe(sentinelNode)
    return () => {
      observer.disconnect()
    }
  }, [
    handleLoadOlderDays,
    hasMorePast,
    isTimelineVisible,
    loading,
    loadingMore,
    olderDaysObserverMargin,
    olderDaysSentinelRef,
    supportsIntersectionObserver,
  ])

  return {
    handleLoadOlderDays,
  }
}
