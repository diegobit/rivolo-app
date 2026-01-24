import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Decoration, EditorView, ViewPlugin, ViewUpdate, keymap, type DecorationSet } from '@codemirror/view'
import { EditorSelection, RangeSetBuilder, type Extension } from '@codemirror/state'
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

const buildHighlightDecorations = (text: string, query: string) => {
  const trimmed = query.trim()
  const builder = new RangeSetBuilder<Decoration>()
  if (!trimmed) {
    return builder.finish()
  }

  const lowerText = text.toLowerCase()
  const lowerQuery = trimmed.toLowerCase()
  let matchIndex = lowerText.indexOf(lowerQuery)

  while (matchIndex !== -1) {
    builder.add(matchIndex, matchIndex + trimmed.length, Decoration.mark({ class: 'cm-highlight' }))
    matchIndex = lowerText.indexOf(lowerQuery, matchIndex + trimmed.length)
  }

  return builder.finish()
}

const createHighlightPlugin = (query: string) => {
  const trimmed = query.trim()
  if (!trimmed) return null

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildHighlightDecorations(view.state.doc.toString(), trimmed)
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildHighlightDecorations(update.state.doc.toString(), trimmed)
        }
      }
    },
    {
      decorations: (value) => value.decorations,
    },
  )
}

const isEditableElement = (element: HTMLElement | null) =>
  Boolean(
    element &&
      (element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        element.isContentEditable),
  )

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
  open: number
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

type DayEditorCardProps = {
  day: Day
  open: number
  isFuture: boolean
  isToday: boolean
  isYesterday: boolean
  isTomorrow: boolean
  title: string
  humanDate: string
  datePart: string
  weekdayPart: string | undefined
  relativeLabel: string | null
  searchQuery: string
  quote: string | null
  dateError: string | null
  markdownExtension: Extension
  editorTheme: Extension
  clearActiveLine: Extension
  previousDayId: string | null
  nextDayId: string | null
  onChange: (dayId: string, value: string) => void
  onBlur: (dayId: string, event?: FocusEvent) => void
  onDelete: (dayId: string) => void
  onDateChange: (dayId: string, nextDayId: string) => void
  onDateOpen: (dayId: string) => void
  onFocusDay: (dayId: string, position: 'start' | 'end') => void
  registerEditor: (dayId: string, view: EditorView | null) => void
  registerDayRef: (dayId: string, node: HTMLDivElement | null) => void
  registerDateInputRef: (dayId: string, node: HTMLInputElement | null) => void
}

