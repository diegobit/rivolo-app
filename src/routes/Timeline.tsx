import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BottomTrayPortal from '../components/BottomTrayPortal'
import { pushToDropbox } from '../lib/dropbox'
import { addDays, getTodayId, parseDayId } from '../lib/dates'
import type { Day } from '../lib/dayRepository'
import { useDropboxStore } from '../store/useDropboxStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useDaysStore } from '../store/useDaysStore'

const getLines = (content: string) =>
  content.split('\n').map((line) => line.trim()).filter(Boolean)

const getSnippet = (lines: string[]) => lines.slice(0, 5).join('\n')

const countOpenTasks = (content: string) => (content.match(/- \[ \]/g) ?? []).length

const formatShortDay = (dayId: string) =>
  new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(parseDayId(dayId))

type TimelineDayCard = {
  day: Day
  snippet: string
  open: number
}

type TimelineItem =
  | { type: 'day'; card: TimelineDayCard }
  | { type: 'add-today'; dayId: string }
  | { type: 'divider' }

export default function Timeline() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const { days, loading, loadTimeline, appendToToday } = useDaysStore()
  const { loadSettings, passcode, locked } = useSettingsStore()
  const { loadState, hasAuth, filePath } = useDropboxStore()

  const canSync = Boolean(hasAuth && filePath && passcode.trim() && !locked)

  useEffect(() => {
    void loadTimeline()
    void loadSettings()
    void loadState()
  }, [loadTimeline, loadSettings, loadState])

  const handleAutoPush = async () => {
    if (!canSync || !navigator.onLine) return

    try {
      await pushToDropbox(passcode)
      await loadState()
    } catch {
      // Ignore auto-push errors for now.
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await appendToToday(text)
    setText('')
    await handleAutoPush()
  }

  const cards = useMemo<TimelineDayCard[]>(
    () =>
      days.map((day) => {
        const lines = getLines(day.contentMd)
        const snippet = getSnippet(lines)
        const open = countOpenTasks(day.contentMd)
        return { day, snippet, open }
      }),
    [days],
  )

  const todayId = getTodayId()
  const yesterdayId = addDays(todayId, -1)
  const hasToday = useMemo(() => cards.some((card) => card.day.dayId === todayId), [cards, todayId])

  const timelineItems = useMemo<TimelineItem[]>(() => {
    if (cards.length === 0) {
      return hasToday ? [] : [{ type: 'add-today', dayId: todayId }]
    }

    if (hasToday) {
      return cards.map((card) => ({ type: 'day', card }))
    }

    const items: TimelineItem[] = []
    let inserted = false

    for (const card of cards) {
      if (!inserted && card.day.dayId < todayId) {
        items.push({ type: 'add-today', dayId: todayId })
        inserted = true
      }
      items.push({ type: 'day', card })
    }

    if (!inserted) {
      items.push({ type: 'add-today', dayId: todayId })
    }

    return items
  }, [cards, hasToday, todayId])

  const renderedItems = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = []
    let sawFuture = false
    let dividerInserted = false

    for (const item of timelineItems) {
      const isFuture = item.type === 'day' && item.card.day.dayId > todayId
      if (isFuture) {
        sawFuture = true
        items.push(item)
        continue
      }

      if (sawFuture && !dividerInserted) {
        items.push({ type: 'divider' })
        dividerInserted = true
      }

      items.push(item)
    }

    return items
  }, [timelineItems, todayId])

  const futureDayId = useMemo(() => {
    const existing = new Set(cards.map((card) => card.day.dayId))
    let candidate = addDays(cards[0]?.day.dayId ?? todayId, 1)
    while (existing.has(candidate)) {
      candidate = addDays(candidate, 1)
    }
    return candidate
  }, [cards, todayId])

  const trayContent = (
    <form className="flex items-center gap-3" onSubmit={handleSubmit}>
      <input
        className="w-full flex-1 rounded-full bg-transparent px-4 py-2.5 text-base outline-none"
        placeholder="What am I thinking about today?"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button
        className="flex h-10 w-10 items-center justify-center rounded-full bg-[#22B3FF] shadow-sm transition hover:bg-[#22B3FF]/90"
        type="submit"
        aria-label="Add"
      >
        <img src="/plus.svg" alt="" className="h-4 w-4" style={{ filter: 'brightness(0) invert(1)' }} />
      </button>
    </form>
  )

  return (
    <div className="space-y-4">
      <BottomTrayPortal>{trayContent}</BottomTrayPortal>

      {loading && (
        <section className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-6 text-sm text-slate-500">
          Loading days...
        </section>
      )}

      {!loading && cards.length === 0 && (
        <section className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-6 text-sm text-slate-500">
          No days yet. Add a note to get started.
        </section>
      )}

      {!loading && renderedItems.length > 0 && (
        <div className="space-y-3">
          <div className="flex justify-center">
            <button
              className="group inline-flex items-center gap-2 rounded-full bg-transparent px-3 py-1 text-xs font-semibold text-[#22B3FF] transition hover:text-[#22B3FF]/80"




              type="button"
              onClick={() => navigate(`/day/${futureDayId}`)}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#22B3FF] transition group-hover:bg-[#22B3FF]/90">
                <img
                  src="/plus.svg"
                  alt=""
                  className="h-3.5 w-3.5"
                  style={{ filter: 'brightness(0) invert(1)' }}
                />
              </span>
              {formatShortDay(futureDayId)}
            </button>
          </div>
          {renderedItems.map((item, index) => {
            if (item.type === 'add-today') {
              return (
                <div key={`add-${item.dayId}`} className="flex justify-center">
                  <button
                    className="group inline-flex items-center gap-2 rounded-full bg-transparent px-3 py-1 text-xs font-semibold text-[#22B3FF] transition hover:text-[#22B3FF]/80"




                    type="button"
                    onClick={() => navigate(`/day/${item.dayId}`)}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#22B3FF] transition group-hover:bg-[#22B3FF]/90">
                      <img
                        src="/plus.svg"
                        alt=""
                        className="h-3.5 w-3.5"
                        style={{ filter: 'brightness(0) invert(1)' }}
                      />
                    </span>
                    Today
                  </button>
                </div>
              )
            }

            if (item.type === 'divider') {
              return (
                <div
                  key={`divider-${index}`}
                  className="my-2 border-t border-dashed border-slate-200/80"
                />
              )
            }

            const { day, snippet, open } = item.card
            const isToday = day.dayId === todayId
            const isYesterday = day.dayId === yesterdayId
            const isFuture = day.dayId > todayId
            const title = isToday ? 'Today' : isYesterday ? 'Yesterday' : day.humanTitle
            const showDate = isToday || isYesterday

            return (
              <Link
                key={day.dayId}
                to={`/day/${day.dayId}`}
                className={`block rounded-2xl border p-4 shadow-sm transition ${
                  isFuture
                    ? 'border-dashed border-slate-200/80 bg-white/70 hover:border-slate-300/70'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3
                      className={`${
                        isToday ? 'text-xl' : isYesterday ? 'text-lg' : 'text-base'
                      } font-semibold ${isFuture ? 'text-slate-600/70' : 'text-slate-900'}`}
                    >
                      {title}
                      {showDate && (
                        <span className={`ml-2 font-semibold ${isToday ? 'text-xl' : 'text-lg'} text-slate-400`}>
                          • {day.humanTitle}
                        </span>
                      )}
                    </h3>
                  </div>
                  {open > 0 && (
                    <span
                      className={`rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800 ${
                        isFuture ? 'opacity-70' : ''
                      }`}
                    >
                      {open === 1 ? '1 todo' : `${open} todos`}
                    </span>
                  )}
                </div>
                {snippet && (
                  <p className={`mt-3 whitespace-pre-line text-base ${isFuture ? 'text-slate-500/70' : 'text-slate-600'}`}>
                    {snippet}
                  </p>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
