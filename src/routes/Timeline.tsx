import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import BottomTrayPortal from '../components/BottomTrayPortal'
import DayEditorCard from '../components/timeline/DayEditorCard'
import EmptyStateHero from '../components/timeline/EmptyStateHero'
import ChatMessageList from '../components/timeline/ChatMessageList'
import { isIOS } from '../lib/device'
import { getBodyFontFamily, getMonospaceFontFamily, getMonospaceFontSize, getTitleFontFamily } from '../lib/fonts'
import { getNarrowViewportMediaQuery, isNarrowViewport } from '../lib/viewport'
import {
  TIMELINE_FOCUS_TODAY_EVENT,
  TIMELINE_NEW_CHAT_EVENT,
  TIMELINE_SCROLL_TODAY_EVENT,
} from '../lib/timelineEvents'
import { addDays, formatHumanDate, getTodayId, parseDayId } from '../lib/dates'
import { debugLog, startDebugTimer } from '../lib/debugLogs'
import type { Day, DaySearchResult, SearchFilter } from '../lib/dayRepository'
import { searchDays } from '../lib/dayRepository'
import { buttonPrimary } from '../lib/ui'
import { useCitationNavigation } from './timeline/useCitationNavigation'
import { useEditorMountWindow } from './timeline/useEditorMountWindow'
import { useOlderDaysLoader } from './timeline/useOlderDaysLoader'
import { useTimelineChat } from './timeline/useTimelineChat'
import { useSettingsStore } from '../store/useSettingsStore'
import { useSyncStore } from '../store/useSyncStore'
import { useDaysStore } from '../store/useDaysStore'
import { useUIStore } from '../store/useUIStore'
import { useChatStore, type ChatCitation as Citation } from '../store/useChatStore'
import { pushToSyncAndRefresh } from '../store/syncActions'

const isEditableElement = (element: HTMLElement | null) =>
  Boolean(
    element &&
      (element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        element.isContentEditable),
  )

type TimelineItem =
  | { type: 'day'; day: Day }
  | { type: 'add-today'; dayId: string }
  | { type: 'add-future'; dayId: string }

type TrayInputMode = 'chat' | 'search'

type SearchResultMode = 'whole-day' | 'matched-lines'

type SearchFilterOption = {
  value: SearchFilter
  label: string
}

type TrayInputProps = {
  mode: TrayInputMode
  sending: boolean
  chatError: string | null
  onChatSubmit: (value: string) => Promise<void>
  onSearchTextChange: (value: string) => void
}

type TrayInputConfig = {
  placeholder: string
  icon: string
  id: string
  enterKeyHint: 'send' | 'search'
}

const SEARCH_FILTER_OPTIONS: SearchFilterOption[] = [
  { value: 'open-todos', label: 'TODOs' },
  { value: 'tags', label: '# Tags' },
  { value: 'mentions', label: '@ Mentions' },
  { value: 'headings', label: 'Sections' },
]

const getResultModeLabel = (resultMode: SearchResultMode) =>
  resultMode === 'whole-day' ? 'Days' : 'Lines'

const TODO_LINE_REGEX = /^(\s*-\s+)(\[[ xX]\])(.*)$/
const TODO_TOGGLE_REGEX = /^(\s*-\s+\[)([ xX])(\].*)$/

const toggleTodoLineMarker = (line: string) => {
  const match = line.match(TODO_TOGGLE_REGEX)
  if (!match) {
    return null
  }

  const toggledValue = match[2].toLocaleLowerCase() === 'x' ? ' ' : 'x'
  return `${match[1]}${toggledValue}${match[3]}`
}

const getMatchedBlockLineIndexes = (contentMd: string, matchedBlocks: string[]) => {
  const normalizedLines = contentMd.split('\n').map((line) => line.trimEnd())
  const usedIndexes = new Set<number>()

  return matchedBlocks.map((block) => {
    const normalizedBlock = block.trimEnd()

    for (let index = 0; index < normalizedLines.length; index += 1) {
      if (usedIndexes.has(index)) {
        continue
      }

      if (normalizedLines[index] === normalizedBlock) {
        usedIndexes.add(index)
        return index
      }
    }

    return -1
  })
}

type RenderSyntaxLineOptions = {
  onToggleTodo?: () => void
}

const highlightQueryText = (text: string, query: string, keyPrefix: string) => {
  const trimmed = query.trim()
  if (!trimmed) {
    return [text]
  }

  const normalizedText = text.toLocaleLowerCase()
  const normalizedQuery = trimmed.toLocaleLowerCase()
  const parts: React.ReactNode[] = []
  let cursor = 0

  while (cursor < text.length) {
    const nextIndex = normalizedText.indexOf(normalizedQuery, cursor)
    if (nextIndex === -1) {
      parts.push(text.slice(cursor))
      break
    }

    if (nextIndex > cursor) {
      parts.push(text.slice(cursor, nextIndex))
    }

    const endIndex = nextIndex + trimmed.length
    parts.push(
      <mark key={`${keyPrefix}-${nextIndex}-${endIndex}`} className="rounded bg-[#22B3FF]/15 text-inherit">
        {text.slice(nextIndex, endIndex)}
      </mark>,
    )
    cursor = endIndex
  }

  return parts
}

