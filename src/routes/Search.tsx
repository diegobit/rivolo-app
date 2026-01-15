import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import BottomTrayPortal from '../components/BottomTrayPortal'
import { searchDays } from '../lib/dayRepository'
import type { Day } from '../lib/dayRepository'

const getSnippet = (content: string) => {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
  const snippet = lines.slice(0, 6).join('\n')
  return snippet || 'No content yet'
}

const highlightText = (text: string, query: string) => {
  const trimmed = query.trim()
  if (!trimmed) return text

  const lower = text.toLowerCase()
  const index = lower.indexOf(trimmed.toLowerCase())
  if (index === -1) return text

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-amber-100 px-1 text-slate-900">
        {text.slice(index, index + trimmed.length)}
      </mark>
      {text.slice(index + trimmed.length)}
    </>
  )
}

export default function Search() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Day[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handle = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await searchDays(query)
        setResults(data)
      } catch {
        setError('Search failed. Try again.')
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 250)

    return () => window.clearTimeout(handle)
  }, [query])

  const trayContent = (
    <div className="space-y-2">
      <div className="flex items-center">
        <div className="relative w-full">
          <img
            src="/lens.svg"
            alt=""
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60"
            style={{ filter: 'grayscale(1) brightness(0.6)' }}
          />
          <input
            id="search-input"
            autoComplete="off"
            className="w-full rounded-xl bg-transparent py-2 pl-10 pr-3 text-base outline-none"
            placeholder="Search all days"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.currentTarget.blur()
              }
            }}
          />
        </div>
        {/*
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#22B3FF] shadow-sm transition hover:bg-[#22B3FF]/90"
          type="button"
          aria-label="Search"
        >
          <img
            src="/lens.svg"
            alt=""
            className="h-5 w-5"
            style={{ filter: 'brightness(0) invert(1)' }}
          />
        </button>
        */}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <BottomTrayPortal>{trayContent}</BottomTrayPortal>

      {loading && (
        <section className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-6 text-sm text-slate-500">
          Searching...
        </section>
      )}

      {error && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">
          {error}
        </section>
      )}

      {!loading && !error && results.length === 0 && (
        <section className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-6 text-sm text-slate-500">
          {query.trim() ? 'No results yet. Try a different query.' : 'Start typing to search your days.'}
        </section>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-3">
          {results.map((day) => (
            <Link
              key={day.dayId}
              to={`/day/${day.dayId}`}
              className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{day.humanTitle}</h3>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                {highlightText(getSnippet(day.contentMd), query)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
