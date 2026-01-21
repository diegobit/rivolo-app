import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BottomTrayPortal from '../components/BottomTrayPortal'
import { pushToSync } from '../lib/sync'
import { addDays, formatHumanDate, getTodayId, parseDayId } from '../lib/dates'
import type { Day } from '../lib/dayRepository'
import { searchDays, prependToDay } from '../lib/dayRepository'
import { useSettingsStore } from '../store/useSettingsStore'
import { useSyncStore } from '../store/useSyncStore'
import { useDaysStore } from '../store/useDaysStore'
import { useUIStore } from '../store/useUIStore'
import { chat } from '../lib/llm'
import type { ChatMessage as LlmMessage } from '../lib/llm'
import { buildContextDays, formatContext } from '../lib/llmContext'

// --- Helpers ---

const getPreview = (content: string, maxLines: number) => {
  const trimmed = content.trim()
  if (!trimmed) {
    return { text: '', truncated: false }
  }

  const lines = trimmed.split('\n')
  return {
    text: lines.slice(0, maxLines).join('\n'),
    truncated: lines.length > maxLines,
  }
}

const getSearchPreview = (content: string, query: string, contextLines: number) => {
  const trimmed = content.trim()
  if (!trimmed) {
    return { text: '', truncated: false }
  }

  const lines = trimmed.split('\n')
  const totalLines = contextLines * 2 + 1
  if (lines.length <= totalLines) {
    return { text: lines.join('\n'), truncated: false }
  }

  const lowerQuery = query.trim().toLowerCase()
  const matchIndex = lowerQuery
    ? lines.findIndex((line) => line.toLowerCase().includes(lowerQuery))
    : -1

  let start = matchIndex === -1 ? 0 : Math.max(0, matchIndex - contextLines)
  let end = start + totalLines
  if (end > lines.length) {
    end = lines.length
    start = Math.max(0, end - totalLines)
  }

  return {
    text: lines.slice(start, end).join('\n'),
    truncated: true,
  }
}

const highlightText = (text: string, query: string) => {
  const trimmed = query.trim()
  if (!trimmed) return text

  const lowerText = text.toLowerCase()
  const lowerQuery = trimmed.toLowerCase()
  let matchIndex = lowerText.indexOf(lowerQuery)
  if (matchIndex === -1) return text

  const nodes: React.ReactNode[] = []
  let cursor = 0

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      nodes.push(text.slice(cursor, matchIndex))
    }

    nodes.push(
      <mark key={`match-${matchIndex}`} className="rounded bg-amber-100 px-1 text-slate-900">
        {text.slice(matchIndex, matchIndex + trimmed.length)}
      </mark>,
    )

    cursor = matchIndex + trimmed.length
    matchIndex = lowerText.indexOf(lowerQuery, cursor)
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return <>{nodes}</>
}

const countOpenTasks = (content: string) => (content.match(/- \[ \]/g) ?? []).length

const formatTimestamp = (date: Date) => {
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

// --- Types ---

type TimelineDayCard = {
  day: Day
  snippet: string | React.ReactNode
  open: number
  truncated: boolean
}

type TimelineItem =
  | { type: 'day'; card: TimelineDayCard }
  | { type: 'add-today'; dayId: string }
  | { type: 'add-future'; dayId: string }
  | { type: 'divider' }

type Citation = {
  day: string
  quote: string
}

type AssistantPayload = {
  answer: string
  citations?: Citation[]
  insert_text?: string | null
  insert_target_day?: string | null
}

type ChatUiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  meta?: {
    citations: Citation[]
    insertText?: string | null
    insertTargetDay?: string | null
  }
}

// --- Constants ---

