import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import BottomTrayPortal from '../components/BottomTrayPortal'
import DayEditorCard from '../components/timeline/DayEditorCard'
import EmptyStateHero from '../components/timeline/EmptyStateHero'
import ChatMessageList from '../components/timeline/ChatMessageList'
import { isIOS, isPrimaryModifierPressed, preferredScrollBehavior } from '../lib/device'
import { lockPageScroll } from '../lib/pageScrollLock'
import { getBodyFontFamily, getMonospaceFontFamily, getMonospaceFontSize, getTitleFontFamily } from '../lib/fonts'
import { useIsNarrowViewport } from '../hooks/useIsNarrowViewport'
import {
  TIMELINE_NEW_CHAT_EVENT,
  TIMELINE_SCROLL_TODAY_EVENT,
} from '../lib/timelineEvents'
import { addDays, formatHumanDate, getTodayId, parseDayId } from '../lib/dates'
import { SEARCH_FILTER_LABELS } from '../lib/searchFilters'
import { debugLog, startDebugTimer } from '../lib/debugLogs'
import type { Day, DaySearchResult, SearchFilter } from '../lib/dayRepository'
import { appendToDay, searchDays } from '../lib/dayRepository'
import { buttonPrimary } from '../lib/ui'
import { useCitationNavigation } from './timeline/useCitationNavigation'
import { focusLauncher } from '../components/app-shell/desktopCards'
import { useStickToBottom } from './timeline/useStickToBottom'
import { keepEditedDayInResults } from './timeline/searchResults'
import { useDaySaveQueue } from './timeline/useDaySaveQueue'
import { useEditorMountWindow } from './timeline/useEditorMountWindow'
import { useOlderDaysLoader } from './timeline/useOlderDaysLoader'
import { usePendingDayDelete } from './timeline/usePendingDayDelete'
import { useTimelineChat } from './timeline/useTimelineChat'
import { useMobileChatScroll } from './timeline/useMobileChatScroll'
import { toggleTodoLineMarker } from './timeline/todoToggle'
import { getMatchedBlockLineIndexes } from './timeline/syntaxHighlight'
import { HEADING_LINE_REGEX, getHeadingPreviewFromDay, getHeadingPreviewFromSectionBlock } from './timeline/headingPreview'
import SearchModePills from './timeline/SearchModePills'
import MatchedLineResultCard, { type MatchedLineResultItem } from './timeline/MatchedLineResultCard'
import { useSettingsStore } from '../store/useSettingsStore'
import { resolveActiveLlmConfig } from '../lib/llm/types'
import { useSyncStore } from '../store/useSyncStore'
import { useDaysStore } from '../store/useDaysStore'
import { useUIStore } from '../store/useUIStore'
import { useChatStore, type ChatCitation as Citation } from '../store/useChatStore'
import { scheduleAutoPushToSync } from '../store/syncActions'

type TimelineItem =
  | { type: 'day'; day: Day }
  | { type: 'add-today'; dayId: string }
  | { type: 'add-future'; dayId: string }

type TrayInputMode = 'chat' | 'search'

export type SearchResultMode = 'whole-day' | 'matched-lines'

type TrayInputProps = {
  mode: TrayInputMode
  draftText: string
  onDraftTextChange: (value: string) => void
  sending: boolean
  chatError: string | null
  // Resolves false when the draft was rejected (e.g. no provider configured).
  onChatSubmit: (value: string) => Promise<boolean>
  onSearchTextChange: (value: string) => void
}

type TrayInputConfig = {
  placeholder: string
  id: string
  enterKeyHint: 'send' | 'search'
}

const SEARCH_CARD_PAGE_SIZE = 50

const CHAT_TEXTAREA_MIN_HEIGHT_PX = 40
const CHAT_TEXTAREA_MAX_HEIGHT_PX = 136
const CHAT_TEXTAREA_EXPANDED_DELTA_PX = 4
const CHAT_TEXTAREA_SINGLE_LINE_FALLBACK_PX = CHAT_TEXTAREA_MIN_HEIGHT_PX

// One line of text plus vertical padding, derived from styles rather than from
// the current content: a remounted composer may already hold a multiline draft.
const measureSingleLineHeight = (textarea: HTMLTextAreaElement) => {
  const style = window.getComputedStyle(textarea)
  const height =
    parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
  return Number.isFinite(height) && height > 0 ? height : CHAT_TEXTAREA_SINGLE_LINE_FALLBACK_PX
}