const renderInlineTokenHighlights = (text: string, query: string, keyPrefix: string) => {
  const tokenRegex = /[#@][A-Za-z0-9_/-]+/g
  const nodes: React.ReactNode[] = []
  let cursor = 0
  let tokenMatch = tokenRegex.exec(text)

  while (tokenMatch) {
    const token = tokenMatch[0]
    const start = tokenMatch.index
    const end = start + token.length

    if (start > cursor) {
      nodes.push(...highlightQueryText(text.slice(cursor, start), query, `${keyPrefix}-plain-${cursor}`))
    }

    nodes.push(
      <span
        key={`${keyPrefix}-token-${start}`}
        className={token.startsWith('#') ? 'font-bold text-[#c779da]' : 'font-semibold text-[#0098e5]'}
      >
        {highlightQueryText(token, query, `${keyPrefix}-token-inner-${start}`)}
      </span>,
    )

    cursor = end
    tokenMatch = tokenRegex.exec(text)
  }

  if (cursor < text.length) {
    nodes.push(...highlightQueryText(text.slice(cursor), query, `${keyPrefix}-plain-tail`))
  }

  return nodes.length ? nodes : [text]
}

const renderSyntaxLine = (line: string, query: string, keyPrefix: string, options?: RenderSyntaxLineOptions) => {
  const headingMatch = line.match(/^(\s{0,3}#{1,6}\s+)(.*)$/)
  if (headingMatch) {
    return (
      <>
        <span className="font-black text-[#368b1c]">
          {highlightQueryText(headingMatch[1], query, `${keyPrefix}-heading-marker`)}
        </span>
        {renderInlineTokenHighlights(headingMatch[2], query, `${keyPrefix}-heading-text`)}
      </>
    )
  }

  const todoMatch = line.match(TODO_LINE_REGEX)
  if (todoMatch) {
    const todoMarker = highlightQueryText(todoMatch[2], query, `${keyPrefix}-todo-marker`)

    return (
      <>
        <span className="font-semibold text-[#b45309]">
          {highlightQueryText(todoMatch[1], query, `${keyPrefix}-todo-list`)}
        </span>
        {options?.onToggleTodo ? (
          <button
            className="-mx-0.5 inline-flex items-center rounded-[4px] px-1 py-0.5 font-semibold text-[#ed9b38] transition hover:bg-[#ed9b38]/15 active:bg-[#ed9b38]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22B3FF]/40"
            type="button"
            aria-label="Toggle todo"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              options.onToggleTodo?.()
            }}
          >
            {todoMarker}
          </button>
        ) : (
          <span className="font-semibold text-[#ed9b38]">{todoMarker}</span>
        )}
        {renderInlineTokenHighlights(todoMatch[3], query, `${keyPrefix}-todo-text`)}
      </>
    )
  }

  const listMarkerMatch = line.match(/^(\s*(?:[-+*]|\d+[.)]))(\s+)(.*)$/)
  if (listMarkerMatch) {
    return (
      <>
        <span className="font-semibold text-[#b45309]">
          {highlightQueryText(listMarkerMatch[1], query, `${keyPrefix}-list-marker`)}
        </span>
        {highlightQueryText(listMarkerMatch[2], query, `${keyPrefix}-list-space`)}
        {renderInlineTokenHighlights(listMarkerMatch[3], query, `${keyPrefix}-list-text`)}
      </>
    )
  }

  return renderInlineTokenHighlights(line, query, `${keyPrefix}-plain`)
}

const SearchModePills = memo(({
  searchFilter,
  resultMode,
  onSearchFilterChange,
  onToggleResultMode,
}: {
  searchFilter: SearchFilter | null
  resultMode: SearchResultMode
  onSearchFilterChange: (filter: SearchFilter | null) => void
  onToggleResultMode: () => void
}) => (
  <div className="pointer-events-auto flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <button
      className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full border border-[#bfd9ff] bg-[#EBF4FF] px-2 text-xs font-semibold text-[#0f5580] shadow-[0_1px_2px_rgba(15,23,42,0.1),0_2px_8px_rgba(15,23,42,0.06)] transition hover:border-[#9dc6ff] sm:h-8"
      type="button"
      onClick={onToggleResultMode}
      aria-label={`Toggle result mode. Current mode: ${getResultModeLabel(resultMode)}`}
    >
      <span className="px-1 text-[10px] uppercase tracking-[0.05em] text-[#0f5580]/70">Show</span>
      <span
        className={`rounded-full px-2 py-1 sm:py-0.5 ${
          resultMode === 'whole-day' ? 'bg-white text-[#0f5580] shadow-sm' : 'text-[#0f5580]/70'
        }`}
      >
        Days
      </span>
      <span
        className={`rounded-full px-2 py-1 sm:py-0.5 ${
          resultMode === 'matched-lines' ? 'bg-white text-[#0f5580] shadow-sm' : 'text-[#0f5580]/70'
        }`}
      >
        Lines
      </span>
    </button>
    {searchFilter ? (
      <button
        className="group inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-[#bfd9ff] bg-[#EBF4FF] px-3 text-xs font-semibold text-[#0f5580] shadow-[0_1px_2px_rgba(15,23,42,0.1),0_2px_8px_rgba(15,23,42,0.06)] transition hover:border-[#9dc6ff] sm:h-8"
        type="button"
        onClick={() => onSearchFilterChange(null)}
        aria-label={`Remove ${SEARCH_FILTER_OPTIONS.find((option) => option.value === searchFilter)?.label ?? 'filter'} filter`}
      >
        {SEARCH_FILTER_OPTIONS.find((option) => option.value === searchFilter)?.label}
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[#0f5580] transition group-hover:bg-[#dcecff]">
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
            <path d="M4 4l8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M12 4L4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
      </button>
    ) : (
      SEARCH_FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          className="inline-flex h-10 shrink-0 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.1),0_2px_8px_rgba(15,23,42,0.06)] transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 sm:h-8"
          type="button"
          onClick={() => onSearchFilterChange(option.value)}
        >
          {option.label}
        </button>
      ))
    )}
  </div>
))

const getMatchedResultDayLabel = (dayId: string, todayId: string) => {
  const dayDate = parseDayId(dayId)
  const todayDate = parseDayId(todayId)
  const diffDays = Math.round((dayDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))
  const showWeekday = Math.abs(diffDays) <= 6
  const humanDate = formatHumanDate(dayId, todayId, {
    includeRelativeLabel: false,
    includeWeekday: showWeekday,
  })
  const isToday = dayId === todayId
  const isYesterday = dayId === addDays(todayId, -1)
  const isTomorrow = dayId === addDays(todayId, 1)
  const relativeLabel = isToday ? 'Today' : isYesterday ? 'Yesterday' : isTomorrow ? 'Tomorrow' : null

  if (relativeLabel) {
    return `${relativeLabel}, ${humanDate}`
  }

  return humanDate
}

