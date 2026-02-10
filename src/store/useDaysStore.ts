import { create } from 'zustand'
import {
  appendLineToDay,
  deleteDay,
  ensureDay,
  getDay,
  hasDaysBefore,
  listDaysBefore,
  listDaysSince,
  moveDay,
  saveDay,
} from '../lib/dayRepository'
import { debugLog, startDebugTimer } from '../lib/debugLogs'
import { addDays, getTodayId } from '../lib/dates'
import type { Day } from '../lib/dayRepository'

type DaysState = {
  days: Day[]
  activeDay: Day | null
  loading: boolean
  loadingMore: boolean
  hasMorePast: boolean
  loadTimeline: () => Promise<void>
  loadOlderDays: () => Promise<void>
  loadDay: (dayId: string) => Promise<{ created: boolean }>
  appendToToday: (line: string) => Promise<void>
  updateDayContent: (dayId: string, content: string) => Promise<void>
  moveDayDate: (fromDayId: string, toDayId: string) => Promise<{ conflict: boolean }>
  deleteDay: (dayId: string) => Promise<void>
}

const RECENT_WINDOW_DAYS = 31
const INITIAL_MIN_DAYS = 25
const OLDER_PAGE_SIZE = 15
const LOG_SCOPE = 'DaysStorePerf'

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

const sortDays = (days: Day[]) =>
  [...days].sort((a, b) => b.dayId.localeCompare(a.dayId))

const upsertDayInList = (days: Day[], day: Day) => {
  const existingIndex = days.findIndex((item) => item.dayId === day.dayId)
  if (existingIndex === -1) {
    return sortDays([day, ...days])
  }

  const next = [...days]
  next[existingIndex] = day
  return sortDays(next)
}

const mergeDays = (days: Day[], incoming: Day[]) => {
  if (!incoming.length) {
    return days
  }

  const byId = new Map(days.map((day) => [day.dayId, day]))
  for (const day of incoming) {
    byId.set(day.dayId, day)
  }

  return sortDays([...byId.values()])
}

