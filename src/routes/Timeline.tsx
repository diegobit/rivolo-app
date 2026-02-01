import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Decoration, EditorView, ViewPlugin, ViewUpdate, keymap, type DecorationSet } from '@codemirror/view'
import { EditorSelection, Prec, RangeSetBuilder, type Extension, type Line } from '@codemirror/state'
import BottomTrayPortal from '../components/BottomTrayPortal'
import { isIOS } from '../lib/device'
import { getBodyFontFamily, getMonospaceFontFamily, getMonospaceFontSize, getTitleFontFamily } from '../lib/fonts'
import { editorHighlights } from '../lib/editorHighlights'
import { addDays, formatHumanDate, getTodayId, parseDayId } from '../lib/dates'
import type { Day } from '../lib/dayRepository'
import { searchDays, appendToDay } from '../lib/dayRepository'
import { chat } from '../lib/llm'
import type { ChatMessage as LlmMessage } from '../lib/llm'
import { buildContextDays, formatContext } from '../lib/llmContext'
import { buttonPrimary } from '../lib/ui'
import { useSettingsStore } from '../store/useSettingsStore'
import { useSyncStore } from '../store/useSyncStore'
import { useDaysStore } from '../store/useDaysStore'
import { useUIStore } from '../store/useUIStore'
import { pushToSyncAndRefresh } from '../store/syncActions'

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

const TODO_MARKER_REGEX = /^(\s*-\s+\[)([ xX])(\])/

const getTodoMarker = (line: Line) => {
  const match = line.text.match(TODO_MARKER_REGEX)
  if (!match) return null
  const markerStartOffset = match.index ?? 0
  const markerFrom = line.from + markerStartOffset
  const markerTo = markerFrom + match[0].length
  const bracketFrom = line.from + match[1].length - 1
  const bracketTo = markerTo
  const toggleFrom = line.from + match[1].length
  return {
    markerFrom,
    markerTo,
    bracketFrom,
    bracketTo,
    toggleFrom,
    toggleTo: toggleFrom + 1,
    value: match[2],
  }
}

const getToggleValue = (value: string) => (value.toLowerCase() === 'x' ? ' ' : 'x')

const toggleTodoAtPos = (view: EditorView, pos: number) => {
  const line = view.state.doc.lineAt(pos)
  const marker = getTodoMarker(line)
  if (!marker) return false
  if (pos < marker.bracketFrom || pos >= marker.bracketTo) return false
  view.dispatch({
    changes: {
      from: marker.toggleFrom,
      to: marker.toggleTo,
      insert: getToggleValue(marker.value),
    },
  })
  return true
}

const toggleTodosInSelection = (view: EditorView) => {
  const changes: Array<{ from: number; to: number; insert: string }> = []
  const seen = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const startLine = view.state.doc.lineAt(range.from)
    const endLine = view.state.doc.lineAt(range.to)
    for (let number = startLine.number; number <= endLine.number; number += 1) {
      const line = view.state.doc.line(number)
      const marker = getTodoMarker(line)
      if (!marker) continue
      const isCursor = range.from === range.to
      if (!isCursor) {
        const lineIntersects = range.from < line.to && range.to > line.from
        if (!lineIntersects) continue
      }
      if (seen.has(marker.toggleFrom)) continue
      seen.add(marker.toggleFrom)
      changes.push({
        from: marker.toggleFrom,
        to: marker.toggleTo,
        insert: getToggleValue(marker.value),
      })
    }
  }

  if (!changes.length) return false
  changes.sort((a, b) => a.from - b.from)
  view.dispatch({ changes })
  return true
}

const todoPointerHandler = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    if (event.button !== 0) return false
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos == null) return false
    if (!toggleTodoAtPos(view, pos)) return false
    view.focus()
    return true
  },
  touchstart: (event, view) => {
    const touch = event.touches.item(0)
    if (!touch) return false
    const pos = view.posAtCoords({ x: touch.clientX, y: touch.clientY })
    if (pos == null) return false
    if (!toggleTodoAtPos(view, pos)) return false
    event.preventDefault()
    return true
  },
})

const todoKeymap = Prec.high(
  keymap.of([
    {
      key: 'Mod-Enter',
      run: (view) => toggleTodosInSelection(view),
    },
  ]),
)

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

// --- Types ---