const HEADING_LINE_REGEX = /^\s{0,3}(#{1,6})\s+/
const HEADING_PREVIEW_LINE_COUNT = 3

const getHeadingSectionEndIndex = (lines: string[], headingStart: number, headingLevel: number) => {
  for (let index = headingStart + 1; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(HEADING_LINE_REGEX)
    if (headingMatch && headingMatch[1].length <= headingLevel) {
      return index
    }
  }

  return lines.length
}

const buildHeadingPreview = (sectionLines: string[]) => {
  if (!sectionLines.length) {
    return {
      headingLine: '',
      displayBlock: '',
      hasMore: false,
    }
  }

  const headingLine = sectionLines[0]
  const bodyLines = sectionLines.slice(1)
  const previewBodyLines = bodyLines.slice(0, HEADING_PREVIEW_LINE_COUNT)

  return {
    headingLine,
    displayBlock: [headingLine, ...previewBodyLines].join('\n'),
    hasMore: bodyLines.length > HEADING_PREVIEW_LINE_COUNT,
  }
}

const getHeadingPreviewFromSectionBlock = (block: string) => {
  const sectionLines = block.split('\n').map((line) => line.trimEnd())
  if (!sectionLines.length) {
    return null
  }

  if (!HEADING_LINE_REGEX.test(sectionLines[0])) {
    return null
  }

  return buildHeadingPreview(sectionLines)
}

const getHeadingPreviewFromDay = (day: Day, headingLine: string) => {
  const normalizedHeadingLine = headingLine.trimEnd()
  if (!HEADING_LINE_REGEX.test(normalizedHeadingLine)) {
    return null
  }

  const lines = day.contentMd.split('\n')
  const headingIndex = lines.findIndex(
    (line) => line.trimEnd() === normalizedHeadingLine && HEADING_LINE_REGEX.test(line),
  )
  if (headingIndex < 0) {
    return null
  }

  const headingMatch = lines[headingIndex].match(HEADING_LINE_REGEX)
  if (!headingMatch) {
    return null
  }

  const sectionEnd = getHeadingSectionEndIndex(lines, headingIndex, headingMatch[1].length)
  const sectionLines = lines.slice(headingIndex, sectionEnd).map((line) => line.trimEnd())
  return buildHeadingPreview(sectionLines)
}

const MatchedLineResultCard = memo(({
  day,
  block,
  openQuote,
  hasMore,
  blockIndex,
  sourceLineIndex,
  enableTodoToggle,
  todayId,
  contentTextStyle,
  searchQuery,
  onOpen,
  onToggleTodo,
}: {
  day: Day
  block: string
  openQuote: string
  hasMore: boolean
  blockIndex: number
  sourceLineIndex: number | null
  enableTodoToggle: boolean
  todayId: string
  contentTextStyle: React.CSSProperties
  searchQuery: string
  onOpen: (dayId: string, quote: string) => void
  onToggleTodo: (dayId: string, blockIndex: number, sourceLineIndex: number) => void
}) => {
  const dayLabel = getMatchedResultDayLabel(day.dayId, todayId)

  return (
    <section className="scroll-anchor relative rounded-[4px] border border-slate-200/60 bg-white px-3 py-2.5 pr-14 shadow-[0_6px_6px_-4px_rgba(0,0,0,0.10),0_2px_12px_rgba(0,0,0,0.06)] transition hover:border-slate-300/60">
      <button
        className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-700 sm:h-9 sm:w-9"
        type="button"
        aria-label={`Open note for ${dayLabel}`}
        onClick={() => onOpen(day.dayId, openQuote)}
      >
        <img src="/arrow-square-in.svg" alt="" className="h-5 w-5" />
      </button>
      <div className="mb-1.5">
        <p className="m-0" style={{ ...contentTextStyle, color: '#64748b' }}>
          {dayLabel}
        </p>
      </div>
      <div className="space-y-0" style={contentTextStyle}>
        {block.split('\n').map((line, lineIndex) => (
          <p key={`${day.dayId}-${lineIndex}`} className="m-0 whitespace-pre-wrap break-words px-[2px] pl-[6px] text-slate-900">
            {line
              ? renderSyntaxLine(
                  line,
                  searchQuery,
                  `${day.dayId}-${lineIndex}`,
                  enableTodoToggle && sourceLineIndex !== null && lineIndex === 0
                    ? {
                        onToggleTodo: () => {
                          onToggleTodo(day.dayId, blockIndex, sourceLineIndex)
                        },
                      }
                    : undefined,
                )
              : <span>&nbsp;</span>}
          </p>
        ))}
        {hasMore && <p className="m-0 px-[2px] pl-[6px] text-slate-400">...</p>}
      </div>
    </section>
  )
})

type MatchedLineResultItem = {
  key: string
  day: Day
  block: string
  openQuote: string
  hasMore: boolean
  blockIndex: number
  sourceLineIndex: number | null
}

const TrayInput = memo(({
  mode,
  sending,
  chatError,
  onChatSubmit,
  onSearchTextChange,
}: TrayInputProps) => {
  const [draftText, setDraftText] = useState('')
  const debounceRef = useRef<number | null>(null)
  const prevModeRef = useRef<TrayInputMode>(mode)
  const isChatMode = mode === 'chat'

  const inputConfig = useMemo<TrayInputConfig>(() => {
    if (isChatMode) {
      return {
        placeholder: 'Ask anything',
        icon: '/sparkle.svg',
        id: 'chat-input',
        enterKeyHint: 'send',
      }
    }

    return {
      placeholder: 'Search all days',
      icon: '/magnifying-glass.svg',
      id: 'search-input',
      enterKeyHint: 'search',
    }
  }, [isChatMode])

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

    const trimmed = draftText.trim()
    if (!trimmed) return

    if (mode === 'chat') {
      setDraftText('')
      await onChatSubmit(draftText)
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

  const showChatError = Boolean(chatError) && mode === 'chat'

  return (
    <div className="relative">
      <form className="flex items-center gap-3" onSubmit={handleSubmit}>
        <div className="relative flex-1">
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
            type="text"
            inputMode="text"
            className="w-full rounded-full bg-transparent py-2 pl-3 pr-3 text-base outline-none sm:pl-10"
            placeholder={inputConfig.placeholder}
            value={draftText}
            onChange={(event) => {
              setDraftText(event.target.value)
            }}
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
              draftText.trim() && !sending ? 'bg-[#22B3FF] hover:bg-[#22B3FF]/90' : 'bg-slate-300'
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
        {mode === 'search' && draftText.trim() && (
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

const OLDER_DAYS_OBSERVER_MARGIN = '350px 0px 550px 0px'
const INITIAL_EDITOR_MOUNT_COUNT = 5
const EDITOR_HYDRATE_OBSERVER_MARGIN = '70% 0px 90% 0px'
const EDITOR_PIN_TTL_MS = 20_000
const EDITOR_PIN_PRUNE_INTERVAL_MS = 4_000
const LOG_SCOPE = 'TimelinePerf'
const DELETE_UNDO_WINDOW_MS = 6_000

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
  const messages = useChatStore((state) => state.messages)
  const setMessages = useChatStore((state) => state.setMessages)

  // Mode-specific Input State
  const [searchText, setSearchText] = useState('')
  const handleSearchTextChange = useCallback(
    (nextValue: string) => {
      setSearchText(nextValue)
    },
    [setSearchText],
  )

  useEffect(() => {
    setChatMessageCount(messages.length)
  }, [messages.length, setChatMessageCount])

  // Search State
  const [searchResults, setSearchResults] = useState<DaySearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState<SearchFilter | null>(null)
  const [searchResultMode, setSearchResultMode] = useState<SearchResultMode>('whole-day')
  const [dateErrors, setDateErrors] = useState<Record<string, string | null>>({})
  const [highlightedQuote, setHighlightedQuote] = useState<Citation | null>(null)
  const [isLogoAnimating, setIsLogoAnimating] = useState(false)
  const [isHeroRevealActive, setIsHeroRevealActive] = useState(false)
  const [isHeroRevealHold, setIsHeroRevealHold] = useState(false)
  const [isNarrowViewportMode, setIsNarrowViewportMode] = useState(() => isNarrowViewport())
  const [pendingDeleteDayId, setPendingDeleteDayId] = useState<string | null>(null)
  const [committingDeleteDayIds, setCommittingDeleteDayIds] = useState<string[]>([])

  const hiddenDeleteDayIds = useMemo(() => {
    const next = new Set(committingDeleteDayIds)
    if (pendingDeleteDayId) {
      next.add(pendingDeleteDayId)
    }
    return next
  }, [committingDeleteDayIds, pendingDeleteDayId])

  const visibleDays = useMemo(
    () => (hiddenDeleteDayIds.size ? days.filter((day) => !hiddenDeleteDayIds.has(day.dayId)) : days),
    [days, hiddenDeleteDayIds],
  )
  const visibleSearchResults = useMemo(
    () =>
      hiddenDeleteDayIds.size
        ? searchResults.filter((result) => !hiddenDeleteDayIds.has(result.day.dayId))
        : searchResults,
    [hiddenDeleteDayIds, searchResults],
  )
  const hasNoNotes = !loading && visibleDays.length === 0

  const canSync = Boolean(syncStatus.connected && syncStatus.filePath)
  const rawSearchQuery = mode === 'search' ? searchText.trim() : ''
  const deferredSearchQuery = useDeferredValue(rawSearchQuery)
  const searchQuery = mode === 'search' ? deferredSearchQuery : ''
  const hasSearchIntent = mode === 'search' && (Boolean(searchQuery) || Boolean(searchFilter))
  const isTimelineVisible = mode !== 'search'
  const hasChatMessages = messages.length > 0
  const showDesktopChatMode = mode === 'chat' && !isNarrowViewportMode && hasChatMessages
  const showDesktopChatPanel = showDesktopChatMode && desktopChatPanelOpen
  const showMobileChatOverlay = mode === 'chat' && isNarrowViewportMode && chatPanelOpen
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
  const olderDaysSentinelRef = useRef<HTMLDivElement | null>(null)
  const mobileChatScrollRef = useRef<HTMLDivElement | null>(null)
  const saveTimeouts = useRef(new Map<string, number>())
  const createdDayIdsRef = useRef(new Set<string>())
  const pendingDeleteTimerRef = useRef<number | null>(null)
  const pendingDeleteDayIdRef = useRef<string | null>(null)
  const committingDeleteDayIdsRef = useRef(new Set<string>())
  const finalizeDeleteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const finalizeDeleteOnUnmountRef = useRef<(dayId: string) => Promise<void>>(async () => {})
  const isMountedRef = useRef(true)
  const pendingFocusRef = useRef<{ dayId: string; position: 'start' | 'end' } | null>(null)
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
        '& .cm-selectionBackground': {
          backgroundColor: 'rgba(0, 122, 255, 0.22)',
        },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
          backgroundColor: 'rgba(0, 122, 255, 0.32)',
        },
        '.cm-content ::selection': {
          backgroundColor: 'rgba(0, 122, 255, 0.32)',
        },
        '.cm-line::selection, .cm-line > span::selection': {
          backgroundColor: 'rgba(0, 122, 255, 0.32)',
        },
        '.cm-selectionMatch': {
          backgroundColor: 'rgba(148, 163, 184, 0.24)',
          borderRadius: '3px',
        },
        '.cm-selectionMatch-main': {
          backgroundColor: 'rgba(125, 211, 252, 0.30)',
          borderRadius: '3px',
        },
      }),
    [fontPreference, bodyFont, monospaceFont, isIosDevice],
  )
  const titleFontFamily = useMemo(() => getTitleFontFamily(titleFont), [titleFont])
  const matchedResultsTextStyle = useMemo<React.CSSProperties>(
    () => ({
      fontSize:
        fontPreference === 'monospace'
          ? isIosDevice && monospaceFont === 'iawriter'
            ? '1rem'
            : getMonospaceFontSize(monospaceFont)
          : '0.98rem',
      lineHeight: 1.4,
      fontWeight: '400',
      fontFamily:
        fontPreference === 'monospace'
          ? getMonospaceFontFamily(monospaceFont)
          : getBodyFontFamily(bodyFont),
      fontSynthesis: 'weight style',
      color: '#000000',
    }),
    [bodyFont, fontPreference, isIosDevice, monospaceFont],
  )
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
    const mediaQuery = getNarrowViewportMediaQuery()

    const updateViewport = () => {
      setIsNarrowViewportMode(mediaQuery.matches)
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
    const previousRootOverscroll = rootStyle.overscrollBehavior
    const previousBodyOverflow = bodyStyle.overflow
    const previousBodyOverscroll = bodyStyle.overscrollBehavior

    rootStyle.overflow = 'hidden'
    rootStyle.overscrollBehavior = 'none'
    bodyStyle.overflow = 'hidden'
    bodyStyle.overscrollBehavior = 'none'

    const handleTouchMove = (event: TouchEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (mobileChatScrollRef.current?.contains(target)) return
      event.preventDefault()
    }

    document.addEventListener('touchmove', handleTouchMove, { passive: false })

    return () => {
      rootStyle.overflow = previousRootOverflow
      rootStyle.overscrollBehavior = previousRootOverscroll
      bodyStyle.overflow = previousBodyOverflow
      bodyStyle.overscrollBehavior = previousBodyOverscroll
      document.removeEventListener('touchmove', handleTouchMove)
      requestAnimationFrame(() => {
        window.scrollTo(0, lockScrollY)
      })
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
      document.body.dataset.heroUi = 'true'
      return
    }

    delete document.body.dataset.heroWallpaper
    delete document.body.dataset.heroUi
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

  useEffect(() => {
    if (mode !== 'search') return

    if (!searchText.trim() && !searchFilter) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    let cancelled = false
    setSearchLoading(true)
    setSearchError(null)

    const runSearch = async () => {
      try {
        const data = await searchDays(searchText, { filter: searchFilter })
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
  }, [mode, searchFilter, searchText])

  useEffect(() => {
    const pendingTimeouts = saveTimeouts.current

    return () => {
      for (const handle of pendingTimeouts.values()) {
        window.clearTimeout(handle)
      }

      delete document.body.dataset.emptyState
      delete document.body.dataset.heroWallpaper
      delete document.body.dataset.heroUi
      delete document.body.dataset.heroReveal
    }
  }, [])

  // --- Handlers ---

  const handleAutoPush = useCallback(async () => {
    if (!canSync || !navigator.onLine) return
    try {
      await pushToSyncAndRefresh()
    } catch {
      // Ignore auto-push errors
    }
  }, [canSync])

  const clearPendingDeleteTimer = useCallback(() => {
    if (pendingDeleteTimerRef.current !== null) {
      window.clearTimeout(pendingDeleteTimerRef.current)
      pendingDeleteTimerRef.current = null
    }
  }, [])

  const clearPendingSaveTimeout = useCallback((dayId: string) => {
    const existing = saveTimeouts.current.get(dayId)
    if (existing) {
      window.clearTimeout(existing)
      saveTimeouts.current.delete(dayId)
    }
  }, [])

  const clearDateError = useCallback((dayId: string) => {
    setDateErrors((state) => {
      if (!state[dayId]) return state
      const next = { ...state }
      delete next[dayId]
      return next
    })
  }, [])

  const addCommittingDeleteDay = useCallback((dayId: string) => {
    if (committingDeleteDayIdsRef.current.has(dayId)) {
      return
    }

    committingDeleteDayIdsRef.current.add(dayId)
    if (isMountedRef.current) {
      setCommittingDeleteDayIds((state) => (state.includes(dayId) ? state : [...state, dayId]))
    }
  }, [])

  const removeCommittingDeleteDay = useCallback((dayId: string) => {
    if (!committingDeleteDayIdsRef.current.has(dayId)) {
      return
    }

    committingDeleteDayIdsRef.current.delete(dayId)
    if (isMountedRef.current) {
      setCommittingDeleteDayIds((state) => state.filter((value) => value !== dayId))
    }
  }, [])

  const finalizeDeleteDayNow = useCallback(
    async (
      dayId: string,
      options?: { skipDateErrorCleanup?: boolean; skipSearchResultsCleanup?: boolean },
    ) => {
      clearPendingSaveTimeout(dayId)
      createdDayIdsRef.current.delete(dayId)

      if (!options?.skipDateErrorCleanup && isMountedRef.current) {
        clearDateError(dayId)
      }

      if (!options?.skipSearchResultsCleanup && isMountedRef.current) {
        setSearchResults((state) => state.filter((result) => result.day.dayId !== dayId))
      }
      await deleteDay(dayId)
      void handleAutoPush()
    },
    [clearDateError, clearPendingSaveTimeout, deleteDay, handleAutoPush],
  )

  const enqueueDeleteFinalization = useCallback(
    (dayId: string) => {
      if (committingDeleteDayIdsRef.current.has(dayId)) {
        return finalizeDeleteQueueRef.current
      }

      addCommittingDeleteDay(dayId)

      const run = async () => {
        try {
          await finalizeDeleteDayNow(dayId)
        } finally {
          removeCommittingDeleteDay(dayId)
        }
      }

      const queuedRun = finalizeDeleteQueueRef.current.then(run, run)
      finalizeDeleteQueueRef.current = queuedRun.then(
        () => undefined,
        () => undefined,
      )

      return queuedRun
    },
    [addCommittingDeleteDay, finalizeDeleteDayNow, removeCommittingDeleteDay],
  )

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    finalizeDeleteOnUnmountRef.current = (dayId: string) =>
      finalizeDeleteDayNow(dayId, { skipDateErrorCleanup: true, skipSearchResultsCleanup: true })
  }, [finalizeDeleteDayNow])

  useEffect(() => {
    return () => {
      if (pendingDeleteTimerRef.current !== null) {
        window.clearTimeout(pendingDeleteTimerRef.current)
        pendingDeleteTimerRef.current = null
      }

      const pendingDayId = pendingDeleteDayIdRef.current
      pendingDeleteDayIdRef.current = null
      if (pendingDayId) {
        void finalizeDeleteOnUnmountRef.current(pendingDayId)
      }
    }
  }, [])

  const finalizePendingDelete = useCallback(
    (dayId: string) => {
      if (pendingDeleteDayIdRef.current !== dayId) {
        return
      }

      clearPendingDeleteTimer()
      pendingDeleteDayIdRef.current = null
      setPendingDeleteDayId((current) => (current === dayId ? null : current))
      void enqueueDeleteFinalization(dayId)
    },
    [clearPendingDeleteTimer, enqueueDeleteFinalization],
  )

  const handleUndoDelete = useCallback(() => {
    clearPendingDeleteTimer()
    pendingDeleteDayIdRef.current = null
    setPendingDeleteDayId(null)
  }, [clearPendingDeleteTimer])

  const { sending, chatError, handleChatSend, handleChatInsert, handleNewChat } = useTimelineChat({
    messages,
    setMessages,
    aiLanguage,
    allowThinking,
    allowWebSearch,
    geminiApiKey,
    geminiModel,
    isNarrowViewport: isNarrowViewportMode,
    chatPanelOpen,
    desktopChatPanelOpen,
    setChatPanelOpen,
    setDesktopChatPanelOpen,
    loadTimeline,
    handleAutoPush,
  })

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
    clone.style.transform = 'translate(0px, 0px) scale(1, 1)'
    clone.style.transition = `transform ${heroLogoDuration}ms cubic-bezier(0.22, 0.61, 0.36, 1)`

    document.body.appendChild(clone)
    clone.getBoundingClientRect()
    setIsLogoAnimating(true)

    const deltaX = headerRect.left - heroRect.left
    const deltaY = headerRect.top - heroRect.top
    const scaleX = headerRect.width / heroRect.width
    const scaleY = headerRect.height / heroRect.height

    let finished = false

    const waitForHeaderRevealAndRemove = () => {
      const startedAt = performance.now()
      const maxWaitMs = heroLogoDuration + heroFadeDuration + 300

      const check = () => {
        const headerReady = document.body.dataset.emptyState !== 'true'
        const timedOut = performance.now() - startedAt >= maxWaitMs
        if (headerReady || timedOut) {
          clone.remove()
          return
        }
        window.requestAnimationFrame(check)
      }

      window.requestAnimationFrame(check)
    }

    let timeout = 0
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== clone) return
      if (event.propertyName !== 'transform') return
      finish()
    }

    const finish = () => {
      if (finished) return
      finished = true
      window.clearTimeout(timeout)
      clone.removeEventListener('transitionend', handleTransitionEnd)
      setIsLogoAnimating(false)
      waitForHeaderRevealAndRemove()
    }

    timeout = window.setTimeout(finish, heroLogoDuration + 100)
    clone.addEventListener('transitionend', handleTransitionEnd)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clone.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`
      })
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

  const {
    mountedDayIds,
    pinDayForEditorMount,
    requestDayEditorMount,
    registerEditor,
    registerDayRef,
    recomputeMountedEditors,
    setDayOrder,
  } = useEditorMountWindow({
    days: visibleDays,
    isSearchMode: mode === 'search' && searchResultMode === 'whole-day',
    isTimelineVisible,
    supportsIntersectionObserver,
    initialEditorMountCount: INITIAL_EDITOR_MOUNT_COUNT,
    editorHydrateObserverMargin: EDITOR_HYDRATE_OBSERVER_MARGIN,
    editorPinTtlMs: EDITOR_PIN_TTL_MS,
    editorPinPruneIntervalMs: EDITOR_PIN_PRUNE_INTERVAL_MS,
    editorRefs,
    dayRefs,
    pendingFocusRef,
    focusDayEditor,
  })

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

      if (pendingDeleteDayIdRef.current === dayId) {
        handleUndoDelete()
      }

      if (committingDeleteDayIdsRef.current.has(dayId)) {
        await finalizeDeleteQueueRef.current
      }

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
    [handleUndoDelete, loadDay, pinDayForEditorMount, revealDay],
  )

  const handleDeleteDay = useCallback(
    (dayId: string) => {
      const currentPendingDayId = pendingDeleteDayIdRef.current
      if (currentPendingDayId && currentPendingDayId !== dayId) {
        finalizePendingDelete(currentPendingDayId)
      }

      if (pendingDeleteDayIdRef.current === dayId || committingDeleteDayIdsRef.current.has(dayId)) {
        return
      }

      clearPendingSaveTimeout(dayId)
      clearPendingDeleteTimer()
      pendingDeleteDayIdRef.current = dayId
      setPendingDeleteDayId(dayId)

      pendingDeleteTimerRef.current = window.setTimeout(() => {
        if (pendingDeleteDayIdRef.current !== dayId) {
          return
        }
        finalizePendingDelete(dayId)
      }, DELETE_UNDO_WINDOW_MS)
    },
    [clearPendingDeleteTimer, clearPendingSaveTimeout, finalizePendingDelete],
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
        if (visibleDays.length <= 1) {
          return
        }
        await finalizeDeleteDayNow(dayId)
      }

      recomputeMountedEditors('editorBlur')
    },
    [finalizeDeleteDayNow, recomputeMountedEditors, visibleDays.length],
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

      if (highlightedQuote) {
        setHighlightedQuote(null)
      }

      pinDayForEditorMount(dayId, 'edit', false)

      setSearchResults((state) =>
        state.map((result) =>
          result.day.dayId === dayId
            ? {
                ...result,
                day: {
                  ...result.day,
                  contentMd: value,
                },
              }
            : result,
        ),
      )
      scheduleSave(dayId, value)
    },
    [highlightedQuote, pinDayForEditorMount, scheduleSave, setSearchResults],
  )

  const { handleCitationClick, handleAssistantMarkdownClick, handleAssistantMarkdownKeyDown } = useCitationNavigation({
    days,
    editorRefs,
    loadDay,
    pinDayForEditorMount,
    revealDay,
    setHighlightedQuote,
    isNarrowViewportMode,
    setChatPanelOpen,
  })

  const handleEmptyCta = useCallback(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!prefersReducedMotion) {
      heroRevealPending.current = true
    }
    runLogoTransition()
    void handleCreateDay(todayId)
  }, [handleCreateDay, runLogoTransition, todayId])


  // --- Computed Data ---

  const maxWeekdayOffset = 14
  const hasToday = useMemo(() => visibleDays.some((day) => day.dayId === todayId), [todayId, visibleDays])

  const futureDayId = useMemo(() => {
    const existing = new Set(visibleDays.map((day) => day.dayId))
    let candidate = addDays(todayId, 1) // Start from tomorrow
    while (existing.has(candidate)) {
      candidate = addDays(candidate, 1)
    }
    return candidate
  }, [todayId, visibleDays])

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
    window.addEventListener(TIMELINE_FOCUS_TODAY_EVENT, handleFocusEvent)
    return () => window.removeEventListener(TIMELINE_FOCUS_TODAY_EVENT, handleFocusEvent)
  }, [handleFocusToday])

  useEffect(() => {
    const handleScrollEvent = () => {
      handleScrollToToday()
    }
    window.addEventListener(TIMELINE_SCROLL_TODAY_EVENT, handleScrollEvent)
    return () => window.removeEventListener(TIMELINE_SCROLL_TODAY_EVENT, handleScrollEvent)
  }, [handleScrollToToday])

  useEffect(() => {
    const handleNewChatEvent = () => {
      handleNewChat()
    }

    window.addEventListener(TIMELINE_NEW_CHAT_EVENT, handleNewChatEvent)
    return () => window.removeEventListener(TIMELINE_NEW_CHAT_EVENT, handleNewChatEvent)
  }, [handleNewChat])

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
      const touchEvent = event as Event & {
        changedTouches?: ArrayLike<{ clientX: number; clientY: number }>
      }
      const touch = touchEvent.changedTouches?.[0]
      if (touch) {
        return { x: touch.clientX, y: touch.clientY }
      }

      const pointerEvent = event as Event & { clientX?: number; clientY?: number }
      if (typeof pointerEvent.clientX === 'number' && typeof pointerEvent.clientY === 'number') {
        return { x: pointerEvent.clientX, y: pointerEvent.clientY }
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

  const { handleLoadOlderDays } = useOlderDaysLoader({
    loadOlderDays,
    isTimelineVisible,
    supportsIntersectionObserver,
    hasMorePast,
    loading,
    loadingMore,
    olderDaysSentinelRef,
    olderDaysObserverMargin: OLDER_DAYS_OBSERVER_MARGIN,
  })

  const standardItems = useMemo<TimelineItem[]>(() => {
    if (visibleDays.length === 0) {
      return [{ type: 'add-today', dayId: todayId }]
    }

    const items: TimelineItem[] = []
    const showAddFuture = hasToday
    let addedFutureButton = false
    let addedTodayButton = false

    for (const day of visibleDays) {
      const isFutureCard = day.dayId > todayId
      const isPastCard = day.dayId < todayId

      if (!addedFutureButton && showAddFuture && !isFutureCard) {
        items.push({ type: 'add-future', dayId: futureDayId })
        addedFutureButton = true
      }

      if (!addedTodayButton && !hasToday && isPastCard) {
        items.push({ type: 'add-today', dayId: todayId })
        addedTodayButton = true
      }

      items.push({ type: 'day', day })
    }

    if (!addedFutureButton && showAddFuture) {
      items.push({ type: 'add-future', dayId: futureDayId })
    }

    if (!addedTodayButton && !hasToday) {
      items.push({ type: 'add-today', dayId: todayId })
    }

    return items
  }, [futureDayId, hasToday, todayId, visibleDays])

  const activeItems = useMemo<TimelineItem[]>(() => {
    if (hasSearchIntent) {
      if (searchResultMode === 'whole-day') {
        return visibleSearchResults.map(({ day }) => ({
          type: 'day',
          day,
        }))
      }

      return []
    }

    return standardItems
  }, [hasSearchIntent, searchResultMode, standardItems, visibleSearchResults])

  useEffect(() => {
    if (!isHeroRevealHold) return

    const shouldWaitForTomorrowButton = activeItems.some(
      (item) => item.type === 'add-future' && item.dayId === tomorrowId,
    )

    const isReadyToReveal = () => {
      const hasTodayCard = dayRefs.current.has(todayId)
      if (!hasTodayCard) return false
      if (!shouldWaitForTomorrowButton) return true
      return Boolean(document.querySelector("[data-hero-tomorrow='true']"))
    }

    let finished = false
    const startFade = () => {
      if (finished) return
      finished = true
      setIsHeroRevealHold(false)
      window.setTimeout(() => {
        setIsHeroRevealActive(false)
      }, heroFadeDuration)
    }

    const startedAt = performance.now()
    let raf = 0

    const pollReady = () => {
      if (finished) return

      if (isReadyToReveal()) {
        startFade()
        return
      }

      if (performance.now() - startedAt >= heroRevealFallback) {
        startFade()
        return
      }

      raf = window.requestAnimationFrame(pollReady)
    }

    raf = window.requestAnimationFrame(pollReady)

    return () => {
      if (raf) {
        window.cancelAnimationFrame(raf)
      }
    }
  }, [activeItems, heroFadeDuration, heroRevealFallback, isHeroRevealHold, todayId, tomorrowId])

  const dayOrder = useMemo(
    () =>
      activeItems
        .filter((item): item is { type: 'day'; day: Day } => item.type === 'day')
        .map((item) => item.day.dayId),
    [activeItems],
  )
  const dayIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    dayOrder.forEach((dayId, index) => map.set(dayId, index))
    return map
  }, [dayOrder])

  useEffect(() => {
    setDayOrder(dayOrder)
  }, [dayOrder, setDayOrder])

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
    hasSearchIntent &&
    !searchLoading &&
    visibleSearchResults.length === 0 &&
    !searchError
  const showMatchedLineResults = hasSearchIntent && searchResultMode === 'matched-lines'
  const matchedLineResultItems = useMemo<MatchedLineResultItem[]>(() => {
    if (!showMatchedLineResults) {
      return []
    }

    const items: MatchedLineResultItem[] = []
    for (const { day, matchedBlocks, blockKind } of visibleSearchResults) {
      const lineIndexes = blockKind === 'line' ? getMatchedBlockLineIndexes(day.contentMd, matchedBlocks) : null

      matchedBlocks.forEach((block, index) => {
        if (!block.trim()) {
          return
        }

        let displayBlock = block
        let openQuote = block
        let hasMore = false

        if (blockKind === 'section') {
          const preview = getHeadingPreviewFromSectionBlock(block)
          if (preview?.displayBlock) {
            displayBlock = preview.displayBlock
            openQuote = preview.headingLine || block
            hasMore = preview.hasMore
          }
        } else {
          const trimmedBlock = block.trimEnd()
          if (HEADING_LINE_REGEX.test(trimmedBlock)) {
            const preview = getHeadingPreviewFromDay(day, trimmedBlock)
            if (preview?.displayBlock) {
              displayBlock = preview.displayBlock
              openQuote = preview.headingLine || block
              hasMore = preview.hasMore
            }
          }
        }

        const matchedLineIndex =
          blockKind === 'line' && lineIndexes
            ? lineIndexes[index] >= 0
              ? lineIndexes[index]
              : null
            : null

        items.push({
          key: `${day.dayId}-${blockKind}-${index}`,
          day,
          block: displayBlock,
          openQuote,
          hasMore,
          blockIndex: index,
          sourceLineIndex: matchedLineIndex,
        })
      })
    }

    return items
  }, [showMatchedLineResults, visibleSearchResults])

  const handleOpenMatchedLineResult = useCallback(
    (dayId: string, quote: string) => {
      setSearchResultMode('whole-day')
      requestAnimationFrame(() => {
        void handleCitationClick({ day: dayId, quote })
      })
    },
    [handleCitationClick],
  )

  const handleToggleMatchedLineTodo = useCallback(
    (dayId: string, blockIndex: number, sourceLineIndex: number) => {
      let nextContentToSave: string | null = null

      setSearchResults((state) =>
        state.map((result) => {
          if (result.day.dayId !== dayId || result.blockKind !== 'line') {
            return result
          }

          const lines = result.day.contentMd.split('\n')
          const currentLine = lines[sourceLineIndex]
          if (currentLine == null) {
            return result
          }

          const toggledLine = toggleTodoLineMarker(currentLine)
          if (!toggledLine) {
            return result
          }

          lines[sourceLineIndex] = toggledLine
          const nextContent = lines.join('\n')
          const nextMatchedBlocks = [...result.matchedBlocks]
          if (blockIndex >= 0 && blockIndex < nextMatchedBlocks.length) {
            nextMatchedBlocks[blockIndex] = toggledLine.trimEnd()
          }

          nextContentToSave = nextContent

          return {
            ...result,
            day: {
              ...result.day,
              contentMd: nextContent,
            },
            matchedBlocks: nextMatchedBlocks,
          }
        }),
      )

      if (nextContentToSave !== null) {
        scheduleSave(dayId, nextContentToSave)
      }
    },
    [scheduleSave],
  )

  // --- Render ---

  const chatMessages = useMemo(() => [...messages].reverse(), [messages])
  const canToggleMatchedResultTodos = showMatchedLineResults && searchFilter === 'open-todos'

  const searchPillsContent =
    mode === 'search' ? (
      <SearchModePills
        searchFilter={searchFilter}
        resultMode={searchResultMode}
        onSearchFilterChange={setSearchFilter}
        onToggleResultMode={() => {
          setSearchResultMode((current) => (current === 'whole-day' ? 'matched-lines' : 'whole-day'))
        }}
      />
    ) : null

  const trayContent =
    mode === 'timeline' ? null : (
      <TrayInput
        mode={mode}
        sending={sending}
        chatError={chatError}
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

      {!hasSearchIntent && hasNoNotes && (
        <EmptyStateHero
          isLogoAnimating={isLogoAnimating}
          heroFontFamily={heroFontFamily}
          buttonPrimaryClassName={buttonPrimary}
          onStartToday={handleEmptyCta}
          heroLogoRef={heroLogoRef}
        />
      )}

      {!loading && noSearchResults && (
        <section className="flex min-h-[46vh] items-center justify-center">
          <p className="text-base font-semibold text-slate-400">No results</p>
        </section>
      )}

      {/* Main List */}
      {!loading && !hasNoNotes && showMatchedLineResults && matchedLineResultItems.length > 0 && (
        <div className="space-y-3">
          {matchedLineResultItems.map(({ key, day, block, openQuote, hasMore, blockIndex, sourceLineIndex }) => (
            <MatchedLineResultCard
              key={key}
              day={day}
              block={block}
              openQuote={openQuote}
              hasMore={hasMore}
              blockIndex={blockIndex}
              sourceLineIndex={sourceLineIndex}
              enableTodoToggle={canToggleMatchedResultTodos}
              todayId={todayId}
              contentTextStyle={matchedResultsTextStyle}
              searchQuery={searchQuery}
              onOpen={handleOpenMatchedLineResult}
              onToggleTodo={handleToggleMatchedLineTodo}
            />
          ))}
        </div>
      )}

      {!loading && !hasNoNotes && !showMatchedLineResults && activeItems.length > 0 && (
        <div className="space-y-3">
          {activeItems.map((item) => {
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

            const { day } = item
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
            const quote = highlightedQuote && highlightedQuote.day === day.dayId ? highlightedQuote.quote : null
            const shouldMountEditor =
                (mode === 'search' && searchResultMode === 'whole-day') ||
                mountedDayIds.has(day.dayId) ||
                editorRefs.current.has(day.dayId)

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

      {!loading && !hasNoNotes && isTimelineVisible && visibleDays.length > 0 && (
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
      {searchPillsContent ? <BottomTrayPortal containerId="bottom-tray-pills">{searchPillsContent}</BottomTrayPortal> : null}
      {trayContent ? <BottomTrayPortal>{trayContent}</BottomTrayPortal> : null}

      {showDesktopChatMode ? (
        <div className={`timeline-chat-layout ${showDesktopChatPanel ? 'is-chat-open' : 'is-chat-closed'}`}>
          <div className="timeline-chat-main">{timelineContent}</div>

          <aside className="timeline-chat-sidebar" aria-hidden={!showDesktopChatPanel}>
            <div className="timeline-chat-sidebar-inner">
              <button
                type="button"
                className="-mt-0.5 inline-flex h-9 items-center gap-2 self-start rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleNewChat}
                disabled={sending}
              >
                <img src="/pencil-simple-line.svg" alt="" className="h-3.5 w-3.5 opacity-80" />
                New chat
              </button>
              <ChatMessageList
                messages={messages}
                onAssistantMarkdownClick={handleAssistantMarkdownClick}
                onAssistantMarkdownKeyDown={handleAssistantMarkdownKeyDown}
                onChatInsert={(message) => {
                  void handleChatInsert(message)
                }}
              />
            </div>
          </aside>
        </div>
      ) : (
        timelineContent
      )}

      {pendingDeleteDayId && (
        <div className="pointer-events-none fixed left-0 top-[calc(env(safe-area-inset-top)+3.5rem)] z-40 px-3">
          <div
            className="pointer-events-auto flex w-[min(12rem,calc(100vw-1.5rem))] items-center justify-between gap-2 whitespace-nowrap rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 shadow-[0_14px_28px_-18px_rgba(15,23,42,0.45)] backdrop-blur-sm"
            role="status"
            aria-live="polite"
          >
            <span className="truncate text-sm font-medium text-slate-700">Day deleted</span>
            <button
              className="group inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#d9efff] px-2 py-1 text-xs font-bold text-[#0b84c6] transition hover:bg-[#22B3FF] hover:text-white"
              type="button"
              onClick={handleUndoDelete}
            >
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 bg-current [mask-image:url('/arrow-u-up-left.svg')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain] [-webkit-mask-image:url('/arrow-u-up-left.svg')] [-webkit-mask-position:center] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain]"
              />
              UNDO
            </button>
          </div>
        </div>
      )}

      {/* Mobile chat overlay (Mode A) */}
      {showMobileChatOverlay && (
        <>
          <div className="fixed inset-0 z-20 sm:hidden">
            <div
              className="pointer-events-none absolute inset-0 bg-white/50 backdrop-blur-lg"
              style={{
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
              }}
            />
            <div
              ref={mobileChatScrollRef}
              className="relative flex h-full flex-col-reverse gap-3 overflow-y-auto overscroll-y-contain px-2"
              style={{
                paddingTop: 'calc(env(safe-area-inset-top) + 4rem)',
                paddingBottom: 'calc(var(--keyboard-offset, 0px) + env(safe-area-inset-bottom) + 8rem)',
                scrollPaddingBottom: 'calc(var(--keyboard-offset, 0px) + env(safe-area-inset-bottom) + 8rem)',
              }}
            >
              <ChatMessageList
                messages={chatMessages}
                mobile
                onAssistantMarkdownClick={handleAssistantMarkdownClick}
                onAssistantMarkdownKeyDown={handleAssistantMarkdownKeyDown}
                onChatInsert={(message) => {
                  void handleChatInsert(message)
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