export const useDaysStore = create<DaysState>((set, get) => ({
  days: [],
  activeDay: null,
  loading: false,
  loadingMore: false,
  hasMorePast: false,

  loadTimeline: async () => {
    const loadTimer = startDebugTimer(LOG_SCOPE, 'loadTimeline', {
      recentWindowDays: RECENT_WINDOW_DAYS,
      initialMinDays: INITIAL_MIN_DAYS,
      olderPageSize: OLDER_PAGE_SIZE,
    })

    set({ loading: true })
    try {
      const todayId = getTodayId()
      const cutoffDayId = addDays(todayId, -RECENT_WINDOW_DAYS)

      const recentTimer = startDebugTimer(LOG_SCOPE, 'loadTimeline:queryRecent', {
        cutoffDayId,
      })
      const recentDays = await listDaysSince(cutoffDayId)
      recentTimer.end(undefined, {
        recentCount: recentDays.length,
      })

      debugLog(LOG_SCOPE, 'loadTimeline:recentWindow', {
        todayId,
        cutoffDayId,
        recentCount: recentDays.length,
      })

      let nextDays = recentDays
      if (nextDays.length < INITIAL_MIN_DAYS) {
        const oldestRecentDayId = nextDays[nextDays.length - 1]?.dayId
        const beforeDayId = oldestRecentDayId ?? addDays(todayId, 1)

        const backfillTimer = startDebugTimer(LOG_SCOPE, 'loadTimeline:queryBackfill', {
          beforeDayId,
          neededCount: INITIAL_MIN_DAYS - nextDays.length,
        })
        const backfillDays = await listDaysBefore(beforeDayId, INITIAL_MIN_DAYS - nextDays.length)
        backfillTimer.end(undefined, {
          fetchedCount: backfillDays.length,
        })

        nextDays = mergeDays(nextDays, backfillDays)

        debugLog(LOG_SCOPE, 'loadTimeline:backfillApplied', {
          beforeDayId,
          backfillCount: backfillDays.length,
          totalAfterBackfill: nextDays.length,
        })
      }

      const oldestLoadedDayId = nextDays[nextDays.length - 1]?.dayId

      const hasMoreTimer = startDebugTimer(LOG_SCOPE, 'loadTimeline:checkHasMore', {
        oldestLoadedDayId,
      })
      const hasMorePast = oldestLoadedDayId ? await hasDaysBefore(oldestLoadedDayId) : false
      hasMoreTimer.end(undefined, {
        hasMorePast,
      })

      set({
        days: nextDays,
        loading: false,
        loadingMore: false,
        hasMorePast,
      })

      loadTimer.end('loadTimeline:done', {
        loadedCount: nextDays.length,
        oldestLoadedDayId,
        hasMorePast,
      })
    } catch (error) {
      console.error('[DaysStore] loadTimeline:failed', { error })
      loadTimer.end('loadTimeline:failed', {
        error: getErrorMessage(error),
      })

      set({ loading: false, loadingMore: false })
    }
  },

  loadOlderDays: async () => {
    const state = get()
    if (state.loading || state.loadingMore || !state.hasMorePast) {
      debugLog(LOG_SCOPE, 'loadOlderDays:skipped', {
        loading: state.loading,
        loadingMore: state.loadingMore,
        hasMorePast: state.hasMorePast,
        loadedCount: state.days.length,
      })
      return
    }

    const oldestLoadedDayId = state.days[state.days.length - 1]?.dayId
    if (!oldestLoadedDayId) {
      debugLog(LOG_SCOPE, 'loadOlderDays:noCursor', {
        loadedCount: state.days.length,
      })

      set({ hasMorePast: false })
      return
    }

    const loadMoreTimer = startDebugTimer(LOG_SCOPE, 'loadOlderDays', {
      oldestLoadedDayId,
      pageSize: OLDER_PAGE_SIZE,
      loadedCountBefore: state.days.length,
    })

    set({ loadingMore: true })
    try {
      const olderDays = await listDaysBefore(oldestLoadedDayId, OLDER_PAGE_SIZE)
      if (!olderDays.length) {
        loadMoreTimer.end('loadOlderDays:done', {
          fetchedCount: 0,
          loadedCountAfter: state.days.length,
          hasMorePast: false,
        })

        set({ loadingMore: false, hasMorePast: false })
        return
      }

      let nextOldestDayId: string | null = null
      set((currentState) => {
        const mergedDays = mergeDays(currentState.days, olderDays)
        nextOldestDayId = mergedDays[mergedDays.length - 1]?.dayId ?? null
        return {
          days: mergedDays,
        }
      })

      const hasMorePast = nextOldestDayId ? await hasDaysBefore(nextOldestDayId) : false
      set({ loadingMore: false, hasMorePast })

      loadMoreTimer.end('loadOlderDays:done', {
        fetchedCount: olderDays.length,
        oldestLoadedDayId: nextOldestDayId,
        loadedCountAfter: get().days.length,
        hasMorePast,
      })
    } catch (error) {
      console.error('[DaysStore] loadOlderDays:failed', { error })
      loadMoreTimer.end('loadOlderDays:failed', {
        error: getErrorMessage(error),
      })

      set({ loadingMore: false })
    }
  },

  loadDay: async (dayId: string) => {
    const loadDayTimer = startDebugTimer(LOG_SCOPE, 'loadDay', { dayId })

    set({ loading: true })
    const existing = await getDay(dayId)
    debugLog(LOG_SCOPE, 'loadDay:fetched', {
      dayId,
      found: Boolean(existing),
      contentLength: existing?.contentMd.length ?? 0,
    })

    const day = existing ?? (await ensureDay(dayId))
    const created = !existing
    debugLog(LOG_SCOPE, 'loadDay:resolved', {
      dayId,
      created,
      contentLength: day?.contentMd.length ?? 0,
    })
    set((state) => ({
      activeDay: day,
      days: upsertDayInList(state.days, day),
      loading: false,
    }))

    loadDayTimer.end('loadDay:done', {
      dayId,
      created,
      loadedCountAfter: get().days.length,
    })

    return { created }
  },

  appendToToday: async (line: string) => {
    const text = line.trim()
    if (!text) return

    const todayId = getTodayId()
    const day = await appendLineToDay(todayId, text)
    if (!day) return

    set((state) => ({
      days: upsertDayInList(state.days, day),
      activeDay: state.activeDay?.dayId === todayId ? day : state.activeDay,
    }))
  },

  updateDayContent: async (dayId: string, content: string) => {
    const day = await saveDay(dayId, content)
    if (!day) return

    set((state) => ({
      days: upsertDayInList(state.days, day),
      activeDay: state.activeDay?.dayId === dayId ? day : state.activeDay,
    }))
  },

  moveDayDate: async (fromDayId: string, toDayId: string) => {
    const result = await moveDay(fromDayId, toDayId)
    if (result.conflict || !result.day) {
      return { conflict: result.conflict }
    }

    const movedDay = result.day

    set((state) => {
      const filtered = state.days.filter((day) => day.dayId !== fromDayId)
      const nextDays = upsertDayInList(filtered, movedDay)
      return {
        days: nextDays,
        activeDay: movedDay,
      }
    })

    return { conflict: false }
  },

  deleteDay: async (dayId: string) => {
    await deleteDay(dayId)
    set((state) => ({
      days: state.days.filter((day) => day.dayId !== dayId),
      activeDay: state.activeDay?.dayId === dayId ? null : state.activeDay,
    }))
  },
}))
