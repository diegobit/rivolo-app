import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import BottomTrayRow from './app-shell/BottomTrayRow'
import MobileMenu from './app-shell/MobileMenu'
import AttentionPopover from './app-shell/AttentionPopover'
import ShortcutsPopover from './app-shell/ShortcutsPopover'
import { TIMELINE_SCROLL_TODAY_EVENT } from '../lib/timelineEvents'
import { isApplePlatform, isPrimaryModifierPressed, preferredScrollBehavior } from '../lib/device'
import { focusLauncher, isFocusOwnedByCard } from './app-shell/desktopCards'
import { useIsNarrowViewport } from '../hooks/useIsNarrowViewport'
import { useTabSyncState } from '../hooks/useTabSyncState'
import { useDatabasePersistFailure } from '../hooks/useDatabasePersistFailure'
import { useKeyboardOffsetCssVar } from '../hooks/useKeyboardOffsetCssVar'
import { useAutoSync } from './app-shell/useAutoSync'
import { isProviderReady } from '../lib/llm/readiness'
import { getSetupNotices } from '../lib/setupAttention'
import { buildAttentionItems } from '../lib/attention'
import { applyThemePreference, getNextThemePreference, themePreferenceLabels } from '../lib/theme'
import { pushToSyncAndRefresh } from '../store/syncActions'
import { useSettingsStore } from '../store/useSettingsStore'
import { useDaysStore } from '../store/useDaysStore'
import { useSyncStore } from '../store/useSyncStore'
import { useUIStore } from '../store/useUIStore'

const topIconButton =
  'flex h-11 w-11 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text-soft)] shadow-sm transition hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-hover)] sm:h-9 sm:w-9'
const trayIconButton =
  'flex h-11 w-11 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text-soft)] shadow-sm transition hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-hover)] sm:h-10 sm:w-10'
const backButtonClass =
  'flex h-11 w-11 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text-soft)] shadow-sm transition hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-hover)] sm:h-9 sm:w-9'
const MIN_BOTTOM_TRAY_HEIGHT_PX = 56
const ATTENTION_AFTER_WELCOME_DELAY_MS = 3000
const LOGO_FAST_CURRENT_RESET_MS = 900

