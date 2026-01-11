import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BottomTrayPortal from '../components/BottomTrayPortal'
import { pushToDropbox } from '../lib/dropbox'
import { addDays, getTodayId } from '../lib/dates'
import { buttonPill, buttonPrimary } from '../lib/ui'
import { useDropboxStore } from '../store/useDropboxStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useDaysStore } from '../store/useDaysStore'

const getLines = (content: string) =>
  content.split('\n').map((line) => line.trim()).filter(Boolean)

const getSnippet = (lines: string[]) => lines.slice(0, 5).join('\n')

const countOpenTasks = (content: string) => (content.match(/- \[ \]/g) ?? []).length

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

  const cards = useMemo(
    () =>
      days.map((day) => {
        const lines = getLines(day.contentMd)
        const snippet = getSnippet(lines)
        const open = countOpenTasks(day.contentMd)
        return { day, snippet, open }
      }),
    [days],
  )

  const futureDayId = useMemo(() => {
    const existing = new Set(cards.map((card) => card.day.dayId))
    let candidate = addDays(cards[0]?.day.dayId ?? getTodayId(), 1)
    while (existing.has(candidate)) {
      candidate = addDays(candidate, 1)
    }
    return candidate
  }, [cards])

  const trayContent = (
    <form className="flex flex-wrap gap-2" onSubmit={handleSubmit}>
      <input
        className="w-full flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
        placeholder="Add a line to today"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button className={buttonPrimary} type="submit">
        Add
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

      {!loading && cards.length > 0 && (
        <div className="space-y-3">
          <div className="flex justify-center">
            <button className={buttonPill} type="button" onClick={() => navigate(`/day/${futureDayId}`)}>
              + Future Day
            </button>
          </div>
          {cards.map(({ day, snippet, open }) => (
            <Link
              key={day.dayId}
              to={`/day/${day.dayId}`}
              className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{day.humanTitle}</h3>
                </div>
                {open > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">
                    {open} open tasks
                  </span>
                )}
              </div>
              <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                {snippet || 'No content yet'}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
