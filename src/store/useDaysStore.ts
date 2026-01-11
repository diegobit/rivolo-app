import { create } from 'zustand'
import { appendLineToDay, deleteDay, ensureDay, getDay, listDays, moveDay, saveDay } from '../lib/dayRepository'
import { getTodayId } from '../lib/dates'
import type { Day } from '../lib/dayRepository'

type DaysState = {
  days: Day[]
  activeDay: Day | null
  loading: boolean
  loadTimeline: () => Promise<void>
  loadDay: (dayId: string) => Promise<{ created: boolean }>
  appendToToday: (line: string) => Promise<void>
  updateDayContent: (dayId: string, content: string) => Promise<void>
  moveDayDate: (fromDayId: string, toDayId: string) => Promise<{ conflict: boolean }>
  deleteDay: (dayId: string) => Promise<void>
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

export const useDaysStore = create<DaysState>((set) => ({
  days: [],
  activeDay: null,
  loading: false,

  loadTimeline: async () => {
    set({ loading: true })
    const days = await listDays()
    set({ days, loading: false })
  },

  loadDay: async (dayId: string) => {
    console.info('[DaysStore] loadDay:start', { dayId })
    set({ loading: true })
    const existing = await getDay(dayId)
    console.info('[DaysStore] loadDay:fetched', {
      dayId,
      found: Boolean(existing),
      contentLength: existing?.contentMd.length ?? 0,
    })
    const day = existing ?? (await ensureDay(dayId))
    const created = !existing
    console.info('[DaysStore] loadDay:resolved', {
      dayId,
      created,
      contentLength: day?.contentMd.length ?? 0,
    })
    set((state) => ({
      activeDay: day,
      days: upsertDayInList(state.days, day),
      loading: false,
    }))
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