const SYSTEM_PROMPT = `You are the Daily Notes Analyst, an expert in parsing, retrieving, and synthesizing information from the user's chronological daily notes. Your data source is a collection of daily entries organized by date.

### Core Responsibilities
1. **Chronological Navigation**: Accurately interpret relative dates (e.g., 'yesterday', 'last Tuesday', 'three days ago') based on the current date. Locate specific entries based on day IDs.
2. **Content Extraction**: Retrieve specific details such as meeting notes, decisions made, thoughts recorded, or tasks logged on specific days.
3. **Task Management**: Identify and list user tasks, distinguishing between completed (\`[x]\`) and incomplete (\`[ ]\`) items across days.
4. **Pattern Recognition**: Connect related information across different dates to provide comprehensive answers (e.g., tracking a topic or project over time).

### Operational Guidelines
- **Entry Structure**: Each entry is identified by a day ID in \`YYYY-MM-DD\` format.
- **Citation Required**: When providing answers, always reference the specific day(s) where information was found using exact quotes.
- **Context Awareness**: Pay attention to the current date provided in the context to correctly interpret relative date references.
- **Search Strategy**: For topic-specific queries, aggregate findings chronologically across all relevant days.

### Interaction Style
- Be concise and organized.
- Use bullet points to list items like todos or highlights.
- If a requested date has no entry, explicitly state that no notes were found for that day.

### Response Format
Answer with strict JSON only. Return exactly this shape:
{
  "answer": "string",
  "citations": [{ "day": "YYYY-MM-DD", "quote": "exact substring" }],
  "insert_text": "string|null",
  "insert_target_day": "YYYY-MM-DD|null"
}
Quotes must be exact substrings from the cited day. If unsure, omit citations.`

// --- Component ---

