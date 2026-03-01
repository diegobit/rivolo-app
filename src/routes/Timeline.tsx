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
import { TIMELINE_FOCUS_TODAY_EVENT, TIMELINE_SCROLL_TODAY_EVENT } from '../lib/timelineEvents'
import { addDays, formatHumanDate, getTodayId, parseDayId } from '../lib/dates'
import { debugLog, startDebugTimer } from '../lib/debugLogs'
import type { Day } from '../lib/dayRepository'
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
const INITIAL_EDITOR_MOUNT_COUNT = 6
const EDITOR_HYDRATE_OBSERVER_MARGIN = '70% 0px 90% 0px'
const EDITOR_PIN_TTL_MS = 20_000
const EDITOR_PIN_PRUNE_INTERVAL_MS = 4_000
const LOG_SCOPE = 'TimelinePerf'

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
  const hasNoNotes = !loading && days.length === 0

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
  const [searchResults, setSearchResults] = useState<Day[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [dateErrors, setDateErrors] = useState<Record<string, string | null>>({})
  const [highlightedQuote, setHighlightedQuote] = useState<Citation | null>(null)
  const [isLogoAnimating, setIsLogoAnimating] = useState(false)
  const [isHeroRevealActive, setIsHeroRevealActive] = useState(false)
  const [isHeroRevealHold, setIsHeroRevealHold] = useState(false)
  const [isNarrowViewportMode, setIsNarrowViewportMode] = useState(() => isNarrowViewport())

  const canSync = Boolean(syncStatus.connected && syncStatus.filePath)
  const rawSearchQuery = mode === 'search' ? searchText.trim() : ''
  const deferredSearchQuery = useDeferredValue(rawSearchQuery)
  const searchQuery = mode === 'search' ? deferredSearchQuery : ''
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
  }, [canSync, pushToSyncAndRefresh])

  const { sending, chatError, handleChatSend, handleChatInsert } = useTimelineChat({
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

  const {
    mountedDayIds,
    pinDayForEditorMount,
    requestDayEditorMount,
    registerEditor,
    registerDayRef,
    recomputeMountedEditors,
    setDayOrder,
  } = useEditorMountWindow({
    days,
    isSearchMode: mode === 'search',
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

      if (highlightedQuote) {
        setHighlightedQuote(null)
      }

      pinDayForEditorMount(dayId, 'edit', false)

      setSearchResults((state) =>
        state.map((day) => (day.dayId === dayId ? { ...day, contentMd: value } : day)),
      )
      scheduleSave(dayId, value)
    },
    [highlightedQuote, pinDayForEditorMount, scheduleSave, setSearchResults],
  )

  const { handleAssistantMarkdownClick, handleAssistantMarkdownKeyDown } = useCitationNavigation({
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
  const hasToday = useMemo(() => days.some((day) => day.dayId === todayId), [days, todayId])

  const futureDayId = useMemo(() => {
    const existing = new Set(days.map((day) => day.dayId))
    let candidate = addDays(todayId, 1) // Start from tomorrow
    while (existing.has(candidate)) {
      candidate = addDays(candidate, 1)
    }
    return candidate
  }, [days, todayId])

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
    if (days.length === 0) {
      return [{ type: 'add-today', dayId: todayId }]
    }

    const items: TimelineItem[] = []
    const showAddFuture = hasToday
    let addedFutureButton = false
    let addedTodayButton = false

    for (const day of days) {
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
  }, [days, futureDayId, hasToday, todayId])

  const activeItems = useMemo<TimelineItem[]>(() => {
    if (mode === 'search' && searchText.trim() && searchResults.length > 0) {
      return searchResults.map((day) => ({
        type: 'day',
        day,
      }))
    }

    return standardItems
  }, [mode, searchResults, searchText, standardItems])

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
        <EmptyStateHero
          isLogoAnimating={isLogoAnimating}
          heroFontFamily={heroFontFamily}
          buttonPrimaryClassName={buttonPrimary}
          onStartToday={handleEmptyCta}
          heroLogoRef={heroLogoRef}
        />
      )}

      {/* Main List */}
      {!loading && !hasNoNotes && activeItems.length > 0 && (
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
                paddingBottom: 'calc(var(--keyboard-offset, 0px) + env(safe-area-inset-bottom) + 5.75rem)',
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
