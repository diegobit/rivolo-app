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
import { debugLog, getNowMs, startDebugTimer, toElapsedMs } from '../lib/debugLogs'
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

const areStringSetsEqual = (a: Set<string>, b: Set<string>) => {
  if (a.size !== b.size) return false

  for (const value of a) {
    if (!b.has(value)) {
      return false
    }
  }

  return true
}

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

const normalizeCitationText = (value: string) =>
  value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

const normalizeCitationMatchText = (value: string) =>
  value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .toLowerCase()

const findQuoteOffset = (text: string, quote: string) => {
  const trimmedQuote = quote.trim()
  if (!trimmedQuote) return -1

  const exactIndex = text.indexOf(trimmedQuote)
  if (exactIndex >= 0) {
    return exactIndex
  }

  const lowerIndex = text.toLowerCase().indexOf(trimmedQuote.toLowerCase())
  if (lowerIndex >= 0) {
    return lowerIndex
  }

  return normalizeCitationMatchText(text).indexOf(normalizeCitationMatchText(trimmedQuote))
}

const stripCodeFences = (value: string) => value.replace(/```json\s*/gi, '').replace(/```/g, '').trim()

const extractFirstJsonObject = (value: string) => {
  let start = -1
  let depth = 0
  let inString = false
  let escaping = false

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]

    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }
      if (char === '\\') {
        escaping = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      if (depth === 0) {
        start = index
      }
      depth += 1
      continue
    }

    if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start !== -1) {
        return value.slice(start, index + 1)
      }
    }
  }

  return null
}

const parseAssistantPayload = (responseText: string): AssistantPayload | null => {
  const trimmed = responseText.trim()
  const sanitized = stripCodeFences(trimmed)
  const candidates = [trimmed, sanitized]
  const extracted = extractFirstJsonObject(sanitized)

  if (extracted) {
    candidates.push(extracted)
  }

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate) as {
        answer?: unknown
        citations?: unknown
        insert_text?: unknown
        insert_target_day?: unknown
      }

      if (typeof parsed.answer !== 'string') {
        continue
      }

      const citations = Array.isArray(parsed.citations)
        ? parsed.citations.flatMap((citation) => {
            if (!citation || typeof citation !== 'object') {
              return []
            }

            const typedCitation = citation as { day?: unknown; quote?: unknown }
            if (typeof typedCitation.day !== 'string' || typeof typedCitation.quote !== 'string') {
              return []
            }

            return [{ day: typedCitation.day, quote: typedCitation.quote }]
          })
        : undefined

      const insertText =
        typeof parsed.insert_text === 'string' || parsed.insert_text === null ? parsed.insert_text : null

      const insertTargetDay =
        typeof parsed.insert_target_day === 'string' || parsed.insert_target_day === null
          ? parsed.insert_target_day
          : null

      return {
        answer: parsed.answer,
        citations,
        insert_text: insertText,
        insert_target_day: insertTargetDay,
      }
    } catch {
      continue
    }
  }

  return null
}

type DayEditorCardProps = {
  day: Day
  shouldMountEditor: boolean
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
  onRequestEditorMount: (dayId: string, position: 'start' | 'end') => void
  registerEditor: (dayId: string, view: EditorView | null) => void
  registerDayRef: (dayId: string, node: HTMLDivElement | null) => void
}