export default function AppShell() {
  const location = useLocation()
  const loadSettings = useSettingsStore((state) => state.loadSettings)
  const timelineLoaded = useDaysStore((state) => state.loaded)
  const timelineLoading = useDaysStore((state) => state.loading)
  const timelineHasNotes = useDaysStore((state) => state.days.length > 0)
  const provider = useSettingsStore((state) => state.provider)
  const providerSettings = useSettingsStore((state) => state.providerSettings)
  const llmSecrets = useSettingsStore((state) => state.llmSecrets)
  const dismissedSetupNotices = useSettingsStore((state) => state.dismissedSetupNotices)
  const dismissSetupNotice = useSettingsStore((state) => state.dismissSetupNotice)
  const themePreference = useSettingsStore((state) => state.themePreference)
  const updateThemePreference = useSettingsStore((state) => state.updateThemePreference)
  const wallpaper = useSettingsStore((state) => state.wallpaper)
  const highlightInputMode = useSettingsStore((state) => state.highlightInputMode)
  const loadSyncState = useSyncStore((state) => state.loadState)
  const syncStatus = useSyncStore((state) => state.status)
  const syncing = useSyncStore((state) => state.syncing)
  const syncOperation = useSyncStore((state) => state.syncOperation)
  const syncAttention = useSyncStore((state) => state.syncAttention)
  const persistFailureMessage = useDatabasePersistFailure()
  const activeProvider = useSyncStore((state) => state.activeProvider)
  const mode = useUIStore((state) => state.mode)
  const setMode = useUIStore((state) => state.setMode)
  const chatPanelOpen = useUIStore((state) => state.chatPanelOpen)
  const desktopPanelExpanded = useUIStore((state) => state.desktopPanelExpanded)
  const timelineEmpty = useUIStore((state) => state.timelineEmpty)
  const tabSync = useTabSyncState()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [showScrollToToday, setShowScrollToToday] = useState(false)
  const [attentionLoaded, setAttentionLoaded] = useState(false)
  const [sawWelcome, setSawWelcome] = useState(false)
  const [postWelcomeAttentionReady, setPostWelcomeAttentionReady] = useState(false)
  const [isLogoCurrentFast, setIsLogoCurrentFast] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isNarrowViewportMode = useIsNarrowViewport()
  const shortcutsRef = useRef<HTMLDivElement | null>(null)
  const logoCurrentTimerRef = useRef<number | null>(null)

  // When already home, clicking the logo glides the page back to the top.
  const handleLogoClick = () => {
    setIsLogoCurrentFast(true)
    if (logoCurrentTimerRef.current !== null) {
      window.clearTimeout(logoCurrentTimerRef.current)
    }
    logoCurrentTimerRef.current = window.setTimeout(() => {
      setIsLogoCurrentFast(false)
      logoCurrentTimerRef.current = null
    }, LOGO_FAST_CURRENT_RESET_MS)

    if (location.pathname === '/') {
      window.scrollTo({ top: 0, behavior: preferredScrollBehavior() })
    }
  }
  const focusModeInputAfterSwitchRef = useRef(false)
  const showBackButton = location.pathname === '/settings' || location.pathname === '/privacy'
  const backTarget = location.pathname === '/privacy' ? '/settings' : '/'
  const isHome = location.pathname === '/'
  const showSettingsButton = isHome
  const isDesktopHome = isHome && !isNarrowViewportMode
  const isDesktopChatMode = isDesktopHome && mode === 'chat'
  const isDesktopSearchCardOpen = isDesktopHome && mode === 'search'
  const showTrayRow = isHome
  const isMobileHome = isHome && isNarrowViewportMode
  const isMobileChatOverlayUp = isMobileHome && mode === 'chat' && chatPanelOpen
  // The full-screen mobile chat renders its own brand bar, so the shell's logo
  // header steps aside only while that overlay is up.
  const showShellLogoHeader = isMobileHome && !isMobileChatOverlayUp
  const showLauncherButtons = !isNarrowViewportMode
  const launcherSpread = !isNarrowViewportMode
  const showDesktopShortcutsButton = isHome && !isNarrowViewportMode
  const showDesktopThemeButton = !isNarrowViewportMode && location.pathname !== '/settings'
  const syncDirection = syncOperation === 'push' ? 'up' : 'down'
  const setupNotices = attentionLoaded
    ? getSetupNotices({
        aiNeedsSetup: !isProviderReady(provider, providerSettings, llmSecrets),
        syncNeedsSetup: activeProvider === null,
        dismissed: dismissedSetupNotices,
      })
    : []
  const attentionItems = buildAttentionItems({
    persistFailureMessage,
    syncAttentionMessage: syncAttention?.message ?? null,
    setupNotices,
  })
  const isTimelineEmpty = timelineEmpty ?? !timelineHasNotes
  const isWelcomeVisible = timelineLoaded && !timelineLoading && isTimelineEmpty
  const isRealTimelineVisible = timelineLoaded && !timelineLoading && !isTimelineEmpty
  const timelineAttentionReady =
    isRealTimelineVisible && (!sawWelcome || postWelcomeAttentionReady)
  const showAttention =
    !tabSync.databaseStale && isHome && timelineAttentionReady && attentionItems.length > 0

  if (isHome && isWelcomeVisible && !sawWelcome) setSawWelcome(true)

  // The desktop launcher shows "Chat", so its accessible name matches the visible label.
  const chatButtonLabel = isDesktopHome && mode === 'chat' ? 'Hide chat' : 'Chat'
  const launcherShortcutModifier = isApplePlatform() ? '⌘' : 'Ctrl '

  const chatButton = (
    <button
      type="button"
      data-launcher="chat"
      className={`${trayIconButton} bottom-tray-launcher-button ${
        mode === 'chat' ? 'bg-[var(--theme-active)]' : ''
      }`}
      onClick={() => {
        // On desktop the AI button toggles the floating chat card: it dismisses
        // the open card back to the timeline, or opens chat and focuses the
        // composer from any other mode. On narrow viewports it only appears in
        // timeline mode and simply opens chat.
        if (isDesktopHome) {
          if (mode === 'chat') {
            setMode('timeline')
            return
          }
          setMode('chat')
          return
        }
        setMode('chat')
      }}
      aria-label={chatButtonLabel}
      title={isDesktopHome ? `${chatButtonLabel} (${launcherShortcutModifier.trim()}${isApplePlatform() ? '' : '+'}K)` : chatButtonLabel}
      aria-expanded={isDesktopChatMode}
      aria-controls={isDesktopChatMode ? 'desktop-chat-card' : undefined}
    >
      <img src="/sparkle.svg" alt="" className="h-5 w-5" />
      <span className="launcher-label" aria-hidden="true">Chat</span>
      <kbd className="launcher-kbd" aria-hidden="true">{launcherShortcutModifier}K</kbd>
    </button>
  )

  const searchButton = (
    <button
      type="button"
      data-launcher="search"
      className={`${trayIconButton} bottom-tray-launcher-button ${
        mode === 'search' ? 'bg-[var(--theme-active)]' : ''
      }`}
      onClick={() => {
        // On desktop the lens toggles the floating search card; on narrow
        // viewports it only appears in timeline mode and simply opens search.
        if (isDesktopHome) {
          setMode(mode === 'search' ? 'timeline' : 'search')
          return
        }
        setMode('search')
      }}
      aria-label={isDesktopHome && mode === 'search' ? 'Hide search' : 'Search'}
      title={
        isDesktopHome
          ? `${mode === 'search' ? 'Hide search' : 'Search'} (${launcherShortcutModifier.trim()}${isApplePlatform() ? '' : '+'}F)`
          : 'Search'
      }
      aria-expanded={isDesktopHome && mode === 'search'}
      aria-controls={isDesktopHome && mode === 'search' ? 'desktop-search-card' : undefined}
    >
      <img src="/magnifying-glass.svg" alt="" className="h-5 w-5" />
      <span className="launcher-label" aria-hidden="true">Search</span>
      <kbd className="launcher-kbd" aria-hidden="true">{launcherShortcutModifier}F</kbd>
    </button>
  )

  const modeToggleButton = (
    <button
      className={trayIconButton}
      onClick={() => setMode(mode === 'search' ? 'chat' : 'search')}
      aria-label={mode === 'search' ? 'Switch to chat' : 'Switch to search'}
    >
      <img src={mode === 'search' ? '/sparkle.svg' : '/magnifying-glass.svg'} alt="" className="h-5 w-5" />
    </button>
  )

  // The tray element stays mounted in every mode (hidden while the launcher
  // buttons own the row) so its portal target keeps a stable identity across
  // viewport and mode changes.
  const trayCenter = (
    <div className={`relative flex-1 w-full ${showLauncherButtons ? 'hidden' : ''}`}>
      <div
        id="bottom-tray-pills"
        data-mode={mode}
        className="bottom-tray-pills pointer-events-none absolute bottom-full left-0 right-0 mb-1 flex min-h-0 items-end justify-start sm:mb-2"
      />
      <div
        id="bottom-tray"
        data-mode={mode}
        data-highlight-input={highlightInputMode}
        className="bottom-tray-shell hero-ui-fade-down flex-1 rounded-[2.5rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2 shadow-[0_6px_18px_rgb(var(--theme-shadow-color)/0.16)] transition duration-300 sm:p-3"
      />
    </div>
  )

  const themeButtonLabel = `Theme: ${themePreferenceLabels[themePreference]}`
  const themeButtonIcon =
    themePreference === 'system' ? '/sun-horizon.svg' : themePreference === 'light' ? '/sun.svg' : '/moon.svg'
  const renderThemeButton = () => (
    <button
      type="button"
      className={`${topIconButton} hero-ui-fade-up`}
      aria-label={themeButtonLabel}
      title={themeButtonLabel}
      onClick={() => {
        void updateThemePreference(getNextThemePreference(themePreference))
      }}
    >
      <img src={themeButtonIcon} alt="" className="h-5 w-5" />
    </button>
  )

  useEffect(() => {
    let active = true
    void Promise.all([loadSettings(), loadSyncState()]).finally(() => {
      if (active) setAttentionLoaded(true)
    })
    return () => {
      active = false
    }
  }, [loadSettings, loadSyncState])

  useEffect(() => {
    return () => {
      if (logoCurrentTimerRef.current !== null) {
        window.clearTimeout(logoCurrentTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isHome || !timelineLoaded) return
    if (!isRealTimelineVisible || !sawWelcome || postWelcomeAttentionReady) return

    const timeout = window.setTimeout(() => {
      setPostWelcomeAttentionReady(true)
    }, ATTENTION_AFTER_WELCOME_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [isHome, isRealTimelineVisible, postWelcomeAttentionReady, sawWelcome, timelineLoaded])

  useEffect(() => {
    let rafId: number | null = null

    const applyScrollState = () => {
      rafId = null
      setIsScrolled(window.scrollY > 0)

      if (!isHome) {
        setShowScrollToToday(false)
        return
      }

      const scrolledFar = window.scrollY > window.innerHeight * 2.5
      if (!scrolledFar) {
        setShowScrollToToday(false)
        return
      }

      const todayTarget = document.querySelector<HTMLElement>("[data-scroll-target='today']")
      if (!todayTarget) {
        setShowScrollToToday(false)
        return
      }

      const rect = todayTarget.getBoundingClientRect()
      const farFromToday = Math.abs(rect.top) > window.innerHeight * 1.5
      setShowScrollToToday(farFromToday)
    }

    const handleScroll = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(applyScrollState)
    }

    applyScrollState()
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [isHome])

  useEffect(() => {
    document.body.dataset.wallpaper = wallpaper
  }, [wallpaper])

  useEffect(() => {
    applyThemePreference(themePreference)
    if (themePreference !== 'system') return
    if (typeof window.matchMedia !== 'function') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleThemeChange = () => {
      applyThemePreference(themePreference)
    }

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleThemeChange)
      return () => mediaQuery.removeEventListener('change', handleThemeChange)
    }

    mediaQuery.addListener(handleThemeChange)
    return () => mediaQuery.removeListener(handleThemeChange)
  }, [themePreference])

  useEffect(() => {
    const rootStyle = document.documentElement.style

    if (!showTrayRow) {
      rootStyle.removeProperty('--bottom-tray-height')
      return
    }

    const tray = document.getElementById('bottom-tray')
    if (!tray) {
      rootStyle.removeProperty('--bottom-tray-height')
      return
    }

    const syncBottomTrayHeight = () => {
      const nextHeight = Math.max(Math.round(tray.getBoundingClientRect().height), MIN_BOTTOM_TRAY_HEIGHT_PX)
      rootStyle.setProperty('--bottom-tray-height', `${nextHeight}px`)
    }

    syncBottomTrayHeight()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncBottomTrayHeight)
      return () => {
        window.removeEventListener('resize', syncBottomTrayHeight)
        rootStyle.removeProperty('--bottom-tray-height')
      }
    }

    const observer = new ResizeObserver(() => {
      syncBottomTrayHeight()
    })
    observer.observe(tray)
    window.addEventListener('resize', syncBottomTrayHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncBottomTrayHeight)
      rootStyle.removeProperty('--bottom-tray-height')
    }
  }, [showTrayRow, mode, isMobileHome])

  // Phones have no plain-timeline mode: the notes sit behind the composer, whose
  // Chat | Search switch lives in the menu.
  useEffect(() => {
    if (isMobileHome && mode === 'timeline') setMode('chat')
  }, [isMobileHome, mode, setMode])

  useKeyboardOffsetCssVar()
  useAutoSync(syncStatus)

  useEffect(() => {
    if (!showShortcuts) return
    const handleClick = (event: MouseEvent) => {
      if (shortcutsRef.current?.contains(event.target as Node)) return
      setShowShortcuts(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showShortcuts])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const key = event.key.toLowerCase()
      const hasPrimaryModifier = isPrimaryModifierPressed(event)

      if (hasPrimaryModifier && !event.altKey && !event.shiftKey && key === 's') {
        event.preventDefault()
        void pushToSyncAndRefresh()
        return
      }

      if (hasPrimaryModifier && !event.altKey && !event.shiftKey && (key === 'k' || key === 'f')) {
        if (!isHome) return
        event.preventDefault()

        const nextMode = key === 'k' ? 'chat' : 'search'
        const inputId = nextMode === 'chat' ? 'chat-input' : 'search-input'
        if (mode === nextMode) {
          // On desktop the shortcut toggles: pressed again from the card's own
          // field, it closes the card, so repeated presses open and close it.
          if (isDesktopHome && document.activeElement?.id === inputId) {
            setMode('timeline')
            document.getElementById(inputId)?.blur()
            return
          }
          document.getElementById(inputId)?.focus()
          return
        }

        focusModeInputAfterSwitchRef.current = true
        setMode(nextMode)
        return
      }

      if (hasPrimaryModifier && event.shiftKey && !event.altKey && key === 's') {
        if (!isDesktopHome) return
        event.preventDefault()
        if (mode === 'chat') {
          const moveFocus = isFocusOwnedByCard('chat')
          setMode('timeline')
          if (moveFocus) focusLauncher('chat')
          return
        }
        setMode('chat')
        return
      }
    }

    window.addEventListener('keydown', handleKeydown, true)
    return () => window.removeEventListener('keydown', handleKeydown, true)
  }, [isDesktopHome, isHome, mode, setMode])

  useEffect(() => {
    if (!isDesktopHome) return
    const isSearchOpen = mode === 'search'
    const isChatOpen = mode === 'chat'
    if (!isSearchOpen && !isChatOpen) return

    const openCard = isSearchOpen ? 'search' : 'chat'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return
      // Escape while typing in a note belongs to the note, not to the card.
      if (!isFocusOwnedByCard(openCard)) return
      event.preventDefault()
      setMode('timeline')
      focusLauncher(openCard)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isDesktopHome, mode, setMode])

  useEffect(() => {
    if (!isHome) return
    if (mode === 'timeline') return
    const shouldFocusInput = !isNarrowViewportMode || focusModeInputAfterSwitchRef.current
    focusModeInputAfterSwitchRef.current = false
    if (!shouldFocusInput) return

    const inputId = mode === 'chat' ? 'chat-input' : 'search-input'
    requestAnimationFrame(() => {
      document.getElementById(inputId)?.focus()
    })
  }, [isHome, isNarrowViewportMode, mode])

  const logoLink = (
    <NavLink
      to="/"
      className={`app-logo-link relative z-10 justify-self-center ${
        isLogoCurrentFast ? 'logo-current-fast' : ''
      }`}
      aria-label="Home"
      onClick={handleLogoClick}
    >
      <img src="/logo.svg" alt="Rivolo" className="app-logo h-10 w-auto" />
      <svg
        className="logo-current"
        viewBox="0 0 120 12"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <g className="logo-current-back">
          <g className="logo-current-boost">
            <path d="M0 6 Q6 3,12 6 T24 6 T36 6 T48 6 T60 6 T72 6 T84 6 T96 6 T108 6 T120 6 T132 6 T144 6" />
          </g>
        </g>
        <g className="logo-current-front">
          <g className="logo-current-boost">
            <path d="M0 6 Q6 2.5,12 6 T24 6 T36 6 T48 6 T60 6 T72 6 T84 6 T96 6 T108 6 T120 6 T132 6 T144 6" />
          </g>
        </g>
      </svg>
    </NavLink>
  )

  return (
    <div
      className="app-shell-root min-h-full text-[var(--theme-text)]"
      data-desktop-chat-sidebar-open={isDesktopChatMode ? 'true' : 'false'}
      data-desktop-panel-expanded={desktopPanelExpanded ? 'true' : 'false'}
      data-desktop-search-sidebar-open={isDesktopSearchCardOpen ? 'true' : 'false'}
      data-mobile-home={isMobileHome ? 'true' : 'false'}
      data-mode={mode}
    >
      {/* Fixed header blur: full width, fading out downwards (see .app-shell-header-blur) */}
      <div
        className={`app-shell-header-blur pointer-events-none hidden inset-x-0 top-0 z-20 transition-all sm:fixed sm:block ${
          isScrolled ? 'bg-[var(--theme-blur-surface)] backdrop-blur-md' : ''
        }`}
      />
      {!isMobileHome && (
        <header
          className="app-shell-fixed-header-width app-shell-fixed-right-aware relative left-0 z-30 mx-auto mt-4 grid h-16 grid-cols-[1fr_auto_1fr] items-center px-2 sm:fixed sm:mt-0 sm:px-0"
        >
          <div className="relative z-10 flex items-center gap-2">
            {showBackButton && (
              <NavLink to={backTarget} className={backButtonClass} aria-label="Back">
                <span
                  aria-hidden="true"
                  className="h-5 w-5 bg-current [mask-image:url('/caret-left.svg')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain] [-webkit-mask-image:url('/caret-left.svg')] [-webkit-mask-position:center] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain]"
                />
              </NavLink>
            )}
            {showDesktopShortcutsButton && (
              <ShortcutsPopover
                shortcutsRef={shortcutsRef}
                showShortcuts={isHome && showShortcuts}
                onToggle={() => setShowShortcuts((prev) => !prev)}
                buttonClassName={topIconButton}
              />
            )}
            {!isNarrowViewportMode && <div id="header-undo-slot" className="flex items-center" />}
          </div>
          {logoLink}
          <div className="relative z-10 flex items-center justify-end gap-1 sm:gap-2">
            {tabSync.databaseStale ? (
              <button
                className="flex h-11 items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 shadow-sm transition hover:border-amber-300 hover:bg-amber-100 sm:h-9"
                type="button"
                aria-label="Reload stale tab"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            ) : null}
            {showAttention && (
              <AttentionPopover
                items={attentionItems}
                onDismissSetupNotice={(noticeId) => {
                  void dismissSetupNotice(noticeId).catch((error) => {
                    console.error('[Setup reminder dismissal failed]', error)
                  })
                }}
                onNavigate={() => {
                  sessionStorage.setItem('timeline-scroll', String(window.scrollY))
                }}
              />
            )}
            {syncing && (
              <div
                className={`${showAttention ? 'hidden sm:flex' : 'flex'} h-7 w-7 items-center justify-center rounded-full border border-[var(--theme-border-soft)] bg-[rgb(var(--theme-surface-rgb)/0.86)] text-[var(--theme-text-muted)] shadow-sm`}
                role="status"
                aria-live="polite"
                aria-label={syncDirection === 'down' ? 'Pulling from sync provider' : 'Pushing to sync provider'}
              >
                <img
                  src="/arrow-up.svg"
                  alt=""
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 ${syncDirection === 'down' ? 'rotate-180' : ''}`}
                />
              </div>
            )}
            {showDesktopThemeButton && renderThemeButton()}
            {showSettingsButton && (
              <NavLink
                to="/settings"
                className={`${topIconButton} hero-ui-fade-up`}
                aria-label="Settings"
                onClick={() => {
                  sessionStorage.setItem('timeline-scroll', String(window.scrollY))
                }}
              >
                <img src="/gear.svg" alt="" className="h-5 w-5" />
              </NavLink>
            )}
          </div>
        </header>
      )}

      {/* Mobile home keeps the wordmark at the top but no controls: they live in
          the menu beside the composer. Chat renders its own brand bar inside the overlay. */}
      {showShellLogoHeader && (
        <header className="app-shell-fixed-header-width relative left-0 z-30 mx-auto mt-4 grid h-16 grid-cols-[1fr_auto_1fr] items-center px-2">
          <span />
          {logoLink}
          <span />
        </header>
      )}

      <main
        inert={tabSync.databaseStale || mobileMenuOpen}
        className={`app-main mx-auto flex min-h-screen w-full flex-col gap-4 pt-0 sm:w-[min(96%,720px)] sm:pt-20 ${
          showTrayRow ? 'pb-40' : 'pb-12'
        }`}
        style={isMobileHome ? { paddingBottom: 'var(--mobile-home-bottom-clearance)' } : undefined}
      >
        <Outlet />
      </main>

      {showTrayRow && (
        <BottomTrayRow
          mode={mode}
          chatButton={chatButton}
          searchButton={searchButton}
          modeToggleButton={modeToggleButton}
          trayCenter={trayCenter}
          mobileMenu={isMobileHome ? (
            <MobileMenu
              databaseStale={tabSync.databaseStale}
              syncing={syncing}
              onMenuOpenChange={setMobileMenuOpen}
              attentionItems={attentionItems}
              onDismissSetupNotice={(noticeId) => {
                void dismissSetupNotice(noticeId).catch((error) => {
                  console.error('[Setup reminder dismissal failed]', error)
                })
              }}
              onNavigate={() => {
                sessionStorage.setItem('timeline-scroll', String(window.scrollY))
              }}
            />
          ) : null}
          showScrollToToday={showScrollToToday && !isMobileChatOverlayUp}
          showLauncherButtons={showLauncherButtons}
          launcherSpread={launcherSpread}
          onScrollToToday={() => {
            window.dispatchEvent(new CustomEvent(TIMELINE_SCROLL_TODAY_EVENT))
          }}
        />
      )}
    </div>
  )
}