export default function Timeline() {
  const navigate = useNavigate()
  const { days, loading, loadTimeline, appendToToday } = useDaysStore()
  const {
    loadSettings,
    timelineView,
    geminiApiKey,
    geminiModel,
    aiLanguage,
    fontPreference,
  } = useSettingsStore()
  const { loadState: loadSyncState, status: syncStatus } = useSyncStore()
  const { mode } = useUIStore()

  // Shared Input State
  const [text, setText] = useState('')

  // Chat State
  const [messages, setMessages] = useState<ChatUiMessage[]>([])
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  // Search State
  const [searchResults, setSearchResults] = useState<Day[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const canSync = Boolean(syncStatus.connected && syncStatus.filePath)

  const hasRestoredScroll = useRef(false)

  // --- Effects ---

  useEffect(() => {
    void loadTimeline()
    void loadSettings()
    void loadSyncState()
  }, [loadSettings, loadSyncState, loadTimeline])

  // Restore scroll position when returning to Timeline
  useEffect(() => {
    if (hasRestoredScroll.current) return
    hasRestoredScroll.current = true

    const saved = sessionStorage.getItem('timeline-scroll')
    if (saved) {
      const y = parseInt(saved, 10)
      if (!isNaN(y)) {
        requestAnimationFrame(() => window.scrollTo(0, y))
      }
      sessionStorage.removeItem('timeline-scroll')
    }
  }, [])

  // Search Debounce
  useEffect(() => {
    if (mode !== 'search') return

    if (!text.trim()) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    // Set loading immediately to prevent "no results" flash
    setSearchLoading(true)

    const handle = window.setTimeout(async () => {
      setSearchError(null)
      try {
        const data = await searchDays(text)
        setSearchResults(data)
      } catch {
        setSearchError('Search failed. Try again.')
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 250)

    return () => window.clearTimeout(handle)
  }, [mode, text])

  // --- Handlers ---

  const handleAutoPush = async () => {
    if (!canSync || !navigator.onLine) return
    try {
      await pushToSync()
      await loadSyncState()
    } catch {
      // Ignore auto-push errors
    }
  }

  const handleChatSend = async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setChatError(null)

    if (!geminiApiKey) {
      setChatError('Add a Gemini API key in Settings first.')
      return
    }

    const userMessage: ChatUiMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    }

    const assistantId = crypto.randomUUID()
    const assistantMessage: ChatUiMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      meta: { citations: [] },
    }

    setMessages((state) => [...state, userMessage, assistantMessage])
    setText('')
    setSending(true)

    const currentMessages = [...messages, userMessage].map((m) => ({ role: m.role, content: m.content })) as LlmMessage[]

    try {
      const contextDays = await buildContextDays(trimmed)
      const contextText = formatContext(contextDays)
      const contextMap = new Map(contextDays.map((day) => [day.dayId, day.contentMd]))

      const languageInstruction = aiLanguage === 'follow'
        ? 'Reply in the same language the user writes in.'
        : `Always reply in ${aiLanguage}.`

      const date = new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', weekday: 'long' })

      const llmMessages = [
        {
          role: 'system' as const,
          content: `${SYSTEM_PROMPT}\n\n<user_notes>\n${contextText}\n</user_notes>\n\nToday is ${date}.\nGiven the user's notes above, answer their question accurately and concisely. ${languageInstruction}`,
        },
        ...currentMessages,
      ]

      // DEBUG: Log the full prompt being sent to the LLM
      console.log('[LLM Request]', JSON.stringify(llmMessages, null, 2))

      const { text: responseText } = await chat({
        provider: 'gemini',
        apiKey: geminiApiKey,
        model: geminiModel,
        messages: llmMessages,
        stream: true,
        onToken: (chunk) => {
          setMessages((state) =>
            state.map((message) =>
              message.id === assistantId
                ? { ...message, content: `${message.content}${chunk}` }
                : message,
            ),
          )
        },
      })

      // DEBUG: Log the LLM response
      console.log('[LLM Response]', responseText)

      const sanitized = responseText.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
      console.log('[LLM Sanitized]', sanitized)

      let payload: AssistantPayload | null = null
      try {
        payload = JSON.parse(sanitized) as AssistantPayload
        console.log('[LLM Parsed]', payload)
      } catch (parseError) {
        console.error('[LLM Parse Error]', parseError)
        payload = { answer: responseText }
      }

      const citations = (payload.citations ?? []).filter((citation) => {
        const content = contextMap.get(citation.day)
        return content ? content.includes(citation.quote) : false
      })

      setMessages((state) =>
        state.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: payload?.answer ?? responseText,
                meta: {
                  citations,
                  insertText: payload?.insert_text ?? null,
                  insertTargetDay: payload?.insert_target_day ?? null,
                },
              }
            : message,
        ),
      )
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'LLM request failed.')
    } finally {
      setSending(false)
    }
  }

  const handleChatInsert = async (message: ChatUiMessage) => {
    const insertText = message.meta?.insertText
    if (!insertText) return

    const targetDay = message.meta?.insertTargetDay ?? getTodayId()
    const timestamp = formatTimestamp(new Date())
    const payload = `LLM summary (${timestamp}):\n${insertText.trim()}`
    await prependToDay(targetDay, payload)
    await loadTimeline()
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!text.trim()) return

    if (mode === 'timeline') {
      await appendToToday(text)
      setText('')
      await handleAutoPush()
    } else if (mode === 'chat') {
      await handleChatSend()
    }
    // Search is handled by debounce
  }

  // --- Computed Data ---

  // Standard Timeline Cards
  const timelineCards = useMemo<TimelineDayCard[]>(
    () =>
      days.map((day) => {
        const trimmed = day.contentMd.trim()
        const open = countOpenTasks(day.contentMd)

        if (timelineView === 'preview') {
          const preview = getPreview(day.contentMd, 10)
          return {
            day,
            snippet: preview.text,
            open,
            truncated: preview.truncated,
          }
        }

        return {
          day,
          snippet: trimmed,
          open,
          truncated: false,
        }
      }),
    [days, timelineView],
  )

  const todayId = getTodayId()
  const yesterdayId = addDays(todayId, -1)
  const tomorrowId = addDays(todayId, 1)
  const maxWeekdayOffset = 14
  const hasToday = useMemo(() => timelineCards.some((card) => card.day.dayId === todayId), [timelineCards, todayId])
  const hasFuture = useMemo(() => timelineCards.some((card) => card.day.dayId > todayId), [timelineCards, todayId])

  const futureDayId = useMemo(() => {
    const existing = new Set(timelineCards.map((card) => card.day.dayId))
    let candidate = addDays(todayId, 1) // Start from tomorrow
    while (existing.has(candidate)) {
      candidate = addDays(candidate, 1)
    }
    return candidate
  }, [timelineCards, todayId])

  const standardItems = useMemo<TimelineItem[]>(() => {
    // Case: No cards at all → show only +Today
    if (timelineCards.length === 0) {
      return [{ type: 'add-today', dayId: todayId }]
    }

    const items: TimelineItem[] = []
    const showAddFuture = hasToday
    let addedFutureButton = false
    let addedTodayButton = false

    for (const card of timelineCards) {
      const isFutureCard = card.day.dayId > todayId
      const isPastCard = card.day.dayId < todayId

      // Insert +FutureDay button when transitioning from future to today/past
      if (!addedFutureButton && showAddFuture && !isFutureCard) {
        items.push({ type: 'add-future', dayId: futureDayId })
        addedFutureButton = true
      }

      // Insert +Today button when transitioning to past (if no today exists)
      if (!addedTodayButton && !hasToday && isPastCard) {
        items.push({ type: 'add-today', dayId: todayId })
        addedTodayButton = true
      }

      items.push({ type: 'day', card })
    }

    // If all cards were future, add the +FutureDay button at the end
    if (!addedFutureButton && showAddFuture) {
      items.push({ type: 'add-future', dayId: futureDayId })
    }

    // If no today and no past cards, add +Today at the end
    if (!addedTodayButton && !hasToday) {
      items.push({ type: 'add-today', dayId: todayId })
    }

    return items
  }, [timelineCards, hasToday, hasFuture, todayId, futureDayId])


  // Search Results Cards
  const searchCards = useMemo<TimelineItem[]>(() => {
    if (mode !== 'search' || !text.trim()) return []
    return searchResults.map((day) => {
      const open = countOpenTasks(day.contentMd)
      if (timelineView === 'preview') {
        const preview = getSearchPreview(day.contentMd, text, 2)
        return {
          type: 'day',
          card: {
            day,
            snippet: highlightText(preview.text, text),
            open,
            truncated: preview.truncated,
          },
        }
      }

      const fullText = day.contentMd.trim()
      return {
        type: 'day',
        card: {
          day,
          snippet: highlightText(fullText || 'No content yet', text),
          open,
          truncated: false,
        },
      }
    })
  }, [mode, text, searchResults, timelineView])

  // Active Items
  const activeItems = (mode === 'search' && text.trim() && searchResults.length > 0) ? searchCards : standardItems

  // No Results State
  const noSearchResults = mode === 'search' && !searchLoading && text.trim() && searchResults.length === 0 && !searchError

  // --- Render ---

  // Input Config based on mode
  const inputConfig = useMemo(() => {
    switch (mode) {
      case 'chat':
        return {
          placeholder: 'Ask anything',
          icon: '/sparkles.svg',
          id: 'chat-input',
          style: { filter: 'grayscale(1) brightness(0.6)' }
        }
      case 'search':
        return {
          placeholder: 'Search all days',
          icon: '/lens.svg',
          id: 'search-input',
          style: { filter: 'grayscale(1) brightness(0.6)' }
        }
      default:
        return {
          placeholder: 'What am I thinking about today?',
          icon: '/notes.svg',
          id: 'timeline-input',
          style: { filter: 'grayscale(1) brightness(0.6)' }
        }
    }
  }, [mode])

  const trayContent = (
    <div className="relative">
      {noSearchResults && (
        <p className="absolute -top-10 left-1/2 -z-10 -translate-x-1/2 rounded-full border border-gray-300 bg-white px-6 pb-6 pt-1 text-sm text-red-400">
          No results
        </p>
      )}
      <form className="flex items-center gap-3" onSubmit={handleSubmit}>
        <div className="relative flex-1">
          <img
            src={inputConfig.icon}
            alt=""
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60"
            style={inputConfig.style}
          />
          <input
            id={inputConfig.id}
            autoComplete="off"
            className="w-full rounded-full bg-transparent py-2 pl-10 pr-3 text-base outline-none"
            placeholder={inputConfig.placeholder}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.currentTarget.blur()
              }
            }}
          />
        </div>
        {(mode === 'timeline' || mode === 'chat') && (
          <button
            className={`flex h-10 w-10 items-center justify-center rounded-full shadow-sm transition ${
              text.trim() && !sending ? 'bg-[#22B3FF] hover:bg-[#22B3FF]/90' : 'bg-slate-300'
            }`}
            type="submit"
            disabled={sending}
            aria-label={mode === 'chat' ? 'Send' : 'Add'}
          >
            <img src={mode === 'chat' ? "/arrow-up.svg" : "/plus.svg"} alt="" className="h-5 w-5" style={{ filter: 'brightness(0) invert(1)' }} />
          </button>
        )}
        {mode === 'search' && text.trim() && (
          <button
            className="group flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-500"
            type="button"
            aria-label="Clear search"
            onClick={() => setText('')}
          >
            <img
              src="/plus.svg"
              alt=""
              className="h-4 w-4 rotate-45  [filter:invert(0.5)] group-hover:[filter:invert(1)]"
            />
          </button>
        )}
      </form>
    </div>
  )

  return (
    <div className={mode === 'chat' ? 'pb-[40vh]' : undefined}>
      <BottomTrayPortal>{trayContent}</BottomTrayPortal>

      {/* Chat Panel - Fixed Overlay */}
      {mode === 'chat' && (
        <div className="fixed bottom-24 left-0 right-0 z-20 mx-auto w-[min(96%,720px)] px-4">
          <div className={`pointer-events-none absolute -bottom-24 -inset-x-8 -top-4 -z-10 bg-white/30 backdrop-blur-md transition-opacity duration-500 [mask-image:linear-gradient(to_bottom,transparent,black_40%)] ${messages.length > 0 ? 'opacity-100' : 'opacity-0'}`} />
          <div className="flex max-h-[50vh] flex-col-reverse gap-3 overflow-y-auto p-6">
            {chatError && <p className="text-center text-xs text-rose-500">{chatError}</p>}
            {[...messages].reverse().map((message) => (
               <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] space-y-2 rounded-2xl px-4 py-3 text-m shadow-[0_0_30px_-0_rgba(0,0,0,0.12)] ${
                    message.role === 'user'
                      ? 'bg-[#22B3FF] text-white'
                      : 'bg-white text-slate-700'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content || '...'}</p>

                  {message.role === 'assistant' && message.meta?.citations?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {message.meta.citations.map((citation, index) => (
                          <button
                            key={`${citation.day}-${index}`}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 shadow-sm transition hover:-translate-y-[1px] hover:shadow-md"
                            onClick={() =>
                              navigate(`/day/${citation.day}?quote=${encodeURIComponent(citation.quote)}`)
                            }
                          >
                          {citation.day} · “{citation.quote.slice(0, 32)}”
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {message.role === 'assistant' && message.meta?.insertText ? (
                      <button
                        className="rounded-full border border-[#22B3FF]/40 px-3 py-1 text-xs font-semibold text-[#22B3FF] shadow-sm transition hover:-translate-y-[1px] hover:shadow-md"
                        onClick={() => void handleChatInsert(message)}
                      >
                      {message.meta.insertTargetDay
                        ? `Insert into ${message.meta.insertTargetDay}`
                        : 'Insert summary'}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading States */}
      {loading && (
         <section className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-6 text-sm text-slate-500">
           Loading days...
         </section>
      )}

      {/* Main List */}
      {!loading && activeItems.length > 0 && (
        <div className="space-y-3">
          {activeItems.map((item, index) => {
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

            if (item.type === 'add-future') {
              return (
                <div key={`add-future-${item.dayId}`} className="flex justify-center">
                  <button
                    className="group inline-flex items-center gap-2 rounded-full bg-transparent px-3 py-1 text-xs font-semibold text-[#22B3FF] opacity-70 transition hover:text-[#22B3FF]/80"
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
                    {item.dayId === tomorrowId ? 'Tomorrow' : 'Future Day'}
                  </button>
                </div>
              )
            }

            if (item.type === 'divider') {
               return (
                <div
                  key={`divider-${index}`}
                  className="my-3 border-t border-dashed border-slate-200/80"
                />
              )
            }

            const { day, snippet, open, truncated } = item.card
            const isToday = day.dayId === todayId
            const isYesterday = day.dayId === yesterdayId
            const isTomorrow = day.dayId === tomorrowId
            const isFuture = day.dayId > todayId
            const dayDate = parseDayId(day.dayId)
            const todayDate = parseDayId(todayId)
            const diffDays = Math.round((dayDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))
            const showWeekday = Math.abs(diffDays) <= maxWeekdayOffset
            const humanDate = formatHumanDate(day.dayId, todayId, {
              includeRelativeLabel: false,
              includeWeekday: showWeekday,
            })
            const relativeLabel = isToday ? 'Today' : isYesterday ? 'Yesterday' : isTomorrow ? 'Tomorrow' : null
            const [datePart, weekdayPart] = humanDate.split(', ')
            const title = relativeLabel ?? humanDate

            return (
              <Link
                key={day.dayId}
                to={`/day/${day.dayId}`}
                onClick={() => sessionStorage.setItem('timeline-scroll', String(window.scrollY))}
                className={`block rounded-[4px] border p-4 transition ${
                  isFuture
                    ? 'border-dashed border-slate-200/60 bg-white/70 shadow-[0_4px_6px_-4px_rgba(0,0,0,0.05),0_2px_8px_rgba(0,0,0,0.03)] hover:border-slate-300/60'
                    : 'border-slate-200/60 bg-white shadow-[0_6px_6px_-4px_rgba(0,0,0,0.10),0_2px_12px_rgba(0,0,0,0.06)] hover:border-slate-300/60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3
                      className={`${isToday ? 'text-2xl' : isYesterday || isTomorrow ? 'text-lg' : 'text-base'} ${
                        isToday || isYesterday || isTomorrow ? 'font-bold' : 'font-semibold'
                      } ${isFuture ? 'opacity-70' : ''}`}
                    >
                      {relativeLabel ? (
                        <>
                          <span className="text-slate-900">{relativeLabel}</span>
                          <span className="ml-2 font-semibold text-slate-400">{humanDate}</span>
                        </>
                      ) : weekdayPart ? (
                        <>
                          <span className="text-slate-900">{datePart}</span>
                          <span className="ml-2 font-semibold text-slate-400">{weekdayPart}</span>
                        </>
                      ) : (
                        <span className="text-slate-900">{title}</span>
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
                  <p
                    className={`mt-3 whitespace-pre-line text-base ${isFuture ? 'text-slate-500/70' : 'text-slate-600'}`}
                    style={{
                      fontFamily:
                        fontPreference === 'monospace'
                          ? "'CartographCF', ui-monospace, SFMono-Regular, Menlo, monospace"
                          : "'Inter', system-ui, sans-serif",
                    }}
                  >
                    {snippet}
                    {truncated && <span className="mt-2 block text-xs text-slate-400">... more</span>}
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