const DayEditorCard = memo(({
  day,
  shouldMountEditor,
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
  onRequestEditorMount,
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
  const previewContent = useMemo(() => {
    const trimmed = day.contentMd.trim()
    if (!trimmed) {
      return ' '
    }

    return trimmed
      .split('\n')
      .slice(0, 14)
      .join('\n')
  }, [day.contentMd])

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

  const handleContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node
      registerDayRef(day.dayId, node)
    },
    [day.dayId, registerDayRef],
  )

  return (
    <div
      ref={handleContainerRef}
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
        {shouldMountEditor ? (
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
        ) : (
          <button
            className="block min-h-[34px] w-full cursor-text rounded-xl border border-slate-100 bg-white px-2 py-1 text-left text-[0.98rem] leading-6 text-slate-700 transition hover:border-slate-200"
            type="button"
            aria-label={`Edit note for ${day.dayId}`}
            onClick={() => onRequestEditorMount(day.dayId, 'end')}
          >
            <pre className="max-h-64 overflow-hidden whitespace-pre-wrap break-words font-inherit text-inherit">
              {previewContent}
            </pre>
          </button>
        )}
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

const OLDER_DAYS_OBSERVER_MARGIN = '350px 0px 550px 0px'
const INITIAL_EDITOR_MOUNT_COUNT = 6
const EDITOR_HYDRATE_OBSERVER_MARGIN = '70% 0px 90% 0px'
const EDITOR_PIN_TTL_MS = 20_000
const EDITOR_PIN_PRUNE_INTERVAL_MS = 4_000
const LOG_SCOPE = 'TimelinePerf'

type EditorPinReason = 'interaction' | 'citation' | 'loadDay' | 'dateMove' | 'edit'

// --- Component ---

export default function Timeline() {
  const {
    days,
    loading,
    loadingMore,
    hasMorePast,
    loadTimeline,
    loadOlderDays,
    loadDay,
    updateDayContent,
    moveDayDate,
    deleteDay,
  } = useDaysStore()
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
  const {
    mode,
    chatPanelOpen,
    setChatPanelOpen,
    desktopChatPanelOpen,
    setDesktopChatPanelOpen,
    setChatMessageCount,
  } = useUIStore()
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

  useEffect(() => {
    setChatMessageCount(messages.length)
  }, [messages.length, setChatMessageCount])

  // Search State
  const [searchResults, setSearchResults] = useState<Day[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [dateErrors, setDateErrors] = useState<Record<string, string | null>>({})
  const [highlightedQuote, setHighlightedQuote] = useState<Citation | null>(null)
  const [isLogoAnimating, setIsLogoAnimating] = useState(false)
  const [isHeroRevealActive, setIsHeroRevealActive] = useState(false)
  const [isHeroRevealHold, setIsHeroRevealHold] = useState(false)
  const [mountedDayIds, setMountedDayIds] = useState<Set<string>>(() => new Set())
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 639px)').matches
  })

  const canSync = Boolean(syncStatus.connected && syncStatus.filePath)
  const rawSearchQuery = mode === 'search' ? searchText.trim() : ''
  const deferredSearchQuery = useDeferredValue(rawSearchQuery)
  const searchQuery = mode === 'search' ? deferredSearchQuery : ''
  const isTimelineVisible = mode !== 'search'
  const hasChatMessages = messages.length > 0
  const showDesktopChatMode = mode === 'chat' && !isNarrowViewport && hasChatMessages
  const showDesktopChatPanel = showDesktopChatMode && desktopChatPanelOpen
  const showMobileChatOverlay = mode === 'chat' && isNarrowViewport && chatPanelOpen
  const todayId = getTodayId()
  const yesterdayId = addDays(todayId, -1)
  const tomorrowId = addDays(todayId, 1)
  const heroFadeDuration = 600
  const heroRevealFallback = 1000
  const heroLogoDuration = 600
  const isIosDevice = isIOS()
  const supportsIntersectionObserver = typeof window !== 'undefined' && 'IntersectionObserver' in window

  const hasRestoredScroll = useRef(false)
  const editorRefs = useRef(new Map<string, EditorView>())
  const dayRefs = useRef(new Map<string, HTMLDivElement>())
  const mountedDayIdsRef = useRef(new Set<string>())
  const nearViewportDayIdsRef = useRef(new Set<string>())
  const pinnedDayExpiryRef = useRef(new Map<string, number>())
  const dayOrderRef = useRef<string[]>([])
  const maxMountedCountRef = useRef(0)
  const hydrationRequestedAtRef = useRef(new Map<string, number>())
  const dayHydrationObserverRef = useRef<IntersectionObserver | null>(null)
  const olderDaysSentinelRef = useRef<HTMLDivElement | null>(null)
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
    debugLog(LOG_SCOPE, 'config', {
      initialEditorMountCount: INITIAL_EDITOR_MOUNT_COUNT,
      editorHydrateObserverMargin: EDITOR_HYDRATE_OBSERVER_MARGIN,
      olderDaysObserverMargin: OLDER_DAYS_OBSERVER_MARGIN,
      editorPinTtlMs: EDITOR_PIN_TTL_MS,
      editorPinPruneIntervalMs: EDITOR_PIN_PRUNE_INTERVAL_MS,
    })
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 639px)')

    const updateViewport = () => {
      setIsNarrowViewport(mediaQuery.matches)
    }

    updateViewport()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateViewport)
      return () => {
        mediaQuery.removeEventListener('change', updateViewport)
      }
    }

    mediaQuery.addListener(updateViewport)
    return () => {
      mediaQuery.removeListener(updateViewport)
    }
  }, [])

  useEffect(() => {
    if (!showMobileChatOverlay) return

    const rootStyle = document.documentElement.style
    const bodyStyle = document.body.style
    const lockScrollY = window.scrollY
    const previousRootOverflow = rootStyle.overflow
    const previousBodyOverflow = bodyStyle.overflow
    const previousBodyOverscroll = bodyStyle.overscrollBehavior
    const previousBodyPosition = bodyStyle.position
    const previousBodyTop = bodyStyle.top
    const previousBodyLeft = bodyStyle.left
    const previousBodyRight = bodyStyle.right
    const previousBodyWidth = bodyStyle.width

    rootStyle.overflow = 'hidden'
    bodyStyle.overflow = 'hidden'
    bodyStyle.overscrollBehavior = 'none'
    bodyStyle.position = 'fixed'
    bodyStyle.top = `-${lockScrollY}px`
    bodyStyle.left = '0'
    bodyStyle.right = '0'
    bodyStyle.width = '100%'

    return () => {
      rootStyle.overflow = previousRootOverflow
      bodyStyle.overflow = previousBodyOverflow
      bodyStyle.overscrollBehavior = previousBodyOverscroll
      bodyStyle.position = previousBodyPosition
      bodyStyle.top = previousBodyTop
      bodyStyle.left = previousBodyLeft
      bodyStyle.right = previousBodyRight
      bodyStyle.width = previousBodyWidth
      window.scrollTo(0, lockScrollY)
    }
  }, [showMobileChatOverlay])

  useEffect(() => {
    const loadTimer = startDebugTimer(LOG_SCOPE, 'initialLoad')

    const run = async () => {
      await Promise.all([loadTimeline(), loadSettings(), loadSyncState()])

      const state = useDaysStore.getState()
      loadTimer.end('initialLoad:done', {
        loadedCount: state.days.length,
        hasMorePast: state.hasMorePast,
      })
    }

    void run()
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
    },
    [],
  )

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

      if (mode === 'search') {
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

      for (let index = 0; index < Math.min(INITIAL_EDITOR_MOUNT_COUNT, dayOrder.length); index += 1) {
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
    [applyMountedDayIds, mode, supportsIntersectionObserver],
  )

  const pinDayForEditorMount = useCallback(
    (dayId: string, reason: EditorPinReason, recompute = true) => {
      const now = getNowMs()
      const nextExpiry = now + EDITOR_PIN_TTL_MS
      const currentExpiry = pinnedDayExpiryRef.current.get(dayId) ?? 0
      pinnedDayExpiryRef.current.set(dayId, nextExpiry)

      if (nextExpiry - currentExpiry > 500) {
        debugLog(LOG_SCOPE, 'editorMountWindow:pin', {
          dayId,
          reason,
          ttlMs: EDITOR_PIN_TTL_MS,
        })
      }

      if (recompute) {
        recomputeMountedEditors(`pin:${reason}`)
      }
    },
    [recomputeMountedEditors],
  )

  const requestDayEditorMount = useCallback(
    (dayId: string, position: 'start' | 'end') => {
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
    [focusDayEditor, pinDayForEditorMount],
  )

  const revealDay = useCallback(
    (
      dayId: string,
      focusPosition?: 'start' | 'end',
      scrollBlock: ScrollLogicalPosition = 'center',
      focusScroll = true,
      scrollBehavior: ScrollBehavior = 'smooth',
    ) => {
      let attempts = 0
      const maxAttempts = 12
      const run = () => {
        const node = dayRefs.current.get(dayId)
        const view = editorRefs.current.get(dayId)
        if (node) {
          node.scrollIntoView({ behavior: scrollBehavior, block: scrollBlock })
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

  const scrollToCitationQuote = useCallback(async (citation: Citation) => {
    const maxAttempts = 20
    let attempts = 0

    return await new Promise<boolean>((resolve) => {
      const run = () => {
        const view = editorRefs.current.get(citation.day)

        if (!view) {
          if (attempts >= maxAttempts) {
            resolve(false)
            return
          }

          attempts += 1
          requestAnimationFrame(run)
          return
        }

        const quoteOffset = findQuoteOffset(view.state.doc.toString(), citation.quote)
        if (quoteOffset < 0) {
          resolve(false)
          return
        }

        view.dispatch({
          effects: EditorView.scrollIntoView(quoteOffset, {
            y: 'start',
            yMargin: 12,
          }),
        })

        resolve(true)
      }

      run()
    })
  }, [])

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
      pinDayForEditorMount(dayId, 'loadDay')
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
    [loadDay, pinDayForEditorMount, revealDay],
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

      recomputeMountedEditors('editorBlur')
    },
    [days, deleteDay, handleAutoPush, recomputeMountedEditors],
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
      pinDayForEditorMount(nextDayId, 'dateMove')
      await handleAutoPush()
      revealDay(nextDayId, 'end')
    },
    [handleAutoPush, moveDayDate, pinDayForEditorMount, revealDay, updateDayContent],
  )

  const handleEditorChange = useCallback(
    (dayId: string, value: string) => {
      if (value.trim() && createdDayIdsRef.current.has(dayId)) {
        createdDayIdsRef.current.delete(dayId)
      }

      pinDayForEditorMount(dayId, 'edit', false)

      setSearchResults((state) =>
        state.map((day) => (day.dayId === dayId ? { ...day, contentMd: value } : day)),
      )
      scheduleSave(dayId, value)
    },
    [pinDayForEditorMount, scheduleSave, setSearchResults],
  )


  const handleCitationClick = useCallback(
    async (citation: Citation) => {
      const wasLoaded = days.some((day) => day.dayId === citation.day)
      if (!wasLoaded) {
        await loadDay(citation.day)
      }

      pinDayForEditorMount(citation.day, 'citation')
      setHighlightedQuote(citation)

      if (isNarrowViewport) {
        setChatPanelOpen(false)
        document.getElementById('chat-input')?.blur()
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve()
            })
          })
        })
      }

      revealDay(citation.day, undefined, 'start', false, 'auto')
      const jumpedToQuote = await scrollToCitationQuote(citation)

      if (!jumpedToQuote && !wasLoaded) {
        window.setTimeout(() => {
          revealDay(citation.day, undefined, 'start', false, 'auto')
          void scrollToCitationQuote(citation)
        }, 220)
      }
    },
    [
      days,
      isNarrowViewport,
      loadDay,
      pinDayForEditorMount,
      revealDay,
      scrollToCitationQuote,
      setChatPanelOpen,
    ],
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
    [focusDayEditor, recomputeMountedEditors],
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
    [isTimelineVisible],
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
        rootMargin: EDITOR_HYDRATE_OBSERVER_MARGIN,
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
  }, [isTimelineVisible, recomputeMountedEditors, supportsIntersectionObserver])

  const handleChatSend = useCallback(
    async (draft: string) => {
      const trimmed = draft.trim()
      if (!trimmed) return

      if (isNarrowViewport && !chatPanelOpen) {
        setChatPanelOpen(true)
      }

      if (!isNarrowViewport && !desktopChatPanelOpen) {
        setDesktopChatPanelOpen(true)
      }

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
          temperature: 0,
          responseMimeType: 'application/json',
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

        let finalResponseText = responseText
        let payload = parseAssistantPayload(responseText)

        const sanitized = stripCodeFences(responseText)
        console.info('[LLM Response]', { chars: responseText.length, sanitizedChars: sanitized.length })

        if (payload) {
          console.info('[LLM Parsed]', { hasCitations: Boolean(payload.citations?.length) })
        } else {
          console.error('[LLM Parse Error]', { preview: sanitized.slice(0, 200) })

          try {
            const { text: retryText } = await chat({
              provider: 'gemini',
              apiKey: geminiApiKey,
              model: geminiModel,
              messages: llmMessages,
              allowThinking,
              allowWebSearch,
              temperature: 0,
              responseMimeType: 'application/json',
              stream: false,
            })

            finalResponseText = retryText
            payload = parseAssistantPayload(retryText)

            if (payload) {
              console.info('[LLM Retry Parsed]', { hasCitations: Boolean(payload.citations?.length) })
            } else {
              console.error('[LLM Retry Parse Error]', { preview: stripCodeFences(retryText).slice(0, 200) })
            }
          } catch (retryError) {
            console.error('[LLM Retry Error]', retryError)
          }
        }

        const citations = (payload?.citations ?? []).filter((citation) => {
          const content = contextMap.get(citation.day)
          if (!content) return false

          if (content.includes(citation.quote)) {
            return true
          }

          const normalizedQuote = normalizeCitationText(citation.quote)
          if (!normalizedQuote) {
            return false
          }

          const normalizedContent = normalizeCitationText(content)
          return normalizedContent.includes(normalizedQuote)
        })

        const fallbackAnswer = stripCodeFences(finalResponseText || responseText)

        setMessages((state) =>
          state.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: payload?.answer ?? (fallbackAnswer || responseText),
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
      allowThinking,
      allowWebSearch,
      buildContextDays,
      chatPanelOpen,
      chat,
      desktopChatPanelOpen,
      formatContext,
      geminiApiKey,
      geminiModel,
      isNarrowViewport,
      setDesktopChatPanelOpen,
      setChatPanelOpen,
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
        requestDayEditorMount(todayId, 'end')
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
  }, [focusDayEditor, handleCreateDay, hasToday, requestDayEditorMount, revealDay, todayId])

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

    const isInteractiveTarget = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return false
      }

      return Boolean(
        target.closest(
          'button, a[href], input, textarea, select, summary, label, [role="button"], [contenteditable="true"]',
        ),
      )
    }

    const handleOutsidePointer = (event: Event) => {
      const point = getPoint(event)
      if (!point) return
      if (isInsideAnyCard(point.x, point.y)) return
      if (isInteractiveTarget(event)) return
      requestAnimationFrame(blurFocusedEditor)
    }

    if ('PointerEvent' in window) {
      document.addEventListener('pointerdown', handleOutsidePointer, { capture: true })
    } else {
      document.addEventListener('mousedown', handleOutsidePointer, { capture: true })
      document.addEventListener('touchstart', handleOutsidePointer, { capture: true })
    }

    return () => {
      if ('PointerEvent' in window) {
        document.removeEventListener('pointerdown', handleOutsidePointer, { capture: true })
      } else {
        document.removeEventListener('mousedown', handleOutsidePointer, { capture: true })
        document.removeEventListener('touchstart', handleOutsidePointer, { capture: true })
      }
    }
  }, [])

  const handleLoadOlderDays = useCallback(
    (source: 'observer' | 'button') => {
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

        debugLog(LOG_SCOPE, 'olderDays:observerIntersection', {
          loadedCount: days.length,
          loading,
          loadingMore,
          hasMorePast,
        })

        handleLoadOlderDays('observer')
      },
      {
        root: null,
        rootMargin: OLDER_DAYS_OBSERVER_MARGIN,
        threshold: 0,
      },
    )

    observer.observe(sentinelNode)
    return () => {
      observer.disconnect()
    }
  }, [days.length, handleLoadOlderDays, hasMorePast, isTimelineVisible, loading, loadingMore, supportsIntersectionObserver])

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

  useEffect(() => {
    dayOrderRef.current = dayOrder
    recomputeMountedEditors('dayOrderChanged')
  }, [dayOrder, recomputeMountedEditors])

  useEffect(() => {
    if (!isTimelineVisible) return

    const interval = window.setInterval(() => {
      recomputeMountedEditors('pinTtlPrune')
    }, EDITOR_PIN_PRUNE_INTERVAL_MS)

    return () => {
      window.clearInterval(interval)
    }
  }, [isTimelineVisible, recomputeMountedEditors])

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
  }, [days, recomputeMountedEditors])

  const handleFocusDay = useCallback(
    (dayId: string, position: 'start' | 'end') => {
      if (focusDayEditor(dayId, position)) {
        return
      }
      requestDayEditorMount(dayId, position)
    },
    [focusDayEditor, requestDayEditorMount],
  )

  // No Results State
  const noSearchResults =
    mode === 'search' &&
    !searchLoading &&
    Boolean(searchText.trim()) &&
    searchResults.length === 0 &&
    !searchError

  // --- Render ---

  const chatMessages = useMemo(() => [...messages].reverse(), [messages])

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

  const timelineContent = (
    <>
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
            <p className="text-2xl text-slate-600">Stop organizing. Start writing.</p>
          </div>
          <div className="flex flex-col items-center gap-4">
            <button className={`${buttonPrimary} px-6 py-3 text-base`} type="button" onClick={handleEmptyCta}>
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
              return <div key={`divider-${index}`} className="my-3 border-t border-dashed border-slate-200/80" />
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
            const shouldMountEditor =
              mode === 'search' || mountedDayIds.has(day.dayId) || editorRefs.current.has(day.dayId)

            return (
              <DayEditorCard
                key={day.dayId}
                day={day}
                shouldMountEditor={shouldMountEditor}
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
                onFocusDay={handleFocusDay}
                onRequestEditorMount={requestDayEditorMount}
                registerEditor={registerEditor}
                registerDayRef={registerDayRef}
              />
            )
          })}
        </div>
      )}

      {!loading && !hasNoNotes && isTimelineVisible && days.length > 0 && (
        <div className="mt-4 space-y-2">
          {hasMorePast && <div ref={olderDaysSentinelRef} className="h-px w-full" aria-hidden="true" />}

          {loadingMore && <p className="text-center text-xs text-slate-400">Loading older notes...</p>}

          {!supportsIntersectionObserver && hasMorePast && !loadingMore && (
            <div className="flex justify-center">
              <button
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-700"
                type="button"
                onClick={() => handleLoadOlderDays('button')}
              >
                Load older notes
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )

  return (
    <div>
      {trayContent ? <BottomTrayPortal>{trayContent}</BottomTrayPortal> : null}

      {showDesktopChatMode ? (
        <div className={`timeline-chat-layout ${showDesktopChatPanel ? 'is-chat-open' : 'is-chat-closed'}`}>
          <div className="timeline-chat-main">{timelineContent}</div>

          <aside className="timeline-chat-sidebar" aria-hidden={!showDesktopChatPanel}>
            <div className="timeline-chat-sidebar-inner">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-center'}`}
                >
                  <div
                    className={`space-y-2 text-m ${
                      message.role === 'user'
                        ? 'max-w-[85%] rounded-2xl bg-[#22B3FF] px-4 py-3 text-white shadow-[0_0_30px_-0_rgba(0,0,0,0.12)]'
                        : 'w-full max-w-full rounded-none bg-transparent px-0 py-0 text-left text-slate-700 shadow-none'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content || '...'}</p>

                    {message.role === 'assistant' && message.meta?.citations?.length ? (
                      <div className="flex flex-wrap justify-start gap-2">
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
          </aside>
        </div>
      ) : (
        timelineContent
      )}

      {/* Mobile chat overlay (Mode A) */}
      {showMobileChatOverlay && (
        <>
          <div className="fixed inset-0 z-20 sm:hidden">
            <div className="pointer-events-none absolute inset-0 bg-white/35 backdrop-blur-lg" />
            <div
              className="relative flex h-full flex-col-reverse gap-3 overflow-y-auto px-2"
              style={{
                paddingTop: 'calc(env(safe-area-inset-top) + 4rem)',
                paddingBottom: 'calc(var(--keyboard-offset, 0px) + env(safe-area-inset-bottom) + 5.75rem)',
              }}
            >
              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`space-y-2 rounded-2xl px-4 py-3 text-m shadow-[0_0_30px_-0_rgba(0,0,0,0.12)] ${
                      message.role === 'user'
                        ? 'max-w-[85%] bg-[#22B3FF] text-white'
                        : 'max-w-[94%] bg-white text-slate-700'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content || '...'}</p>

                    {message.role === 'assistant' && message.meta?.citations?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {message.meta.citations.map((citation, index) => (
                          <button
                            key={`${citation.day}-${index}`}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 shadow-sm transition"
                            onClick={() => void handleCitationClick(citation)}
                          >
                            {citation.day} · “{citation.quote.slice(0, 32)}”
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {message.role === 'assistant' && message.meta?.insertText ? (
                      <button
                        className="rounded-full border border-[#22B3FF]/40 px-3 py-1 text-xs font-semibold text-[#22B3FF] shadow-sm transition"
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
        </>
      )}
    </div>
  )
}