type TimelineDayCard = {
  day: Day
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
  isFuture: boolean
  isToday: boolean
  isYesterday: boolean
  isTomorrow: boolean
  heroReveal: boolean
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
  titleFontFamily: string
  previousDayId: string | null
  nextDayId: string | null
  onChange: (dayId: string, value: string) => void
  onBlur: (dayId: string, event?: FocusEvent) => void
  onDelete: (dayId: string) => void
  onDateChange: (dayId: string, nextDayId: string) => void
  onFocusDay: (dayId: string, position: 'start' | 'end') => void
  registerEditor: (dayId: string, view: EditorView | null) => void
  registerDayRef: (dayId: string, node: HTMLDivElement | null) => void
}

const DayEditorCard = memo(({
  day,
  isFuture,
  isToday,
  isYesterday,
  isTomorrow,
  heroReveal,
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
  titleFontFamily,
  previousDayId,
  nextDayId,
  onChange,
  onBlur,
  onDelete,
  onDateChange,
  onFocusDay,
  registerEditor,
  registerDayRef,
}: DayEditorCardProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const hoverTimeoutRef = useRef<number | null>(null)
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)
  const [showDesktopDelete, setShowDesktopDelete] = useState(false)
  const searchHighlight = useMemo(() => createHighlightPlugin(searchQuery), [searchQuery])
  const quoteHighlight = useMemo(() => (quote ? createHighlightPlugin(quote) : null), [quote])

  useEffect(() => {
    return () => {
      registerEditor(day.dayId, null)
    }
  }, [day.dayId, registerEditor])

  useEffect(() => {
    if (!showDeleteMenu) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return
      }
      setShowDeleteMenu(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [showDeleteMenu])

  const clearHoverTimeout = () => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
  }

  const handleHoverStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return
    setShowDesktopDelete(true)
    clearHoverTimeout()
    hoverTimeoutRef.current = window.setTimeout(() => {
      setShowDesktopDelete(false)
    }, 10000)
  }

  const handleHoverEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return
    clearHoverTimeout()
    setShowDesktopDelete(false)
  }

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        window.clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      document.body.dataset.dayEditorFocus = 'false'
    }
  }, [])

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
      todoKeymap,
      todoPointerHandler,
      ...editorHighlights,
    ]
    if (searchHighlight) {
      extensions.push(searchHighlight)
    }
    if (quoteHighlight) {
      extensions.push(quoteHighlight)
    }
    return extensions
  }, [clearActiveLine, editorTheme, markdownExtension, navigationKeymap, quoteHighlight, searchHighlight])

  const handleOpenDatePicker = () => {
    const input = dateInputRef.current
    if (!input) return
    const picker = (input as HTMLInputElement & { showPicker?: () => void }).showPicker
    if (picker) {
      picker.call(input)
      return
    }
    input.focus()
    input.click()
  }

  return (
    <div
      ref={(node) => {
        containerRef.current = node
        registerDayRef(day.dayId, node)
      }}
      onPointerEnter={handleHoverStart}
      onPointerLeave={handleHoverEnd}
      data-scroll-target={isToday ? 'today' : undefined}
      className={`scroll-anchor group rounded-[4px] border p-4 transition ${
        heroReveal ? 'hero-reveal' : ''
      } ${
        isFuture
          ? 'border-dashed border-slate-200/60 bg-white/70 shadow-[0_4px_6px_-4px_rgba(0,0,0,0.05),0_2px_8px_rgba(0,0,0,0.03)] hover:border-slate-300/60'
          : 'border-slate-200/60 bg-white shadow-[0_6px_6px_-4px_rgba(0,0,0,0.10),0_2px_12px_rgba(0,0,0,0.06)] hover:border-slate-300/60'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="relative flex items-center gap-2 text-left" onClick={handleOpenDatePicker}>
          <h3
            className={`day-title ${
              isToday ? 'text-[1.8rem]' : isYesterday || isTomorrow ? 'text-[1.5rem]' : 'text-[1.3rem]'
            } ${isFuture ? 'opacity-70' : ''}`}
            style={{ fontFamily: titleFontFamily }}
          >
            {relativeLabel ? (
              <>
                <span className="font-bold text-[#113355]">{relativeLabel}</span>
                <span className="ml-2 font-normal text-[#8899aa]">{humanDate}</span>
              </>
            ) : weekdayPart ? (
              <>
                <span className="font-bold text-[#113355]">{datePart}</span>
                <span className="ml-2 font-normal text-[#8899aa]">{weekdayPart}</span>
              </>
            ) : (
              <span className="font-bold text-[#113355]">{title}</span>
            )}
          </h3>
          <input
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            type="date"
            aria-label={`Change date for ${day.dayId}`}
            value={day.dayId}
            ref={dateInputRef}
            onChange={(event) => void onDateChange(day.dayId, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <div ref={menuRef} className="relative touch-actions">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300"
              type="button"
              aria-label="Open note actions"
              onClick={() => setShowDeleteMenu((state) => !state)}
            >
              <img src="/dots-three.svg" alt="" className="h-4 w-4 opacity-70" />
            </button>
            {showDeleteMenu && (
              <div className="absolute right-0 top-10 z-10 min-w-[150px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                  type="button"
                  onClick={() => {
                    setShowDeleteMenu(false)
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
                  Delete note
                </button>
              </div>
            )}
          </div>
          <button
            className={`hidden h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 sm:flex touch-hide ${
              showDesktopDelete ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            type="button"
            aria-label="Delete"
            onClick={() => {
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
          onFocus={() => {
            document.body.dataset.dayEditorFocus = 'true'
          }}
          onBlur={(event) => void onBlur(day.dayId, event.nativeEvent)}
          onCreateEditor={(view) => registerEditor(day.dayId, view)}
          basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLineGutter: false }}
        />
      </div>
    </div>
  )
})