const DayEditorCard = ({
  day,
  open,
  isFuture,
  isToday,
  isYesterday,
  isTomorrow,
  title,
  humanDate,
  datePart,
  weekdayPart,
  relativeLabel,
  searchQuery,
  quote,
  dateError,
  markdownExtension,
  editorTheme,
  clearActiveLine,
  previousDayId,
  nextDayId,
  onChange,
  onBlur,
  onDelete,
  onDateChange,
  onDateOpen,
  onFocusDay,
  registerEditor,
  registerDayRef,
  registerDateInputRef,
}: DayEditorCardProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const longPressTimeoutRef = useRef<number | null>(null)
  const longPressTriggeredRef = useRef(false)
  const hoverTimeoutRef = useRef<number | null>(null)
  const deleteSourceRef = useRef<'hover' | 'longpress' | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const searchHighlight = useMemo(() => createHighlightPlugin(searchQuery), [searchQuery])
  const quoteHighlight = useMemo(() => (quote ? createHighlightPlugin(quote) : null), [quote])

  useEffect(() => {
    return () => {
      registerEditor(day.dayId, null)
    }
  }, [day.dayId, registerEditor])

  useEffect(() => {
    if (!showDelete) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return
      }
      setShowDelete(false)
      deleteSourceRef.current = null
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [showDelete])

  const handleLongPressStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'touch') return
    longPressTriggeredRef.current = false
    if (longPressTimeoutRef.current) {
      window.clearTimeout(longPressTimeoutRef.current)
    }
    longPressTimeoutRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true
      deleteSourceRef.current = 'longpress'
      setShowDelete(true)
    }, 500)
  }

  const clearLongPress = () => {
    if (longPressTimeoutRef.current) {
      window.clearTimeout(longPressTimeoutRef.current)
      longPressTimeoutRef.current = null
    }
  }

  const clearHoverTimeout = () => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
  }

  const handleHoverStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return
    deleteSourceRef.current = 'hover'
    setShowDelete(true)
    clearHoverTimeout()
    hoverTimeoutRef.current = window.setTimeout(() => {
      if (deleteSourceRef.current === 'hover') {
        setShowDelete(false)
        deleteSourceRef.current = null
      }
    }, 10000)
  }

  const handleHoverEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return
    clearHoverTimeout()
    if (deleteSourceRef.current === 'hover') {
      setShowDelete(false)
      deleteSourceRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      if (longPressTimeoutRef.current) {
        window.clearTimeout(longPressTimeoutRef.current)
        longPressTimeoutRef.current = null
      }
      if (hoverTimeoutRef.current) {
        window.clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
    }
  }, [])

  const handleTitleClick = () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      return
    }
    onDateOpen(day.dayId)
  }

  const navigationKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: 'ArrowUp',
          run: (view) => {
            if (!previousDayId) return false
            const { from, to } = view.state.selection.main
            if (from !== 0 || to !== 0) return false
            onFocusDay(previousDayId, 'end')
            return true
          },
        },
        {
          key: 'ArrowDown',
          run: (view) => {
            if (!nextDayId) return false
            const { from, to } = view.state.selection.main
            const end = view.state.doc.length
            if (from !== end || to !== end) return false
            onFocusDay(nextDayId, 'start')
            return true
          },
        },
        {
          key: 'Escape',
          run: (view) => {
            view.contentDOM.blur()
            return true
          },
        },
      ]),
    [nextDayId, onFocusDay, previousDayId],
  )

  const editorExtensions = useMemo(() => {
    const extensions: Extension[] = [
      markdownExtension,
      editorTheme,
      clearActiveLine,
      EditorView.lineWrapping,
      navigationKeymap,
    ]
    if (searchHighlight) {
      extensions.push(searchHighlight)
    }
    if (quoteHighlight) {
      extensions.push(quoteHighlight)
    }
    return extensions
  }, [clearActiveLine, editorTheme, markdownExtension, navigationKeymap, quoteHighlight, searchHighlight])

  return (
    <div
      ref={(node) => {
        containerRef.current = node
        registerDayRef(day.dayId, node)
      }}
      onPointerEnter={handleHoverStart}
      onPointerLeave={handleHoverEnd}
      className={`group rounded-[4px] border p-4 transition ${
        isFuture
          ? 'border-dashed border-slate-200/60 bg-white/70 shadow-[0_4px_6px_-4px_rgba(0,0,0,0.05),0_2px_8px_rgba(0,0,0,0.03)] hover:border-slate-300/60'
          : 'border-slate-200/60 bg-white shadow-[0_6px_6px_-4px_rgba(0,0,0,0.10),0_2px_12px_rgba(0,0,0,0.06)] hover:border-slate-300/60'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          className="text-left"
          type="button"
          aria-label={`Change date for ${day.dayId}`}
          onClick={handleTitleClick}
          onPointerDown={handleLongPressStart}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onPointerLeave={clearLongPress}
        >
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
        </button>
        <div className="flex items-center gap-2">
          {open > 0 && (
            <span
              className={`rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800 ${
                isFuture ? 'opacity-70' : ''
              }`}
            >
              {open === 1 ? '1 todo' : `${open} todos`}
            </span>
          )}
          <button
            className={`flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 ${
              showDelete ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            type="button"
            aria-label="Delete"
            onClick={() => {
              setShowDelete(false)
              deleteSourceRef.current = null
              void onDelete(day.dayId)
            }}
          >
            <img
              src="/trash.svg"
              alt=""
              className="h-4 w-4"
              style={{
                filter:
                  'invert(29%) sepia(51%) saturate(2878%) hue-rotate(341deg) brightness(91%) contrast(95%)',
              }}
            />
          </button>
        </div>
      </div>
      <input
        ref={(node) => registerDateInputRef(day.dayId, node)}
        className="sr-only"
        type="date"
        value={day.dayId}
        onChange={(event) => void onDateChange(day.dayId, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
      />
      {dateError && (
        <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {dateError}
        </div>
      )}
      <div className="mt-3 overflow-hidden rounded-xl">
        <CodeMirror
          value={day.contentMd}
          extensions={editorExtensions}
          onChange={(value) => onChange(day.dayId, value)}
          onBlur={(event) => void onBlur(day.dayId, event.nativeEvent)}
          onCreateEditor={(view) => registerEditor(day.dayId, view)}
          basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLineGutter: false }}
        />
      </div>
    </div>
  )
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
  const { days, loading, loadTimeline, loadDay, appendToToday, updateDayContent, moveDayDate, deleteDay } = useDaysStore()
  const {
    loadSettings,
    geminiApiKey,
    geminiModel,
    aiLanguage,
    fontPreference,
  } = useSettingsStore()
  const { loadState: loadSyncState, status: syncStatus } = useSyncStore()
  const { mode } = useUIStore()

  // Mode-specific Input State
  const [timelineText, setTimelineText] = useState('')
  const [chatText, setChatText] = useState('')
  const [searchText, setSearchText] = useState('')

  const activeText = mode === 'chat' ? chatText : mode === 'search' ? searchText : timelineText
  const updateActiveText = (nextValue: string) => {
    if (mode === 'chat') {
      setChatText(nextValue)
      return
    }
    if (mode === 'search') {
      setSearchText(nextValue)
      return
    }
    setTimelineText(nextValue)
  }

  // Chat State
  const [messages, setMessages] = useState<ChatUiMessage[]>([])
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  // Search State
  const [searchResults, setSearchResults] = useState<Day[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [dateErrors, setDateErrors] = useState<Record<string, string | null>>({})
  const [highlightedQuote, setHighlightedQuote] = useState<Citation | null>(null)

  const canSync = Boolean(syncStatus.connected && syncStatus.filePath)
  const searchQuery = mode === 'search' ? searchText.trim() : ''

  const hasRestoredScroll = useRef(false)
  const editorRefs = useRef(new Map<string, EditorView>())
  const dayRefs = useRef(new Map<string, HTMLDivElement>())
  const dateInputRefs = useRef(new Map<string, HTMLInputElement>())
  const saveTimeouts = useRef(new Map<string, number>())
  const createdDayIdsRef = useRef(new Set<string>())
  const highlightTimeoutRef = useRef<number | null>(null)

  const markdownExtension = useMemo(() => markdown(), [])
  const editorTheme = useMemo(
    () =>
      EditorView.theme({
        '&': {
          backgroundColor: 'transparent',
        },
        '.cm-scroller': {
          fontSize: '1rem',
          fontWeight: '400',
          fontFamily:
            fontPreference === 'monospace'
              ? "'CartographCF', ui-monospace, SFMono-Regular, Menlo, monospace"
              : "'Inter', system-ui, sans-serif",
          color: '#000000',
        },
        '.cm-content': {
          minHeight: '48px',
          padding: '0',
        },
        '.cm-gutters': {
          display: 'none',
        },
      }),
    [fontPreference],
  )
  const clearActiveLine = useMemo(
    () =>
      EditorView.theme({
        '.cm-activeLine': {
          backgroundColor: 'transparent',
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'transparent',
        },
      }),
    [],
  )

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

    if (!searchText.trim()) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    // Set loading immediately to prevent "no results" flash
    setSearchLoading(true)

    const handle = window.setTimeout(async () => {
      setSearchError(null)
      try {
        const data = await searchDays(searchText)
        setSearchResults(data)
      } catch {
        setSearchError('Search failed. Try again.')
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 250)

    return () => window.clearTimeout(handle)
  }, [mode, searchText])

  useEffect(() => {
    return () => {
      for (const handle of saveTimeouts.current.values()) {
        window.clearTimeout(handle)
      }
    }
  }, [])

  useEffect(() => {
    if (!highlightedQuote) return
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current)
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedQuote(null)
    }, 2800)

    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [highlightedQuote])

  // --- Handlers ---

  const handleAutoPush = useCallback(async () => {
    if (!canSync || !navigator.onLine) return
    try {
      await pushToSync()
      await loadSyncState()
    } catch {
      // Ignore auto-push errors
    }
  }, [canSync, loadSyncState])

  const scheduleSave = useCallback(
    (dayId: string, content: string) => {
      const existing = saveTimeouts.current.get(dayId)
      if (existing) {
        window.clearTimeout(existing)
      }
      const handle = window.setTimeout(async () => {
        await updateDayContent(dayId, content)
        await handleAutoPush()
      }, 1000)
      saveTimeouts.current.set(dayId, handle)
    },
    [handleAutoPush, updateDayContent],
  )

  const focusDayEditor = useCallback((dayId: string, position: 'start' | 'end') => {
    const view = editorRefs.current.get(dayId)
    if (!view) return false
    const target = position === 'end' ? view.state.doc.length : 0
    view.dispatch({ selection: EditorSelection.single(target), scrollIntoView: true })
    view.focus()
    return true
  }, [])

  const scrollToDay = useCallback((dayId: string) => {
    let attempts = 0
    const run = () => {
      const node = dayRefs.current.get(dayId)
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      if (attempts < 4) {
        attempts += 1
        requestAnimationFrame(run)
      }
    }
    requestAnimationFrame(run)
  }, [])

  const revealDay = useCallback(
    (dayId: string, focusPosition?: 'start' | 'end') => {
      let attempts = 0
      const run = () => {
        const node = dayRefs.current.get(dayId)
        const view = editorRefs.current.get(dayId)
        if (node) {
          node.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        if (focusPosition && view) {
          focusDayEditor(dayId, focusPosition)
        }
        if ((!node || (focusPosition && !view)) && attempts < 4) {
          attempts += 1
          requestAnimationFrame(run)
        }
      }
      requestAnimationFrame(run)
    },
    [focusDayEditor],
  )

  const handleCreateDay = useCallback(
    async (dayId: string) => {
      const result = await loadDay(dayId)
      if (result.created) {
        createdDayIdsRef.current.add(dayId)
      }
      revealDay(dayId, 'end')
    },
    [loadDay, revealDay],
  )

  const handleDeleteDay = useCallback(
    async (dayId: string) => {
      const existing = saveTimeouts.current.get(dayId)
      if (existing) {
        window.clearTimeout(existing)
        saveTimeouts.current.delete(dayId)
      }
      createdDayIdsRef.current.delete(dayId)
      setDateErrors((state) => {
        if (!state[dayId]) return state
        const next = { ...state }
        delete next[dayId]
        return next
      })
      await deleteDay(dayId)
      await handleAutoPush()
    },
    [deleteDay, handleAutoPush],
  )

  const handleEditorBlur = useCallback(
    async (dayId: string, event?: FocusEvent) => {
      const relatedTarget = event?.relatedTarget as Node | null
      const card = dayRefs.current.get(dayId)
      if (relatedTarget && card?.contains(relatedTarget)) {
        return
      }

      const view = editorRefs.current.get(dayId)
      const content = view?.state.doc.toString() ?? ''
      if (!content.trim() && createdDayIdsRef.current.has(dayId)) {
        const existing = saveTimeouts.current.get(dayId)
        if (existing) {
          window.clearTimeout(existing)
          saveTimeouts.current.delete(dayId)
        }
        createdDayIdsRef.current.delete(dayId)
        await deleteDay(dayId)
        await handleAutoPush()
      }
    },
    [deleteDay, handleAutoPush],
  )

  const handleDateCommit = useCallback(
    async (dayId: string, nextDayId: string) => {
      if (!nextDayId || nextDayId === dayId) return
      const view = editorRefs.current.get(dayId)
      const content = view?.state.doc.toString() ?? ''

      const existing = saveTimeouts.current.get(dayId)
      if (existing) {
        window.clearTimeout(existing)
        saveTimeouts.current.delete(dayId)
      }

      if (content.trim()) {
        await updateDayContent(dayId, content)
      }

      const result = await moveDayDate(dayId, nextDayId)
      if (result.conflict) {
        setDateErrors((state) => ({ ...state, [dayId]: 'Day already exists. Choose another date.' }))
        return
      }

      setDateErrors((state) => ({ ...state, [dayId]: null }))

      if (createdDayIdsRef.current.has(dayId)) {
        createdDayIdsRef.current.delete(dayId)
        createdDayIdsRef.current.add(nextDayId)
      }
      await handleAutoPush()
      revealDay(nextDayId, 'end')
    },
    [handleAutoPush, moveDayDate, revealDay, updateDayContent],
  )

  const handleDatePickerOpen = useCallback((dayId: string) => {
    const input = dateInputRefs.current.get(dayId)
    if (!input) return
    if (input.showPicker) {
      input.showPicker()
      return
    }
    input.click()
  }, [])

  const handleEditorChange = useCallback(
    (dayId: string, value: string) => {
      if (value.trim() && createdDayIdsRef.current.has(dayId)) {
        createdDayIdsRef.current.delete(dayId)
      }
      setSearchResults((state) =>
        state.map((day) => (day.dayId === dayId ? { ...day, contentMd: value } : day)),
      )
      scheduleSave(dayId, value)
    },
    [scheduleSave, setSearchResults],
  )

  const handleCitationClick = useCallback(
    async (citation: Citation) => {
      if (!days.some((day) => day.dayId === citation.day)) {
        await loadDay(citation.day)
      }
      setHighlightedQuote(citation)
      scrollToDay(citation.day)
    },
    [days, loadDay, scrollToDay],
  )

  const registerEditor = useCallback((dayId: string, view: EditorView | null) => {
    if (view) {
      editorRefs.current.set(dayId, view)
      return
    }
    editorRefs.current.delete(dayId)
  }, [])

  const registerDayRef = useCallback((dayId: string, node: HTMLDivElement | null) => {
    if (node) {
      dayRefs.current.set(dayId, node)
      return
    }
    dayRefs.current.delete(dayId)
  }, [])

  const registerDateInputRef = useCallback((dayId: string, node: HTMLInputElement | null) => {
    if (node) {
      dateInputRefs.current.set(dayId, node)
      return
    }
    dateInputRefs.current.delete(dayId)
  }, [])

  const handleChatSend = async () => {
    const trimmed = chatText.trim()
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
    setChatText('')
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
    await handleAutoPush()
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeText.trim()) return

    if (mode === 'timeline') {
      await appendToToday(timelineText)
      setTimelineText('')
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
      days.map((day) => ({
        day,
        open: countOpenTasks(day.contentMd),
      })),
    [days],
  )

  const todayId = getTodayId()
  const yesterdayId = addDays(todayId, -1)
  const tomorrowId = addDays(todayId, 1)
  const maxWeekdayOffset = 14
  const hasToday = useMemo(() => timelineCards.some((card) => card.day.dayId === todayId), [timelineCards, todayId])

  const futureDayId = useMemo(() => {
    const existing = new Set(timelineCards.map((card) => card.day.dayId))
    let candidate = addDays(todayId, 1) // Start from tomorrow
    while (existing.has(candidate)) {
      candidate = addDays(candidate, 1)
    }
    return candidate
  }, [timelineCards, todayId])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() !== 'n') return
      if (isEditableElement(document.activeElement as HTMLElement | null)) return
      event.preventDefault()
      void handleCreateDay(futureDayId)
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [futureDayId, handleCreateDay])

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
  }, [timelineCards, hasToday, todayId, futureDayId])


  // Search Results Cards
  const searchCards = useMemo<TimelineItem[]>(() => {
    if (mode !== 'search' || !searchText.trim()) return []
    return searchResults.map((day) => {
      return {
        type: 'day',
        card: {
          day,
          open: countOpenTasks(day.contentMd),
        },
      }
    })
  }, [mode, searchText, searchResults])

  // Active Items
  const activeItems = (mode === 'search' && searchText.trim() && searchResults.length > 0) ? searchCards : standardItems

  const dayOrder = useMemo(
    () =>
      activeItems
        .filter((item): item is { type: 'day'; card: TimelineDayCard } => item.type === 'day')
        .map((item) => item.card.day.dayId),
    [activeItems],
  )
  const dayIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    dayOrder.forEach((dayId, index) => map.set(dayId, index))
    return map
  }, [dayOrder])

  // No Results State
  const noSearchResults = mode === 'search' && !searchLoading && searchText.trim() && searchResults.length === 0 && !searchError

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
      <p
        className={`absolute -top-10 left-1/2 -z-10 -translate-x-1/2 rounded-full border border-gray-300 bg-white px-6 pb-6 pt-1 text-sm text-red-400 ${
          noSearchResults ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!noSearchResults}
      >
        No results
      </p>
      <form className="flex items-center gap-3" onSubmit={handleSubmit}>
        <div className="relative flex-1">
          <img
            src={inputConfig.icon}
            alt=""
            className="pointer-events-none absolute left-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 opacity-60 sm:block"
            style={inputConfig.style}
          />
          <input
            id={inputConfig.id}
            autoComplete="on"
            className="w-full rounded-full bg-transparent py-2 pl-3 pr-3 text-base outline-none sm:pl-10"
            placeholder={inputConfig.placeholder}
            value={activeText}
            onChange={(event) => updateActiveText(event.target.value)}
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
              activeText.trim() && !sending ? 'bg-[#22B3FF] hover:bg-[#22B3FF]/90' : 'bg-slate-300'
            }`}
            type="submit"
            disabled={sending}
            aria-label={mode === 'chat' ? 'Send' : 'Add'}
          >
            <img src={mode === 'chat' ? "/arrow-up.svg" : "/plus.svg"} alt="" className="h-5 w-5" style={{ filter: 'brightness(0) invert(1)' }} />
          </button>
        )}
        {mode === 'search' && searchText.trim() && (
          <button
            className="group flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-500"
            type="button"
            aria-label="Clear search"
            onClick={() => setSearchText('')}
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
                            onClick={() => void handleCitationClick(citation)}
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
                    onClick={() => void handleCreateDay(item.dayId)}
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
                    onClick={() => void handleCreateDay(item.dayId)}
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

            const { day, open } = item.card
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
            const dayIndex = dayIndexMap.get(day.dayId) ?? -1
            const previousDayId = dayIndex > 0 ? dayOrder[dayIndex - 1] : null
            const nextDayId = dayIndex >= 0 && dayIndex < dayOrder.length - 1 ? dayOrder[dayIndex + 1] : null
            const dateError = dateErrors[day.dayId] ?? null
            const quote = highlightedQuote?.day === day.dayId ? highlightedQuote.quote : null

            return (
              <DayEditorCard
                key={day.dayId}
                day={day}
                open={open}
                isFuture={isFuture}
                isToday={isToday}
                isYesterday={isYesterday}
                isTomorrow={isTomorrow}
                title={title}
                humanDate={humanDate}
                datePart={datePart}
                weekdayPart={weekdayPart}
                relativeLabel={relativeLabel}
                searchQuery={searchQuery}
                quote={quote}
                dateError={dateError}
                markdownExtension={markdownExtension}
                editorTheme={editorTheme}
                clearActiveLine={clearActiveLine}
                previousDayId={previousDayId}
                nextDayId={nextDayId}
                onChange={handleEditorChange}
                onBlur={handleEditorBlur}
                onDelete={handleDeleteDay}
                onDateChange={handleDateCommit}
                onDateOpen={handleDatePickerOpen}
                onFocusDay={focusDayEditor}
                registerEditor={registerEditor}
                registerDayRef={registerDayRef}
                registerDateInputRef={registerDateInputRef}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