const TrayInput = memo(({
  mode,
  draftText,
  onDraftTextChange,
  sending,
  chatError,
  onChatSubmit,
  onSearchTextChange,
}: TrayInputProps) => {
  const debounceRef = useRef<number | null>(null)
  const prevModeRef = useRef<TrayInputMode>(mode)
  const chatTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const searchTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isChatMode = mode === 'chat'
  const hasSearchText = draftText.trim().length > 0
  const trayFieldClassName =
    'block w-full h-10 appearance-none bg-transparent py-2 pl-3 pr-3 text-base leading-6 text-[var(--theme-text)] outline-none placeholder:text-slate-400'

  const inputConfig = useMemo<TrayInputConfig>(() => {
    if (isChatMode) {
      return {
        placeholder: 'Ask anything',
        id: 'chat-input',
        enterKeyHint: 'send',
      }
    }

    return {
      placeholder: 'Search all days',
      id: 'search-input',
      enterKeyHint: 'search',
    }
  }, [isChatMode])

  const syncChatTextareaHeight = useCallback(() => {
    const textarea = chatTextareaRef.current
    if (!textarea) {
      return
    }

    textarea.style.height = 'auto'
    const measuredHeight = textarea.scrollHeight
    const singleLineCeiling = measureSingleLineHeight(textarea) + CHAT_TEXTAREA_EXPANDED_DELTA_PX
    const nextHeight = Math.min(
      measuredHeight <= singleLineCeiling ? CHAT_TEXTAREA_MIN_HEIGHT_PX : measuredHeight,
      CHAT_TEXTAREA_MAX_HEIGHT_PX,
    )
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > CHAT_TEXTAREA_MAX_HEIGHT_PX ? 'auto' : 'hidden'
  }, [])

  useLayoutEffect(() => {
    if (!isChatMode) {
      return
    }

    syncChatTextareaHeight()
  }, [draftText, isChatMode, syncChatTextareaHeight])

  // A width change (moving between the tray and a card, or the card narrowing)
  // rewraps the draft, so the height has to be measured again.
  useEffect(() => {
    const textarea = chatTextareaRef.current
    if (!isChatMode || !textarea || typeof ResizeObserver === 'undefined') {
      return
    }

    let lastWidth = textarea.clientWidth
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === lastWidth) return
      lastWidth = textarea.clientWidth
      syncChatTextareaHeight()
    })
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [isChatMode, syncChatTextareaHeight])

  const submitChatDraft = useCallback(async () => {
    if (mode !== 'chat' || sending) {
      return
    }

    const trimmed = draftText.trim()
    if (!trimmed) {
      return
    }

    onDraftTextChange('')
    const sent = await onChatSubmit(trimmed)
    // Rejection is immediate, before anything else could be typed, so the
    // draft can simply be put back.
    if (!sent) onDraftTextChange(draftText)
  }, [draftText, mode, onChatSubmit, onDraftTextChange, sending])

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
    if (mode === 'chat') {
      await submitChatDraft()
      return
    }
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    onSearchTextChange(draftText)
    searchTextareaRef.current?.blur()
  }

  const handleClearSearch = () => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    onDraftTextChange('')
    onSearchTextChange('')
    // The Clear button disappears with the text; keep focus in the field
    // instead of dropping it on the page.
    document.getElementById(inputConfig.id)?.focus()
  }

  const showChatError = Boolean(chatError) && mode === 'chat'

  return (
    <div className="relative">
      <form className="flex items-end gap-3" onSubmit={handleSubmit}>
        <div className="relative flex-1">
          <p
            className={`tray-input-error absolute -top-8 left-0 z-10 w-max whitespace-nowrap rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-red-400 shadow-sm ${
              showChatError ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            aria-hidden={!showChatError}
          >
            {chatError}
          </p>
          {isChatMode ? (
            <textarea
              id={inputConfig.id}
              data-mobile-chat-composer
              ref={chatTextareaRef}
              autoComplete="off"
              rows={1}
              inputMode="text"
              className={`${trayFieldClassName} resize-none`}
              style={{
                minHeight: `${CHAT_TEXTAREA_MIN_HEIGHT_PX}px`,
                maxHeight: `${CHAT_TEXTAREA_MAX_HEIGHT_PX}px`,
              }}
              placeholder={inputConfig.placeholder}
              value={draftText}
              onChange={(event) => {
                onDraftTextChange(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey) {
                  return
                }

                if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) {
                  return
                }

                event.preventDefault()
                void submitChatDraft()
              }}
              enterKeyHint={inputConfig.enterKeyHint}
            />
          ) : (
            <textarea
              id={inputConfig.id}
              ref={searchTextareaRef}
              autoComplete="off"
              rows={1}
              inputMode="text"
              className={`${trayFieldClassName} resize-none overflow-hidden`}
              style={{
                minHeight: `${CHAT_TEXTAREA_MIN_HEIGHT_PX}px`,
                maxHeight: `${CHAT_TEXTAREA_MIN_HEIGHT_PX}px`,
              }}
              placeholder={inputConfig.placeholder}
              value={draftText}
              onChange={(event) => {
                onDraftTextChange(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              enterKeyHint={inputConfig.enterKeyHint}
            />
          )}
        </div>
        {mode === 'chat' && (
          <button
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-sm transition sm:h-10 sm:w-10 ${
              draftText.trim() && !sending ? 'bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)]' : 'bg-slate-300'
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
        {mode === 'search' && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center sm:h-10 sm:w-10">
            {hasSearchText ? (
              <button
                className="tray-input-clear group flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-500 sm:h-8 sm:w-8"
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
            ) : null}
          </div>
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

// --- Component ---

export default function Timeline() {
  const days = useDaysStore((state) => state.days)
  const loading = useDaysStore((state) => state.loading)
  const loadingMore = useDaysStore((state) => state.loadingMore)
  const hasMorePast = useDaysStore((state) => state.hasMorePast)
  const loadError = useDaysStore((state) => state.loadError)
  const loadTimeline = useDaysStore((state) => state.loadTimeline)
  const loadOlderDays = useDaysStore((state) => state.loadOlderDays)
  const loadDay = useDaysStore((state) => state.loadDay)
  const patchDayContent = useDaysStore((state) => state.patchDayContent)
  const updateDayContent = useDaysStore((state) => state.updateDayContent)
  const moveDayDate = useDaysStore((state) => state.moveDayDate)
  const deleteDay = useDaysStore((state) => state.deleteDay)
  const loadSettings = useSettingsStore((state) => state.loadSettings)
  const llmProvider = useSettingsStore((state) => state.provider)
  const llmProviderSettings = useSettingsStore((state) => state.providerSettings)
  const llmSecrets = useSettingsStore((state) => state.llmSecrets)
  const allowWebSearch = useSettingsStore((state) => state.allowWebSearch)
  const aiLanguage = useSettingsStore((state) => state.aiLanguage)
  const autocorrection = useSettingsStore((state) => state.autocorrection)
  const fontPreference = useSettingsStore((state) => state.fontPreference)
  const bodyFont = useSettingsStore((state) => state.bodyFont)
  const monospaceFont = useSettingsStore((state) => state.monospaceFont)
  const titleFont = useSettingsStore((state) => state.titleFont)
  const activeLlmConfig = useMemo(
    () => resolveActiveLlmConfig(llmProvider, llmProviderSettings, llmSecrets),
    [llmProvider, llmProviderSettings, llmSecrets],
  )
  const loadSyncState = useSyncStore((state) => state.loadState)
  const syncStatus = useSyncStore((state) => state.status)
  const mode = useUIStore((state) => state.mode)
  const setMode = useUIStore((state) => state.setMode)
  const chatPanelOpen = useUIStore((state) => state.chatPanelOpen)
  const setChatPanelOpen = useUIStore((state) => state.setChatPanelOpen)
  const chatMessageCount = useUIStore((state) => state.chatMessageCount)
  const setChatMessageCount = useUIStore((state) => state.setChatMessageCount)
  const setChatSending = useUIStore((state) => state.setChatSending)
  const setTimelineEmpty = useUIStore((state) => state.setTimelineEmpty)
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

  // Drafts live here so the desktop chat composer and the tray input keep
  // their own text when their components unmount on mode switches.
  const [chatDraftText, setChatDraftText] = useState('')
  const [searchDraftText, setSearchDraftText] = useState('')

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
  const isNarrowViewportMode = useIsNarrowViewport()

  // Crossing the narrow breakpoint moves the composer between the tray and a
  // card, remounting it. The window resize event fires before the media query
  // change re-renders anything, so note which composer had focus there and
  // give focus back once the new one is mounted.
  const refocusComposerAfterFlipRef = useRef<string | null>(null)
  useEffect(() => {
    const rememberFocusedComposer = () => {
      const id = document.activeElement?.id
      refocusComposerAfterFlipRef.current = id === 'chat-input' || id === 'search-input' ? id : null
    }
    window.addEventListener('resize', rememberFocusedComposer)
    return () => window.removeEventListener('resize', rememberFocusedComposer)
  }, [])
  useEffect(() => {
    const id = refocusComposerAfterFlipRef.current
    if (!id) return
    refocusComposerAfterFlipRef.current = null
    requestAnimationFrame(() => document.getElementById(id)?.focus())
  }, [isNarrowViewportMode])
  const searchResultsRef = useRef<DaySearchResult[]>([])

  const hasRestoredScroll = useRef(false)
  const editorRefs = useRef(new Map<string, EditorView>())
  const isNarrowViewportModeRef = useRef(isNarrowViewportMode)
  useEffect(() => {
    isNarrowViewportModeRef.current = isNarrowViewportMode
  }, [isNarrowViewportMode])
  const dayRefs = useRef(new Map<string, HTMLDivElement>())
  const olderDaysSentinelRef = useRef<HTMLDivElement | null>(null)
  const createdDayIdsRef = useRef(new Set<string>())
  const pendingFocusRef = useRef<{ dayId: string; position: 'start' | 'end' } | null>(null)
  const addTodayRef = useRef<HTMLDivElement | null>(null)
  const heroLogoRef = useRef<HTMLImageElement | null>(null)
  const heroRevealPending = useRef(false)

  const canSync = Boolean(syncStatus.connected && syncStatus.targetName)

  const handleAutoPush = useCallback(async () => {
    if (!canSync || !navigator.onLine) return
    scheduleAutoPushToSync()
  }, [canSync])

  const clearDateError = useCallback((dayId: string) => {
    setDateErrors((state) => {
      if (!state[dayId]) return state
      const next = { ...state }
      delete next[dayId]
      return next
    })
  }, [])

  // Results come from the database, so an edited note changes which blocks
  // match only once it is saved; searching again then keeps the card current.
  const [savedNotesRevision, setSavedNotesRevision] = useState(0)
  const handleDaySaved = useCallback(() => {
    setSavedNotesRevision((revision) => revision + 1)
  }, [])

  const {
    clearDaySaveToken,
    discardPendingDaySave,
    flushPendingDaySave,
    markDaySavesStale,
    saveDayImmediately,
    scheduleSave,
    setPendingSaveContent,
  } = useDaySaveQueue({
    canSync,
    updateDayContent,
    onAutoPush: handleAutoPush,
    onDaySaved: handleDaySaved,
  })

  const {
    finalizeDeleteDayNow,
    handleDeleteDay,
    handleUndoDelete,
    hiddenDeleteDayIds,
    pendingDeleteDayId,
    prepareDayForCreate,
  } = usePendingDayDelete({
    clearDateError,
    createdDayIdsRef,
    deleteDay,
    discardPendingDaySave,
    flushPendingDaySave,
    markDaySavesStale,
    onAutoPush: handleAutoPush,
    setSearchResults,
  })

  useEffect(() => {
    searchResultsRef.current = searchResults
  }, [searchResults])

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
  const hasNoNotes = !loading && !loadError && visibleDays.length === 0

  const rawSearchQuery = mode === 'search' ? searchText.trim() : ''
  const deferredSearchQuery = useDeferredValue(rawSearchQuery)
  const searchQuery = mode === 'search' ? deferredSearchQuery : ''
  // Desktop search renders results inside the floating left card and never
  // filters the timeline; only the narrow-viewport tray search filters it.
  const isDesktopSearchCardOpen = mode === 'search' && !isNarrowViewportMode
  const isMobileSearchMode = mode === 'search' && isNarrowViewportMode
  const hasSearchIntent = isMobileSearchMode && (Boolean(searchQuery) || Boolean(searchFilter))
  // Only the narrow-viewport search ever hides the timeline: hasSearchIntent
  // already implies mode === 'search', so this is simply !hasSearchIntent.
  const isTimelineVisible = !hasSearchIntent
  const hasChatMessages = messages.length > 0
  const mobileChatContentKey = useMemo(
    () => messages.map((message) => `${message.id}:${message.content}:${message.meta?.isStreaming ?? false}`).join('\u0000'),
    [messages],
  )
  const showDesktopChatMode = mode === 'chat' && !isNarrowViewportMode
  const showDesktopChatPanel = showDesktopChatMode
  const lastChatMessage = messages[messages.length - 1]
  // Grows with every new message and every streamed chunk of the last one.
  const chatContentKey = `${messages.length}:${lastChatMessage?.content.length ?? 0}:${lastChatMessage?.meta?.isStreaming ? 1 : 0}`
  const chatScroll = useStickToBottom(showDesktopChatPanel, chatContentKey)
  const showMobileChatOverlay = mode === 'chat' && isNarrowViewportMode && (chatPanelOpen || chatMessageCount > 0)
  const mobileChatScroll = useMobileChatScroll(showMobileChatOverlay, mobileChatContentKey)
  const todayId = getTodayId()
  const yesterdayId = addDays(todayId, -1)
  const tomorrowId = addDays(todayId, 1)
  const heroFadeDuration = 600
  const heroRevealFallback = 1000
  const heroLogoDuration = 600
  const isIosDevice = isIOS()
  const supportsIntersectionObserver = typeof window !== 'undefined' && 'IntersectionObserver' in window

  const markdownExtension = useMemo(() => markdown({ base: markdownLanguage }), [])
  const editorTheme = useMemo(
    () =>
      EditorView.theme({
        '&.cm-editor': {
          backgroundColor: 'transparent',
        },
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
          color: 'var(--theme-editor-text)',
        },
        '.cm-content': {
          minHeight: '30px',
          padding: '0',
        },
        '.cm-gutters': {
          display: 'none',
        },
        '.cm-cursor, .cm-dropCursor': {
          borderLeft: '2px solid var(--theme-accent)',
          borderRadius: '2px',
        },
        '& .cm-selectionBackground': {
          backgroundColor: 'var(--theme-selection)',
        },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
          backgroundColor: 'var(--theme-selection)',
        },
        '.cm-content ::selection': {
          backgroundColor: 'var(--theme-selection)',
        },
        '.cm-line::selection, .cm-line > span::selection': {
          backgroundColor: 'var(--theme-selection)',
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
      color: 'var(--theme-editor-text)',
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
    if (!showMobileChatOverlay) return
    const unlock = lockPageScroll()

    const handleTouchMove = (event: TouchEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (mobileChatScroll.scrollerRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-mobile-chat-composer]')) return
      if (target instanceof Element && target.closest('[data-mobile-chat-menu]')) return
      event.preventDefault()
    }

    document.addEventListener('touchmove', handleTouchMove, { passive: false })

    return () => {
      unlock()
      document.removeEventListener('touchmove', handleTouchMove)
    }
  }, [showMobileChatOverlay, mobileChatScroll.scrollerRef])

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
    setTimelineEmpty(hasNoNotes)

    if (hasNoNotes || isLogoAnimating) {
      document.body.dataset.emptyState = 'true'
    } else {
      delete document.body.dataset.emptyState
    }

    if (hasNoNotes && !isLogoAnimating && !showMobileChatOverlay) {
      document.body.dataset.heroWallpaper = 'true'
      document.body.dataset.heroUi = 'true'
      return
    }

    delete document.body.dataset.heroWallpaper
    delete document.body.dataset.heroUi
  }, [hasNoNotes, isLogoAnimating, setTimelineEmpty, showMobileChatOverlay])

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
      setTimelineEmpty(null)
      delete document.body.dataset.emptyState
      delete document.body.dataset.heroWallpaper
      delete document.body.dataset.heroUi
      delete document.body.dataset.heroReveal
    }
  }, [setTimelineEmpty])

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

    if (!searchQuery && !searchFilter) {
      setSearchResults([])
      setSearchLoading(false)
      setSearchError(null)
      return
    }

    let cancelled = false
    setSearchLoading(true)
    setSearchError(null)

    const runSearch = async () => {
      try {
        const data = await searchDays(searchQuery, { filter: searchFilter })
        if (cancelled) return
        // view.hasFocus is false whenever the window is unfocused, which is
        // exactly when pending edits are saved (switching apps mid-edit), so
        // check the editor's own element instead.
        const editedDayId = isNarrowViewportModeRef.current
          ? ([...editorRefs.current.entries()].find(([, view]) => view.dom.contains(document.activeElement))?.[0] ??
            null)
          : null
        setSearchResults((previous) => keepEditedDayInResults(data, previous, editedDayId))
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
    // savedNotesRevision re-runs the search once an edited note is saved;
    // searchResultMode, so switching Days/Lines never shows a kept day's stale lines.
  }, [mode, savedNotesRevision, searchFilter, searchQuery, searchResultMode])

  // --- Handlers ---

  const handleChatInsertNote = useCallback(
    async (targetDay: string, text: string) => {
      await appendToDay(targetDay, text)
      await loadTimeline()
      await handleAutoPush()
    },
    [handleAutoPush, loadTimeline],
  )

  const { sending, chatError, handleChatSend, handleChatInsert, handleNewChat } = useTimelineChat({
    messages,
    setMessages,
    aiLanguage,
    allowWebSearch,
    activeLlmConfig,
    isNarrowViewport: isNarrowViewportMode,
    chatPanelOpen,
    setChatPanelOpen,
    onInsertNote: handleChatInsertNote,
  })

  useEffect(() => {
    setChatSending(sending)
    return () => setChatSending(false)
  }, [sending, setChatSending])

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
      scrollBehavior: ScrollBehavior = preferredScrollBehavior(),
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
      await prepareDayForCreate(dayId)

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
    [loadDay, pinDayForEditorMount, prepareDayForCreate, revealDay],
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

      if (view) {
        setPendingSaveContent(dayId, content)
      }

      await flushPendingDaySave(dayId)
      markDaySavesStale(dayId)

      const result = await moveDayDate(dayId, nextDayId)
      if (result.error) {
        const dateError = result.error
        setDateErrors((state) => ({ ...state, [dayId]: dateError }))
        return
      }

      if (result.conflict) {
        setDateErrors((state) => ({ ...state, [dayId]: 'Day already exists. Choose another date.' }))
        return
      }

      setDateErrors((state) => ({ ...state, [dayId]: null }))

      if (createdDayIdsRef.current.has(dayId)) {
        createdDayIdsRef.current.delete(dayId)
        createdDayIdsRef.current.add(nextDayId)
      }
      clearDaySaveToken(nextDayId)
      pinDayForEditorMount(nextDayId, 'dateMove')
      await handleAutoPush()
      revealDay(nextDayId, 'end')
    },
    [
      clearDaySaveToken,
      flushPendingDaySave,
      handleAutoPush,
      markDaySavesStale,
      moveDayDate,
      pinDayForEditorMount,
      revealDay,
      setPendingSaveContent,
    ],
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
    setMode,
  })

  const handleRetryLoad = useCallback(() => {
    void loadTimeline()
  }, [loadTimeline])

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
    addTodayRef.current?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' })
  }, [hasToday, revealDay, todayId])

  const handleNewTodayEntry = useCallback(async () => {
    const focusTodayEditor = () => {
      const view = editorRefs.current.get(todayId)
      if (!view) return false

      const content = view.state.doc.toString()
      const needsNewline = content.length > 0 && !content.endsWith('\n')
      const targetPosition = content.length + (needsNewline ? 1 : 0)

      if (needsNewline) {
        const nextContent = `${content}\n`
        view.dispatch({
          changes: { from: content.length, insert: '\n' },
          selection: EditorSelection.single(targetPosition),
          scrollIntoView: true,
        })
        patchDayContent(todayId, nextContent)
        scheduleSave(todayId, nextContent)
      } else {
        view.dispatch({ selection: EditorSelection.single(targetPosition), scrollIntoView: true })
      }

      view.focus()
      return true
    }

    if (hasToday) {
      if (!editorRefs.current.has(todayId)) {
        const today = visibleDays.find((day) => day.dayId === todayId)
        if (today?.contentMd && !today.contentMd.endsWith('\n')) {
          const nextContent = `${today.contentMd}\n`
          patchDayContent(todayId, nextContent)
          scheduleSave(todayId, nextContent)
        }
        requestDayEditorMount(todayId, 'end')
      }

      revealDay(todayId, undefined, 'start', false)
    } else {
      await handleCreateDay(todayId, {
        focusPosition: 'end',
        scrollBlock: 'start',
        focusScroll: false,
      })
    }

    let attempts = 0
    const maxAttempts = 12
    const focusWhenReady = () => {
      if (focusTodayEditor()) return
      if (attempts >= maxAttempts) return
      attempts += 1
      requestAnimationFrame(focusWhenReady)
    }

    requestAnimationFrame(focusWhenReady)
  }, [handleCreateDay, hasToday, patchDayContent, requestDayEditorMount, revealDay, scheduleSave, todayId, visibleDays])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!isPrimaryModifierPressed(event) || !event.shiftKey || event.altKey) return

      const key = event.key.toLowerCase()
      if (key !== 'e' && key !== 'y') return
      event.preventDefault()

      if (key === 'e') {
        void handleNewTodayEntry()
        return
      }

      handleScrollToToday()
    }

    window.addEventListener('keydown', handleKeydown, true)
    return () => window.removeEventListener('keydown', handleKeydown, true)
  }, [handleNewTodayEntry, handleScrollToToday])

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
  const showSearchError = hasSearchIntent && !searchLoading && Boolean(searchError)
  const showMatchedLineResults = hasSearchIntent && searchResultMode === 'matched-lines'
  const matchedLineResultItems = useMemo<MatchedLineResultItem[]>(() => {
    // One item per matched block, for the narrow-viewport list in matched-lines
    // mode and for the desktop search card, which always lists every match.
    if (!showMatchedLineResults && !isDesktopSearchCardOpen) {
      return []
    }

    const items: MatchedLineResultItem[] = []
    for (const { day, matchedBlocks, blockKind } of visibleSearchResults) {
      const lineIndexes = blockKind === 'line' ? getMatchedBlockLineIndexes(day.contentMd, matchedBlocks) : null
      // A section opens at its heading, so repeated headings are located the same way.
      const sectionHeadingLineIndexes =
        blockKind === 'section'
          ? getMatchedBlockLineIndexes(
              day.contentMd,
              matchedBlocks.map((block) => getHeadingPreviewFromSectionBlock(block)?.headingLine || block.split('\n')[0]),
            )
          : null

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

        const headingLineIndex = sectionHeadingLineIndexes?.[index] ?? -1
        const sectionHeadingLineIndex = headingLineIndex >= 0 ? headingLineIndex : null

        items.push({
          key: `${day.dayId}-${blockKind}-${index}`,
          day,
          block: displayBlock,
          openQuote,
          hasMore,
          blockIndex: index,
          sourceLineIndex: matchedLineIndex,
          openLineIndex: blockKind === 'section' ? sectionHeadingLineIndex : matchedLineIndex,
        })
      })
    }

    return items
  }, [isDesktopSearchCardOpen, showMatchedLineResults, visibleSearchResults])

  const hasCardSearchIntent = isDesktopSearchCardOpen && (Boolean(searchQuery) || Boolean(searchFilter))
  const cardNoSearchResults =
    hasCardSearchIntent &&
    !searchLoading &&
    visibleSearchResults.length === 0 &&
    !searchError
  const showCardSearchError = hasCardSearchIntent && !searchLoading && Boolean(searchError)
  const cardMatchCount = matchedLineResultItems.length
  // One always-mounted live region, so screen readers hear every change.
  const cardSearchStatus = !hasCardSearchIntent
    ? ''
    : searchLoading
      ? 'Searching…'
      : showCardSearchError
        ? (searchError ?? '')
        : cardNoSearchResults
          ? 'No results'
          : `${cardMatchCount} ${cardMatchCount === 1 ? 'match' : 'matches'}`
  const isCardSearchMessage = showCardSearchError || cardNoSearchResults

  // Large result sets render a page at a time; the rest load as the list is
  // scrolled to its end. The page count resets only for a new query or filter,
  // so a refresh after an edit does not collapse a list the user has scrolled.
  const cardResultsKey = `${searchQuery}\u0000${searchFilter ?? ''}`
  const [cardResultPage, setCardResultPage] = useState({ key: cardResultsKey, limit: SEARCH_CARD_PAGE_SIZE })
  const cardResultLimit = cardResultPage.key === cardResultsKey ? cardResultPage.limit : SEARCH_CARD_PAGE_SIZE
  const visibleCardResultItems =
    cardMatchCount > cardResultLimit ? matchedLineResultItems.slice(0, cardResultLimit) : matchedLineResultItems
  const hiddenCardResultCount = cardMatchCount - visibleCardResultItems.length
  const showMoreCardResults = useCallback(() => {
    setCardResultPage({ key: cardResultsKey, limit: cardResultLimit + SEARCH_CARD_PAGE_SIZE })
  }, [cardResultLimit, cardResultsKey])
  const showMoreCardResultsRef = useRef<HTMLButtonElement | null>(null)
  // Set by ArrowDown past the last loaded result; focused once the page renders.
  const focusCardResultAfterLoadRef = useRef<number | null>(null)
  useEffect(() => {
    const pendingIndex = focusCardResultAfterLoadRef.current
    if (pendingIndex === null) return
    focusCardResultAfterLoadRef.current = null
    const openButtons = document.querySelectorAll<HTMLButtonElement>('#desktop-search-card .result-open-button')
    openButtons[pendingIndex]?.focus()
  }, [visibleCardResultItems.length])
  useEffect(() => {
    const button = showMoreCardResultsRef.current
    if (!button || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) showMoreCardResults()
    })
    observer.observe(button)
    return () => observer.disconnect()
  }, [hiddenCardResultCount, showMoreCardResults])

  // ArrowDown from the search field reaches the first result; the arrow keys
  // then move between results, and ArrowUp from the first returns to the field.
  const handleSearchCardKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const target = event.target as HTMLElement
    const openButtons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.result-open-button')]
    if (target.id === 'search-input') {
      if (event.key === 'ArrowDown' && openButtons.length > 0) {
        event.preventDefault()
        openButtons[0].focus()
      }
      return
    }

    const index = openButtons.indexOf(target as HTMLButtonElement)
    if (index === -1) return
    event.preventDefault()
    if (event.key === 'ArrowDown') {
      const showMore = event.currentTarget.querySelector<HTMLButtonElement>('.timeline-search-show-more')
      if (index === openButtons.length - 1 && showMore) {
        // Past the last loaded result: load the next page and continue there.
        focusCardResultAfterLoadRef.current = index + 1
        showMore.click()
        return
      }
      openButtons[Math.min(index + 1, openButtons.length - 1)].focus()
    } else if (index === 0) {
      document.getElementById('search-input')?.focus()
    } else {
      openButtons[index - 1].focus()
    }
  }, [])

  const handleOpenMatchedLineResult = useCallback(
    (dayId: string, quote: string, lineIndex?: number) => {
      // Narrow viewports keep the filtered search view and expand the day in
      // place. On desktop the card stays open so several results can be opened
      // in a row; only the unfiltered timeline behind it moves to the match.
      if (isNarrowViewportMode) {
        setSearchResultMode('whole-day')
      }

      requestAnimationFrame(() => {
        void handleCitationClick({ day: dayId, quote, lineIndex })
      })
    },
    [handleCitationClick, isNarrowViewportMode],
  )

  const handleToggleMatchedLineTodo = useCallback(
    (dayId: string, blockIndex: number, sourceLineIndex: number) => {
      const currentResults = searchResultsRef.current
      let nextContentToSave: string | null = null
      let hasChanges = false

      const nextResults = currentResults.map((result) => {
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
        hasChanges = true

        return {
          ...result,
          day: {
            ...result.day,
            contentMd: nextContent,
          },
          matchedBlocks: nextMatchedBlocks,
        }
      })

      if (!hasChanges || nextContentToSave === null) {
        return
      }

      searchResultsRef.current = nextResults
      setSearchResults(nextResults)
      patchDayContent(dayId, nextContentToSave)
      void saveDayImmediately(dayId, nextContentToSave)
    },
    [patchDayContent, saveDayImmediately],
  )

  // --- Render ---

  const canToggleMatchedResultTodos = showMatchedLineResults && searchFilter === 'open-todos'

  const renderSearchPills = (showResultMode: boolean) =>
    mode === 'search' ? (
      <SearchModePills
        searchFilter={searchFilter}
        resultMode={searchResultMode}
        showResultMode={showResultMode}
        onSearchFilterChange={setSearchFilter}
        onResultModeChange={setSearchResultMode}
      />
    ) : null

  // The tray composer only renders on narrow viewports; on desktop both the
  // chat composer and the search field live inside their floating cards.
  const trayContent =
    mode === 'timeline' || !isNarrowViewportMode ? null : (
      <TrayInput
        mode={mode}
        draftText={mode === 'chat' ? chatDraftText : searchDraftText}
        onDraftTextChange={mode === 'chat' ? setChatDraftText : setSearchDraftText}
        sending={sending}
        chatError={chatError}
        onChatSubmit={handleChatSend}
        onSearchTextChange={handleSearchTextChange}
      />
    )

  const timelineContent = (
    <>
      {hasSearchIntent && !searchLoading && !searchError && (
        <p className="sr-only" role="status" aria-live="polite">
          {showMatchedLineResults
            ? `${matchedLineResultItems.length} ${matchedLineResultItems.length === 1 ? 'line' : 'lines'}`
            : `${visibleSearchResults.length} ${visibleSearchResults.length === 1 ? 'day' : 'days'}`}
        </p>
      )}
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

      {!hasSearchIntent && !loading && loadError && (
        <section className="flex min-h-[46vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-base font-semibold text-rose-400">Could not load your notes — retry</p>
          <button className={buttonPrimary} type="button" onClick={handleRetryLoad}>
            Retry
          </button>
        </section>
      )}

      {!loading && noSearchResults && (
        <section
          className="flex min-h-[46vh] flex-col items-center justify-center gap-3 px-4 text-center"
          aria-live="polite"
        >
          <p className="text-base font-semibold text-[var(--theme-text-muted)]">
            {searchFilter
              ? `No ${SEARCH_FILTER_LABELS[searchFilter]} matches${searchQuery.trim() ? ` for “${searchQuery.trim()}”` : ''}`
              : searchQuery.trim()
                ? `No results for “${searchQuery.trim()}”`
                : 'No results'}
          </p>
          {searchFilter && (
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 text-sm font-semibold text-[var(--theme-text)] shadow-sm transition hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-hover)]"
              onClick={() => setSearchFilter(null)}
            >
              Clear filter
            </button>
          )}
        </section>
      )}

      {!loading && showSearchError && (
        <section className="flex min-h-[46vh] items-center justify-center px-4 text-center" aria-live="polite">
          <p className="text-base font-semibold text-[var(--theme-danger-text)]">{searchError}</p>
        </section>
      )}

      {/* Main List */}
      {!loading && !hasNoNotes && showMatchedLineResults && matchedLineResultItems.length > 0 && (
        <div className="space-y-3">
          {matchedLineResultItems.map(({ key, day, block, openQuote, hasMore, blockIndex, sourceLineIndex, openLineIndex }) => (
            <MatchedLineResultCard
              key={key}
              day={day}
              block={block}
              openQuote={openQuote}
              hasMore={hasMore}
              blockIndex={blockIndex}
              sourceLineIndex={sourceLineIndex}
              openLineIndex={openLineIndex}
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
                    className="add-day-label-button group inline-flex items-center gap-2 rounded-full bg-transparent px-3 py-1 text-sm font-semibold transition-colors"
                    type="button"
                    onClick={() => void handleCreateDay(item.dayId)}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--theme-accent)] transition group-hover:bg-[var(--theme-accent-hover)]">
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
                    className="add-day-label-button group inline-flex min-h-11 items-center gap-2 rounded-full bg-transparent px-3 py-1 text-sm font-semibold opacity-70 transition-colors"
                    type="button"
                    onClick={() => void handleCreateDay(item.dayId)}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--theme-accent)] transition group-hover:bg-[var(--theme-accent-hover)]">
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
            const shouldMountEditor = mountedDayIds.has(day.dayId) || editorRefs.current.has(day.dayId)

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
                autocorrection={autocorrection}
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

          {loadingMore && <p className="text-center text-xs text-slate-400">Loading older days...</p>}

          {!supportsIntersectionObserver && hasMorePast && !loadingMore && (
            <div className="flex justify-center">
              <button
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-700"
                type="button"
                onClick={() => handleLoadOlderDays('button')}
              >
                Load older days
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )

  const undoDeleteButton = (
    <button
      className="group inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-[var(--theme-accent-soft)] px-3 py-1 text-xs font-bold text-[var(--theme-accent-text)] transition hover:bg-[var(--theme-accent)] hover:text-white"
      type="button"
      onClick={handleUndoDelete}
    >
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 bg-current [mask-image:url('/arrow-u-up-left.svg')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain] [-webkit-mask-image:url('/arrow-u-up-left.svg')] [-webkit-mask-position:center] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain]"
      />
      UNDO
    </button>
  )

  return (
    <div>
      {isMobileSearchMode ? (
        <BottomTrayPortal containerId="bottom-tray-pills">{renderSearchPills(true)}</BottomTrayPortal>
      ) : null}
      {trayContent ? <BottomTrayPortal>{trayContent}</BottomTrayPortal> : null}

      {showMobileChatOverlay ? <div className="contents" inert>{timelineContent}</div> : timelineContent}

      {/* Desktop chat card */}
      {!isNarrowViewportMode && (
        <aside
          id="desktop-chat-card"
          className={`timeline-floating-card timeline-chat-sidebar ${showDesktopChatPanel ? 'is-chat-open' : 'is-chat-closed'}`}
          aria-labelledby="desktop-chat-title"
          aria-hidden={!showDesktopChatPanel}
          inert={!showDesktopChatPanel}
        >
          <div className="timeline-chat-sidebar-inner">
            <header className="timeline-chat-sidebar-header">
              <h2 id="desktop-chat-title" className="timeline-chat-sidebar-title">
                Chat
              </h2>
              <div className="timeline-chat-sidebar-actions">
                <button
                  type="button"
                  className="timeline-chat-sidebar-icon-button timeline-chat-sidebar-text-button"
                  aria-label="New chat"
                  title="New chat"
                  onClick={handleNewChat}
                  disabled={sending}
                >
                  <img src="/eraser.svg" alt="" className="h-4 w-4 opacity-80" />
                  <span className="timeline-chat-sidebar-button-label">New chat</span>
                </button>
                <button
                  type="button"
                  className="timeline-chat-sidebar-icon-button timeline-chat-sidebar-text-button"
                  aria-label="Close chat"
                  title="Close chat"
                  onClick={() => {
                    setMode('timeline')
                    focusLauncher('chat')
                  }}
                >
                  <img src="/plus.svg" alt="" className="h-4 w-4 rotate-45 opacity-80" />
                  <span className="timeline-chat-sidebar-button-label">Close</span>
                </button>
              </div>
            </header>
            <div
              ref={chatScroll.ref}
              className="timeline-chat-sidebar-messages"
              data-following={chatScroll.following ? 'true' : 'false'}
              onScroll={chatScroll.onScroll}
            >
              {hasChatMessages ? (
                <ChatMessageList
                  messages={messages}
                  onAssistantMarkdownClick={handleAssistantMarkdownClick}
                  onAssistantMarkdownKeyDown={handleAssistantMarkdownKeyDown}
                  onChatInsert={(message) => {
                    void handleChatInsert(message)
                  }}
                />
              ) : (
                <p className="timeline-chat-sidebar-empty">What can I help with?</p>
              )}
              {chatScroll.hasUnseen && (
                <button type="button" className="timeline-chat-jump-latest" onClick={chatScroll.scrollToBottom}>
                  New messages ↓
                </button>
              )}
            </div>
            <div className="timeline-chat-sidebar-composer">
              <div className="timeline-chat-composer-field">
                <TrayInput
                  mode="chat"
                  draftText={chatDraftText}
                  onDraftTextChange={setChatDraftText}
                  sending={sending}
                  chatError={chatError}
                  onChatSubmit={handleChatSend}
                  onSearchTextChange={handleSearchTextChange}
                />
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Desktop search card: it never filters the timeline. Opening a result
          keeps the card open and moves the unfiltered timeline to the match. */}
      {isDesktopSearchCardOpen && (
        <aside
          id="desktop-search-card"
          className="timeline-floating-card timeline-search-sidebar"
          aria-labelledby="desktop-search-title"
          onKeyDown={handleSearchCardKeyDown}
        >
          <div className="timeline-chat-sidebar-inner">
            <header className="timeline-chat-sidebar-header">
              <h2 id="desktop-search-title" className="timeline-chat-sidebar-title">
                Search
              </h2>
              <div className="timeline-chat-sidebar-actions">
                <button
                  type="button"
                  className="timeline-chat-sidebar-icon-button timeline-chat-sidebar-text-button"
                  aria-label="Close search"
                  title="Close search"
                  onClick={() => {
                    setMode('timeline')
                    focusLauncher('search')
                  }}
                >
                  <img src="/plus.svg" alt="" className="h-4 w-4 rotate-45 opacity-80" />
                  <span className="timeline-chat-sidebar-button-label">Close</span>
                </button>
              </div>
            </header>
            <div className="timeline-search-sidebar-results" aria-busy={searchLoading || undefined}>
              <p
                role="status"
                className={`timeline-search-sidebar-status ${isCardSearchMessage ? 'is-message' : ''} ${
                  showCardSearchError ? 'timeline-search-sidebar-status-error' : ''
                }`}
              >
                {cardSearchStatus}
              </p>
              {matchedLineResultItems.length > 0 && (
                // Results from the previous query stay visible, dimmed, while a new one runs.
                <div className={`space-y-3 ${searchLoading ? 'is-pending' : ''}`}>
                  {visibleCardResultItems.map(
                    ({ key, day, block, openQuote, hasMore, blockIndex, sourceLineIndex, openLineIndex }) => (
                      <MatchedLineResultCard
                        key={key}
                        day={day}
                        block={block}
                        openQuote={openQuote}
                        hasMore={hasMore}
                        blockIndex={blockIndex}
                        sourceLineIndex={sourceLineIndex}
                        openLineIndex={openLineIndex}
                        enableTodoToggle
                        todayId={todayId}
                        contentTextStyle={matchedResultsTextStyle}
                        searchQuery={searchQuery}
                        onOpen={handleOpenMatchedLineResult}
                        onToggleTodo={handleToggleMatchedLineTodo}
                      />
                    ),
                  )}
                </div>
              )}
              {hiddenCardResultCount > 0 && (
                <button
                  ref={showMoreCardResultsRef}
                  type="button"
                  className="timeline-search-show-more"
                  onClick={showMoreCardResults}
                >
                  Show {Math.min(hiddenCardResultCount, SEARCH_CARD_PAGE_SIZE)} more
                </button>
              )}
            </div>
            <div className="timeline-search-sidebar-pills">{renderSearchPills(false)}</div>
            <div className="timeline-search-sidebar-composer">
              <div className="timeline-chat-composer-field">
                <TrayInput
                  mode="search"
                  draftText={searchDraftText}
                  onDraftTextChange={setSearchDraftText}
                  sending={sending}
                  chatError={chatError}
                  onChatSubmit={handleChatSend}
                  onSearchTextChange={handleSearchTextChange}
                />
              </div>
            </div>
          </div>
        </aside>
      )}

      {pendingDeleteDayId && !hasNoNotes && !isNarrowViewportMode && (
        <BottomTrayPortal containerId="header-undo-slot">
          <div
            className="flex h-9 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] pl-3 pr-1.5 shadow-sm"
            role="status"
            aria-live="polite"
          >
            <span className="text-sm font-medium text-[var(--theme-text-soft)]">Day deleted</span>
            {undoDeleteButton}
          </div>
        </BottomTrayPortal>
      )}

      {pendingDeleteDayId && isNarrowViewportMode && (
        <div
          className="pointer-events-none fixed left-1/2 z-40 w-[min(96vw,620px)] -translate-x-1/2 px-2"
          style={{
            // Sit above the whole mobile bottom row (composer included in chat and
            // search, dock only in timeline), not just above the dock.
            bottom: 'var(--mobile-home-bottom-clearance, calc(env(safe-area-inset-bottom) + 5rem))',
          }}
        >
          <div
            className="pointer-events-auto flex w-[min(13.5rem,calc(100vw-1.5rem))] items-center justify-between gap-2 whitespace-nowrap rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2 shadow-[0_14px_28px_-18px_rgb(var(--theme-shadow-color)/0.45)]"
            role="status"
            aria-live="polite"
          >
            <span className="truncate text-sm font-medium text-[var(--theme-text-soft)]">Day deleted</span>
            {undoDeleteButton}
          </div>
        </div>
      )}

      {/* Mobile chat overlay */}
      {showMobileChatOverlay && (
        <>
          <div className="fixed inset-0 z-20 flex flex-col bg-[var(--theme-page)] sm:hidden">
            {/* The wordmark stays at the top of the chat, above the thread, so no
                message can ever run behind it. */}
            <div className="mt-4 flex h-16 shrink-0 items-center justify-center">
              <img src="/logo.svg" alt="Rivolo" className="h-10 w-auto" />
            </div>
            <div
              ref={mobileChatScroll.scrollerRef}
              onScroll={mobileChatScroll.onScroll}
              onTouchStart={mobileChatScroll.onTouchStart}
              onTouchEnd={mobileChatScroll.onTouchEnd}
              onTouchCancel={mobileChatScroll.onTouchEnd}
              className="relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 [overflow-anchor:none]"
              style={{
                paddingTop: '0.5rem',
                paddingBottom: 'var(--mobile-home-bottom-clearance)',
                scrollPaddingBottom: 'var(--mobile-home-bottom-clearance)',
              }}
            >
              <div ref={mobileChatScroll.contentRef} className="flex min-h-full flex-col justify-end gap-3">
                <ChatMessageList
                  messages={messages}
                  mobile
                  onAssistantMarkdownClick={handleAssistantMarkdownClick}
                  onAssistantMarkdownKeyDown={handleAssistantMarkdownKeyDown}
                  onChatInsert={(message) => {
                    void handleChatInsert(message)
                  }}
                />
              </div>
            </div>
            {mobileChatScroll.hasUnseen && !mobileChatScroll.following && (
              <button
                type="button"
                className="absolute bottom-[var(--mobile-home-bottom-clearance)] left-1/2 z-10 min-h-11 -translate-x-1/2 rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 text-sm font-semibold text-[var(--theme-text)] [box-shadow:var(--theme-card-shadow-soft)]"
                onClick={mobileChatScroll.scrollToBottom}
              >
                New messages
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