type TrayInputMode = 'chat' | 'search'

type TrayInputProps = {
  mode: TrayInputMode
  sending: boolean
  chatError: string | null
  noSearchResults: boolean
  onChatSubmit: (value: string) => Promise<void>
  onSearchTextChange: (value: string) => void
}

type TrayInputConfig = {
  placeholder: string
  icon: string
  id: string
  enterKeyHint: 'send' | 'search'
}

const TrayInput = memo(({
  mode,
  sending,
  chatError,
  noSearchResults,
  onChatSubmit,
  onSearchTextChange,
}: TrayInputProps) => {
  const [draftText, setDraftText] = useState('')
  const debounceRef = useRef<number | null>(null)
  const prevModeRef = useRef<TrayInputMode>(mode)

  const inputConfig = useMemo<TrayInputConfig>(() => {
    switch (mode) {
      case 'chat':
        return {
          placeholder: 'Ask anything',
          icon: '/sparkle.svg',
          id: 'chat-input',
          enterKeyHint: 'send',
        }
      default:
        return {
          placeholder: 'Search all days',
          icon: '/magnifying-glass.svg',
          id: 'search-input',
          enterKeyHint: 'search',
        }
    }
  }, [mode])

  const activeText = draftText

  const updateDraft = useCallback(
    (value: string) => {
      setDraftText(value)
    },
    [],
  )

  useEffect(() => {
    if (mode !== 'search') return

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
    }

    debounceRef.current = window.setTimeout(() => {
      onSearchTextChange(draftText)
    }, 200)

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [draftText, mode, onSearchTextChange])

  useEffect(() => {
    const previousMode = prevModeRef.current
    prevModeRef.current = mode

    if (mode === 'search' && previousMode !== 'search') {
      onSearchTextChange(draftText)
    }
  }, [draftText, mode, onSearchTextChange])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmed = activeText.trim()
    if (!trimmed) return

    if (mode === 'chat') {
      setDraftText('')
      await onChatSubmit(activeText)
      return
    }
  }

  const handleClearSearch = () => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setDraftText('')
    onSearchTextChange('')
  }

  const showNoResults = noSearchResults && Boolean(draftText.trim())
  const showChatError = Boolean(chatError) && mode === 'chat'

  return (
    <div className="relative">
      <form className="flex items-center gap-3" onSubmit={handleSubmit}>
        <div className="relative flex-1">
          <p
            className={`absolute -top-8 left-0 z-10 w-max whitespace-nowrap rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-red-400 shadow-sm ${
              showNoResults ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            aria-hidden={!showNoResults}
          >
            No results
          </p>
          <p
            className={`absolute -top-8 left-0 z-10 w-max whitespace-nowrap rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-red-400 shadow-sm ${
              showChatError ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            aria-hidden={!showChatError}
          >
            {chatError}
          </p>
          <span
            aria-hidden="true"
            className="tray-input-icon pointer-events-none absolute left-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 opacity-80 sm:block"
            style={{
              maskImage: `url(${inputConfig.icon})`,
              WebkitMaskImage: `url(${inputConfig.icon})`,
            }}
          />
          <input
            id={inputConfig.id}
            autoComplete="off"
            type="Text"
            inputMode="text"
            className="w-full rounded-full bg-transparent py-2 pl-3 pr-3 text-base outline-none sm:pl-10"
            placeholder={inputConfig.placeholder}
            value={activeText}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.currentTarget.blur()
              }
            }}
            enterKeyHint={inputConfig.enterKeyHint}
          />
        </div>
        {mode === 'chat' && (
          <button
            className={`flex h-10 w-10 items-center justify-center rounded-full shadow-sm transition ${
              activeText.trim() && !sending ? 'bg-[#22B3FF] hover:bg-[#22B3FF]/90' : 'bg-slate-300'
            }`}
            type="submit"
            disabled={sending}
            aria-label="Send"
          >
            <img
              src="/arrow-up.svg"
              alt=""
              className="h-5 w-5"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </button>
        )}
        {mode === 'search' && activeText.trim() && (
          <button
            className="group flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-500"
            type="button"
            aria-label="Clear search"
            onClick={handleClearSearch}
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
})

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
  const { days, loading, loadTimeline, loadDay, updateDayContent, moveDayDate, deleteDay } = useDaysStore()
  const {
    loadSettings,
    geminiApiKey,
    geminiModel,
    allowThinking,
    allowWebSearch,
    aiLanguage,
    fontPreference,
    bodyFont,
    monospaceFont,
    titleFont,
  } = useSettingsStore()
  const { loadState: loadSyncState, status: syncStatus } = useSyncStore()
  const { mode } = useUIStore()
  const hasNoNotes = !loading && days.length === 0

  // Mode-specific Input State
  const [searchText, setSearchText] = useState('')
  const handleSearchTextChange = useCallback(
    (nextValue: string) => {
      setSearchText(nextValue)
    },
    [setSearchText],
  )

  // Chat State
  const [messages, setMessages] = useState<ChatUiMessage[]>([])
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const messagesRef = useRef<ChatUiMessage[]>([])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Search State
  const [searchResults, setSearchResults] = useState<Day[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [dateErrors, setDateErrors] = useState<Record<string, string | null>>({})
  const [highlightedQuote, setHighlightedQuote] = useState<Citation | null>(null)
  const [isLogoAnimating, setIsLogoAnimating] = useState(false)
  const [isHeroRevealActive, setIsHeroRevealActive] = useState(false)
  const [isHeroRevealHold, setIsHeroRevealHold] = useState(false)

  const canSync = Boolean(syncStatus.connected && syncStatus.filePath)
  const rawSearchQuery = mode === 'search' ? searchText.trim() : ''
  const deferredSearchQuery = useDeferredValue(rawSearchQuery)
  const searchQuery = mode === 'search' ? deferredSearchQuery : ''
  const todayId = getTodayId()
  const yesterdayId = addDays(todayId, -1)
  const tomorrowId = addDays(todayId, 1)
  const heroFadeDuration = 600
  const heroRevealFallback = 1000
  const heroLogoDuration = 600
  const isIosDevice = isIOS()

  const hasRestoredScroll = useRef(false)
  const editorRefs = useRef(new Map<string, EditorView>())
  const dayRefs = useRef(new Map<string, HTMLDivElement>())
  const saveTimeouts = useRef(new Map<string, number>())
  const createdDayIdsRef = useRef(new Set<string>())
  const pendingFocusRef = useRef<{ dayId: string; position: 'start' | 'end' } | null>(null)
  const highlightTimeoutRef = useRef<number | null>(null)
  const addTodayRef = useRef<HTMLDivElement | null>(null)
  const heroLogoRef = useRef<HTMLImageElement | null>(null)
  const heroRevealPending = useRef(false)

  const markdownExtension = useMemo(() => markdown({ base: markdownLanguage }), [])
  const editorTheme = useMemo(
    () =>
      EditorView.theme({
        '&': {
          backgroundColor: 'transparent',
        },
        '.cm-scroller': {
          fontSize:
            fontPreference === 'monospace'
              ? isIosDevice && monospaceFont === 'iawriter'
                ? '1rem'
                : getMonospaceFontSize(monospaceFont)
              : '1rem',
          fontWeight: '400',
          fontFamily:
            fontPreference === 'monospace'
              ? getMonospaceFontFamily(monospaceFont)
              : getBodyFontFamily(bodyFont),
          fontSynthesis: 'weight style',
          color: '#000000',
        },
        '.cm-content': {
          minHeight: '30px',
          padding: '0',
        },
        '.cm-gutters': {
          display: 'none',
        },
        '.cm-cursor, .cm-dropCursor': {
          borderLeft: '2px solid #22B3FF',
          borderRadius: '2px',
        },
      }),
    [fontPreference, bodyFont, monospaceFont, isIosDevice],
  )
  const titleFontFamily = useMemo(() => getTitleFontFamily(titleFont), [titleFont])
  const heroFontFamily = useMemo(() => getTitleFontFamily('handlee'), [])
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

  useEffect(() => {
    document.body.style.setProperty('--hero-fade-ms', `${heroFadeDuration}ms`)
    return () => {
      document.body.style.removeProperty('--hero-fade-ms')
    }
  }, [heroFadeDuration])

  useLayoutEffect(() => {
    if (hasNoNotes || isLogoAnimating) {
      document.body.dataset.emptyState = 'true'
    } else {
      delete document.body.dataset.emptyState
    }

    if (hasNoNotes && !isLogoAnimating) {
      document.body.dataset.heroWallpaper = 'true'
    } else {
      delete document.body.dataset.heroWallpaper
    }

    if (hasNoNotes && !isLogoAnimating) {
      document.body.dataset.heroUi = 'true'
    } else {
      delete document.body.dataset.heroUi
    }
  }, [hasNoNotes, isLogoAnimating])

  useLayoutEffect(() => {
    if (hasNoNotes) return
    if (!heroRevealPending.current) return

    heroRevealPending.current = false
    setIsHeroRevealActive(true)
    setIsHeroRevealHold(true)
  }, [hasNoNotes])

  useLayoutEffect(() => {
    if (!isHeroRevealHold) {
      delete document.body.dataset.heroReveal
      return
    }

    document.body.dataset.heroReveal = 'true'
  }, [isHeroRevealHold])


  useEffect(() => {
    return () => {
      delete document.body.dataset.emptyState
      delete document.body.dataset.heroWallpaper
      delete document.body.dataset.heroUi
      delete document.body.dataset.heroReveal
    }
  }, [])

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

  // Search
  useEffect(() => {
    if (mode !== 'search') return

    if (!searchText.trim()) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    let cancelled = false
    setSearchLoading(true)
    setSearchError(null)

    const runSearch = async () => {
      try {
        const data = await searchDays(searchText)
        if (cancelled) return
        setSearchResults(data)
      } catch {
        if (cancelled) return
        setSearchError('Search failed. Try again.')
        setSearchResults([])
      } finally {
        if (!cancelled) {
          setSearchLoading(false)
        }
      }
    }

    void runSearch()

    return () => {
      cancelled = true
    }
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
      await pushToSyncAndRefresh()
    } catch {
      // Ignore auto-push errors
    }
  }, [canSync, pushToSyncAndRefresh])

  const runLogoTransition = useCallback(() => {
    const heroLogo = heroLogoRef.current
    const headerLogo = document.querySelector<HTMLImageElement>('.app-logo')
    if (!heroLogo || !headerLogo) return false
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false

    const heroRect = heroLogo.getBoundingClientRect()
    const headerRect = headerLogo.getBoundingClientRect()
    if (!heroRect.width || !heroRect.height || !headerRect.width || !headerRect.height) return false

    const clone = heroLogo.cloneNode(true) as HTMLImageElement
    clone.style.position = 'fixed'
    clone.style.left = `${heroRect.left}px`
    clone.style.top = `${heroRect.top}px`
    clone.style.width = `${heroRect.width}px`
    clone.style.height = `${heroRect.height}px`
    clone.style.margin = '0'
    clone.style.pointerEvents = 'none'
    clone.style.zIndex = '60'
    clone.style.transformOrigin = 'top left'
    clone.style.transition = `transform ${heroLogoDuration}ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity ${heroFadeDuration}ms ease`

    document.body.appendChild(clone)
    setIsLogoAnimating(true)

    const deltaX = headerRect.left - heroRect.left
    const deltaY = headerRect.top - heroRect.top
    const scaleX = headerRect.width / heroRect.width
    const scaleY = headerRect.height / heroRect.height

    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      clone.remove()
      setIsLogoAnimating(false)
    }

    const timeout = window.setTimeout(finish, heroLogoDuration + 100)
    clone.addEventListener(
      'transitionend',
      () => {
        window.clearTimeout(timeout)
        finish()
      },
      { once: true },
    )

    requestAnimationFrame(() => {
      clone.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`
    })

    return true
  }, [])

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

  const focusDayEditor = useCallback(
    (dayId: string, position: 'start' | 'end', shouldScroll = true) => {
    const view = editorRefs.current.get(dayId)
    if (!view) return false
    const target = position === 'end' ? view.state.doc.length : 0
    view.dispatch({ selection: EditorSelection.single(target), scrollIntoView: shouldScroll })
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
    (
      dayId: string,
      focusPosition?: 'start' | 'end',
      scrollBlock: ScrollLogicalPosition = 'center',
      focusScroll = true,
    ) => {
      let attempts = 0
      const maxAttempts = 12
      const run = () => {
        const node = dayRefs.current.get(dayId)
        const view = editorRefs.current.get(dayId)
        if (node) {
          node.scrollIntoView({ behavior: 'smooth', block: scrollBlock })
        }
        if (focusPosition && view) {
          focusDayEditor(dayId, focusPosition, focusScroll)
        }
        if ((!node || (focusPosition && !view)) && attempts < maxAttempts) {
          attempts += 1
          requestAnimationFrame(run)
        }
      }
      requestAnimationFrame(run)
    },
    [focusDayEditor],
  )

  const handleCreateDay = useCallback(
    async (
      dayId: string,
      options?: {
        focusPosition?: 'start' | 'end'
        scrollBlock?: ScrollLogicalPosition
        focusScroll?: boolean
      },
    ) => {
      const { focusPosition = 'end', scrollBlock = 'center', focusScroll = true } = options ?? {}
      pendingFocusRef.current = { dayId, position: focusPosition }
      const result = await loadDay(dayId)
      if (result.created) {
        createdDayIdsRef.current.add(dayId)
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
      revealDay(dayId, focusPosition, scrollBlock, focusScroll)
      if (editorRefs.current.has(dayId)) {
        pendingFocusRef.current = null
      }
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

      document.body.dataset.dayEditorFocus = 'false'

      const view = editorRefs.current.get(dayId)
      const content = view?.state.doc.toString() ?? ''
      if (!content.trim() && createdDayIdsRef.current.has(dayId)) {
        if (days.length <= 1) {
          return
        }
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
    [days, deleteDay, handleAutoPush],
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

  const registerEditor = useCallback(
    (dayId: string, view: EditorView | null) => {
      if (view) {
        editorRefs.current.set(dayId, view)
        const pending = pendingFocusRef.current
        if (pending && pending.dayId === dayId) {
          focusDayEditor(dayId, pending.position, false)
          pendingFocusRef.current = null
        }
        return
      }
      editorRefs.current.delete(dayId)
    },
    [focusDayEditor],
  )

  const registerDayRef = useCallback((dayId: string, node: HTMLDivElement | null) => {
    if (node) {
      dayRefs.current.set(dayId, node)
      return
    }
    dayRefs.current.delete(dayId)
  }, [])

  const handleChatSend = useCallback(
    async (draft: string) => {
      const trimmed = draft.trim()
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
      setSending(true)

      const currentMessages = [...messagesRef.current, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      })) as LlmMessage[]

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

        console.info('[LLM Request]', {
          messageCount: llmMessages.length,
          contextDays: contextDays.length,
          contextChars: contextText.length,
          userChars: trimmed.length,
        })

        const { text: responseText } = await chat({
          provider: 'gemini',
          apiKey: geminiApiKey,
          model: geminiModel,
          messages: llmMessages,
          allowThinking,
          allowWebSearch,
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

        const sanitized = responseText.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
        console.info('[LLM Response]', { chars: responseText.length, sanitizedChars: sanitized.length })

        let payload: AssistantPayload | null = null
        try {
          payload = JSON.parse(sanitized) as AssistantPayload
          console.info('[LLM Parsed]', { hasCitations: Boolean(payload.citations?.length) })
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
    },
    [
      aiLanguage,
      buildContextDays,
      chat,
      formatContext,
      geminiApiKey,
      geminiModel,
      setChatError,
      setMessages,
      setSending,
    ],
  )

  const handleChatInsert = async (message: ChatUiMessage) => {
    const insertText = message.meta?.insertText
    if (!insertText) return

    const targetDay = message.meta?.insertTargetDay ?? getTodayId()
    const payload = `${insertText.trim()}`
    await appendToDay(targetDay, payload)
    await loadTimeline()
    await handleAutoPush()
  }

  const handleEmptyCta = useCallback(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!prefersReducedMotion) {
      heroRevealPending.current = true
    }
    runLogoTransition()
    void handleCreateDay(todayId)
  }, [handleCreateDay, runLogoTransition, todayId])


  // --- Computed Data ---

  // Standard Timeline Cards
  const timelineCards = useMemo<TimelineDayCard[]>(() => days.map((day) => ({ day })), [days])

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

  const handleScrollToToday = useCallback(() => {
    if (hasToday) {
      revealDay(todayId, undefined, 'start')
      return
    }
    addTodayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hasToday, revealDay, todayId])

  const handleFocusToday = useCallback(async () => {
    if (hasToday) {
      const hasEditor = editorRefs.current.has(todayId)
      if (!hasEditor) {
        pendingFocusRef.current = { dayId: todayId, position: 'end' }
      }
      revealDay(todayId, 'end', 'start', false)
      if (hasEditor) {
        focusDayEditor(todayId, 'end', false)
      }
      return
    }

    await handleCreateDay(todayId, {
      focusPosition: 'end',
      scrollBlock: 'start',
      focusScroll: false,
    })
  }, [focusDayEditor, handleCreateDay, hasToday, revealDay, todayId])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key !== 'n' && key !== 't') return
      if (isEditableElement(document.activeElement as HTMLElement | null)) return
      event.preventDefault()
      if (key === 'n') {
        const targetDayId = hasToday ? futureDayId : todayId
        void handleCreateDay(targetDayId, {
          focusPosition: 'start',
          scrollBlock: 'start',
          focusScroll: false,
        })
        return
      }
      handleScrollToToday()
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [futureDayId, handleCreateDay, handleScrollToToday, hasToday, todayId])

  useEffect(() => {
    const handleFocusEvent = () => {
      void handleFocusToday()
    }
    window.addEventListener('timeline-focus-today', handleFocusEvent)
    return () => window.removeEventListener('timeline-focus-today', handleFocusEvent)
  }, [handleFocusToday])

  useEffect(() => {
    const handleScrollEvent = () => {
      handleScrollToToday()
    }
    window.addEventListener('timeline-scroll-today', handleScrollEvent)
    return () => window.removeEventListener('timeline-scroll-today', handleScrollEvent)
  }, [handleScrollToToday])

  useEffect(() => {
    const blurFocusedEditor = () => {
      for (const view of editorRefs.current.values()) {
        if (view.hasFocus) {
          view.contentDOM.blur()
        }
      }
      document.body.dataset.dayEditorFocus = 'false'
    }

    const getPoint = (event: Event) => {
      if (event instanceof TouchEvent) {
        const touch = event.changedTouches[0]
        if (!touch) return null
        return { x: touch.clientX, y: touch.clientY }
      }
      if (event instanceof MouseEvent) {
        return { x: event.clientX, y: event.clientY }
      }
      return null
    }

    const isInsideAnyCard = (x: number, y: number) => {
      for (const node of dayRefs.current.values()) {
        const rect = node.getBoundingClientRect()
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return true
        }
      }
      return false
    }

    const handleOutsidePointer = (event: Event) => {
      const point = getPoint(event)
      if (!point) return
      if (isInsideAnyCard(point.x, point.y)) return
      requestAnimationFrame(blurFocusedEditor)
    }

    document.addEventListener('pointerdown', handleOutsidePointer, { capture: true })
    document.addEventListener('mousedown', handleOutsidePointer, { capture: true })
    document.addEventListener('touchstart', handleOutsidePointer, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer, { capture: true })
      document.removeEventListener('mousedown', handleOutsidePointer, { capture: true })
      document.removeEventListener('touchstart', handleOutsidePointer, { capture: true })
    }
  }, [])

  const standardItems = useMemo<TimelineItem[]>(() => {
    // Case: No cards at all -> show only +Today
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
    return searchResults.map((day) => ({
      type: 'day',
      card: { day },
    }))
  }, [mode, searchText, searchResults])

  // Active Items
  const activeItems = (mode === 'search' && searchText.trim() && searchResults.length > 0) ? searchCards : standardItems

  useEffect(() => {
    if (!isHeroRevealHold) return

    const isReadyToReveal = () => {
      const hasTodayCard = dayRefs.current.has(todayId)
      const hasTomorrowItem = activeItems.some(
        (item) => item.type === 'add-future' && item.dayId === tomorrowId,
      )
      const hasTomorrowButton =
        hasTomorrowItem && Boolean(document.querySelector("[data-hero-tomorrow='true']"))
      return hasTodayCard && hasTomorrowButton
    }

    const startFade = () => {
      setIsHeroRevealHold(false)
      window.setTimeout(() => {
        setIsHeroRevealActive(false)
      }, heroFadeDuration)
    }

    const raf = window.requestAnimationFrame(() => {
      if (isReadyToReveal()) {
        startFade()
      }
    })

    const fallback = window.setTimeout(() => {
      startFade()
    }, heroRevealFallback)

    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(fallback)
    }
  }, [activeItems, heroFadeDuration, heroRevealFallback, isHeroRevealHold, todayId, tomorrowId])

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
  const noSearchResults =
    mode === 'search' &&
    !searchLoading &&
    Boolean(searchText.trim()) &&
    searchResults.length === 0 &&
    !searchError

  // --- Render ---

  const trayContent =
    mode === 'timeline' ? null : (
      <TrayInput
        mode={mode}
        sending={sending}
        chatError={chatError}
        noSearchResults={noSearchResults}
        onChatSubmit={handleChatSend}
        onSearchTextChange={handleSearchTextChange}
      />
    )

  return (
    <div className={mode === 'chat' ? 'pb-[40vh]' : undefined}>
      {trayContent ? <BottomTrayPortal>{trayContent}</BottomTrayPortal> : null}

      {/* Chat Panel - Fixed Overlay */}
      {mode === 'chat' && (
        <div className="fixed bottom-24 left-0 right-0 z-20 mx-auto w-[min(96%,720px)] px-4">
          <div className={`pointer-events-none absolute -bottom-24 -inset-x-8 -top-4 -z-10 bg-white/30 backdrop-blur-md transition-opacity duration-500 [mask-image:linear-gradient(to_bottom,transparent,black_40%)] ${messages.length > 0 ? 'opacity-100' : 'opacity-0'}`} />
          <div className="flex max-h-[50vh] flex-col-reverse gap-3 overflow-y-auto p-6">
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

      {hasNoNotes && (
        <section className="hero-empty relative my-auto flex min-h-[60vh] flex-col items-center justify-center gap-8 px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="absolute -right-16 -top-20 h-44 w-44 rounded-full bg-[#22B3FF]/10 blur-3xl" aria-hidden="true" />
          <div className="absolute -bottom-24 -left-10 h-36 w-36 rounded-full bg-[#22B3FF]/10 blur-3xl" aria-hidden="true" />
          <div className="relative flex items-center justify-center">
            <span className="absolute -inset-6 rounded-full bg-white/70 blur-2xl" aria-hidden="true" />
            <img
              ref={heroLogoRef}
              src="/logo.png"
              alt=""
              className={`hero-logo relative h-16 w-auto drop-shadow-[0_12px_30px_rgba(15,23,42,0.16)] transition-opacity duration-300 sm:h-20 ${
                isLogoAnimating ? 'opacity-0' : 'opacity-100'
              }`}
            />
          </div>
          <div className="hero-copy max-w-[550px] space-y-4" style={{ fontFamily: heroFontFamily }}>
            <p className="text-2xl text-slate-600">
              Rivolo replaces notes{' '}
              <br className="hero-break" />
              with a daily flow.
            </p>
            <p className="text-2xl text-slate-600">
              Structure emerges only{' '}
              <br className="hero-break" />
              when you ask for it.
            </p>
            <p className="text-2xl text-slate-600">
              Stop organizing. Start writing.
            </p>
          </div>
          <div className="flex flex-col items-center gap-4">
            <button
              className={`${buttonPrimary} px-6 py-3 text-base`}
              type="button"
              onClick={handleEmptyCta}
            >
              Start Today
            </button>
            <p></p>
          </div>
        </section>
      )}

      {/* Main List */}
      {!loading && !hasNoNotes && activeItems.length > 0 && (
        <div className="space-y-3">
          {activeItems.map((item, index) => {
            if (item.type === 'add-today') {
              return (
                <div
                  key={`add-${item.dayId}`}
                  ref={(node) => {
                    addTodayRef.current = node
                  }}
                  data-scroll-target="today"
                  className="scroll-anchor flex justify-center"
                >
                  <button
                    className="group inline-flex items-center gap-2 rounded-full bg-transparent px-3 py-1 text-sm font-semibold text-[#22B3FF] transition hover:text-[#22B3FF]/80"
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
              const isTomorrowButton = item.dayId === tomorrowId
              return (
                <div
                  key={`add-future-${item.dayId}`}
                  data-hero-tomorrow={isTomorrowButton ? 'true' : undefined}
                  className={`flex justify-center ${
                    isHeroRevealActive && isTomorrowButton ? 'hero-reveal' : ''
                  }`}
                >
                  <button
                    className="group inline-flex items-center gap-2 rounded-full bg-transparent px-3 py-1 text-sm font-semibold text-[#22B3FF] opacity-70 transition hover:text-[#22B3FF]/80"
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

            const { day } = item.card
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
                  isFuture={isFuture}
                  isToday={isToday}
                  isYesterday={isYesterday}
                  isTomorrow={isTomorrow}
                  heroReveal={isHeroRevealActive && isToday}
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
                titleFontFamily={titleFontFamily}
                previousDayId={previousDayId}
                nextDayId={nextDayId}
                onChange={handleEditorChange}
                onBlur={handleEditorBlur}
                onDelete={handleDeleteDay}
                onDateChange={handleDateCommit}
                onFocusDay={focusDayEditor}
                registerEditor={registerEditor}
                registerDayRef={registerDayRef}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
