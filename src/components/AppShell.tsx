import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import BottomTrayRow from './app-shell/BottomTrayRow'
import AttentionPopover, { type AttentionItem } from './app-shell/AttentionPopover'
import ShortcutsPopover from './app-shell/ShortcutsPopover'
import { TIMELINE_NEW_CHAT_EVENT, TIMELINE_SCROLL_TODAY_EVENT } from '../lib/timelineEvents'
import { isPrimaryModifierPressed } from '../lib/device'
import { useIsNarrowViewport } from '../hooks/useIsNarrowViewport'
import { useTabSyncState } from '../hooks/useTabSyncState'
import { useKeyboardOffsetCssVar } from '../hooks/useKeyboardOffsetCssVar'
import { useAutoPullSync } from './app-shell/useAutoPullSync'
import { isProviderReady } from '../lib/llm/readiness'
import { getSetupNotices } from '../lib/setupAttention'
import { applyThemePreference, getNextThemePreference, themePreferenceLabels } from '../lib/theme'
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
  const activeProvider = useSyncStore((state) => state.activeProvider)
  const mode = useUIStore((state) => state.mode)
  const setMode = useUIStore((state) => state.setMode)
  const chatPanelOpen = useUIStore((state) => state.chatPanelOpen)
  const setChatPanelOpen = useUIStore((state) => state.setChatPanelOpen)
  const desktopChatPanelOpen = useUIStore((state) => state.desktopChatPanelOpen)
  const setDesktopChatPanelOpen = useUIStore((state) => state.setDesktopChatPanelOpen)
  const chatMessageCount = useUIStore((state) => state.chatMessageCount)
  const timelineEmpty = useUIStore((state) => state.timelineEmpty)
  const tabSync = useTabSyncState()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [showScrollToToday, setShowScrollToToday] = useState(false)
  const [attentionLoaded, setAttentionLoaded] = useState(false)
  const [sawWelcome, setSawWelcome] = useState(false)
  const [postWelcomeAttentionReady, setPostWelcomeAttentionReady] = useState(false)
  const isNarrowViewportMode = useIsNarrowViewport()
  const shortcutsRef = useRef<HTMLDivElement | null>(null)
  const focusModeInputAfterSwitchRef = useRef(false)
  const showBackButton = location.pathname === '/settings' || location.pathname === '/privacy'
  const backTarget = location.pathname === '/privacy' ? '/settings' : '/'
  const isHome = location.pathname === '/'
  const isDesktopChatModeWithMessages =
    isHome && mode === 'chat' && !isNarrowViewportMode && chatMessageCount > 0
  const isDesktopChatSidebarOpen = isDesktopChatModeWithMessages && desktopChatPanelOpen
  const showTrayRow = isHome
  const showMobileChatTogglePill =
    isNarrowViewportMode && mode === 'chat' && (chatPanelOpen || chatMessageCount > 0)
  const showDesktopChatEdgeHandle = !isNarrowViewportMode && isDesktopChatModeWithMessages
  const showMobileChatHeaderBlur = isHome && isNarrowViewportMode && mode === 'chat' && chatPanelOpen
  const showMobileNewChatButton =
    isHome && mode === 'chat' && isNarrowViewportMode && chatMessageCount > 0
  const syncDirection = syncOperation === 'push' ? 'up' : 'down'
  const setupNotices = attentionLoaded
    ? getSetupNotices({
        aiNeedsSetup: !isProviderReady(provider, providerSettings, llmSecrets),
        syncNeedsSetup: activeProvider === null,
        dismissed: dismissedSetupNotices,
      })
    : []
  const attentionItems: AttentionItem[] = [
    ...(syncAttention
      ? [
          {
            id: 'sync-attention',
            title: 'Sync needs attention',
            description: syncAttention.message,
            settingsSectionId: 'settings-sync' as const,
          },
        ]
      : []),
    ...setupNotices.map((notice) => ({
      ...notice,
      dismissibleSetupNoticeId: notice.id,
    })),
  ]
  const isTimelineEmpty = timelineEmpty ?? !timelineHasNotes
  const isWelcomeVisible = timelineLoaded && !timelineLoading && isTimelineEmpty
  const isRealTimelineVisible = timelineLoaded && !timelineLoading && !isTimelineEmpty
  const timelineAttentionReady =
    isRealTimelineVisible && (!sawWelcome || postWelcomeAttentionReady)
  const showAttention =
    !tabSync.databaseStale && isHome && timelineAttentionReady && attentionItems.length > 0

  if (isHome && isWelcomeVisible && !sawWelcome) setSawWelcome(true)

  const chatButton = (
    <button
      className={`${trayIconButton} ${mode === 'chat' ? 'bg-[var(--theme-active)]' : ''}`}
      onClick={() => setMode('chat')}
      aria-label="Chat"
    >
      <img src="/sparkle.svg" alt="" className="h-5 w-5" />
    </button>
  )

  const searchButton = (
    <button
      className={`${trayIconButton} ${mode === 'search' ? 'bg-[var(--theme-active)]' : ''}`}
      onClick={() => setMode('search')}
      aria-label="Search"
    >
      <img src="/magnifying-glass.svg" alt="" className="h-5 w-5" />
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

  const trayCenter = (
    <div className="relative flex-1">
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
  const themeButton = (
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
    if (!isHome || !timelineLoaded) return
    if (!isRealTimelineVisible || !sawWelcome || postWelcomeAttentionReady) return

    const timeout = window.setTimeout(() => {
      setPostWelcomeAttentionReady(true)
    }, ATTENTION_AFTER_WELCOME_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [isHome, isRealTimelineVisible, postWelcomeAttentionReady, sawWelcome, timelineLoaded])

  useEffect(() => {
    const handleScroll = () => {
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

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
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
  }, [showTrayRow])

  useKeyboardOffsetCssVar()
  useAutoPullSync(syncStatus)

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

      if (hasPrimaryModifier && !event.altKey && !event.shiftKey && (key === 'k' || key === 'f')) {
        if (!isHome) return
        event.preventDefault()

        const nextMode = key === 'k' ? 'chat' : 'search'
        const inputId = nextMode === 'chat' ? 'chat-input' : 'search-input'
        if (mode === nextMode) {
          document.getElementById(inputId)?.focus()
          return
        }

        focusModeInputAfterSwitchRef.current = true
        setMode(nextMode)
        return
      }

      if (hasPrimaryModifier && event.shiftKey && !event.altKey && key === 's') {
        if (!showDesktopChatEdgeHandle) return
        event.preventDefault()
        setDesktopChatPanelOpen(!desktopChatPanelOpen)
        return
      }
    }

    window.addEventListener('keydown', handleKeydown, true)
    return () => window.removeEventListener('keydown', handleKeydown, true)
  }, [desktopChatPanelOpen, isHome, mode, setDesktopChatPanelOpen, setMode, showDesktopChatEdgeHandle])

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


  return (
    <div
      className="app-shell-root min-h-full text-[var(--theme-text)]"
      data-desktop-chat-sidebar-open={isDesktopChatSidebarOpen ? 'true' : 'false'}
    >
      {/* Fixed header with blur */}
      <div
        className={`app-shell-fixed-right-aware pointer-events-none hidden left-0 z-20 h-16 transition-all sm:fixed sm:block ${
          isScrolled
            ? 'bg-[var(--theme-blur-surface)] shadow-[0_4px_12px_rgb(var(--theme-shadow-color)/0.10)] backdrop-blur-md'
            : ''
        }`}
      />
      <header
        className="app-shell-fixed-header-width app-shell-fixed-right-aware relative left-0 z-30 mx-auto grid h-16 grid-cols-[1fr_auto_1fr] items-center px-2 sm:fixed sm:px-0"
      >
        {showMobileChatHeaderBlur && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-0 bg-[var(--theme-blur-surface)] shadow-[0_4px_12px_rgb(var(--theme-shadow-color)/0.10)] backdrop-blur-md sm:hidden"
            style={{ height: 'calc(env(safe-area-inset-top) + 4rem)' }}
            aria-hidden="true"
          />
        )}
        <div className="relative z-10 flex items-center gap-2">
          {showBackButton && (
            <NavLink to={backTarget} className={backButtonClass} aria-label="Back">
              <span
                aria-hidden="true"
                className="h-5 w-5 bg-current [mask-image:url('/caret-left.svg')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain] [-webkit-mask-image:url('/caret-left.svg')] [-webkit-mask-position:center] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain]"
              />
            </NavLink>
          )}
          {isHome && (
            <ShortcutsPopover
              shortcutsRef={shortcutsRef}
              showShortcuts={isHome && showShortcuts}
              onToggle={() => setShowShortcuts((prev) => !prev)}
              buttonClassName={topIconButton}
            />
          )}
          {showMobileNewChatButton && (
            <button
              type="button"
              className={`${topIconButton} hero-ui-fade-up sm:hidden`}
              aria-label="New chat"
              onClick={() => {
                window.dispatchEvent(new CustomEvent(TIMELINE_NEW_CHAT_EVENT))
              }}
            >
              <img src="/eraser.svg" alt="" className="h-5 w-5" />
            </button>
          )}
        </div>
        <NavLink to="/" className="relative z-10 justify-self-center" aria-label="Home">
          <img src="/logo.png" alt="Rivolo" className="app-logo h-10 w-auto" />
        </NavLink>
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
          {themeButton}
          <NavLink
            to="/settings"
            className={`${topIconButton} hero-ui-fade-up`}
            aria-label="Settings"
            onClick={() => {
              if (isHome) {
                sessionStorage.setItem('timeline-scroll', String(window.scrollY))
              }
            }}
          >
            <img src="/gear.svg" alt="" className="h-5 w-5" />
          </NavLink>
        </div>
      </header>

      <main
        inert={tabSync.databaseStale}
        className={`app-main mx-auto flex min-h-screen w-full flex-col gap-4 pt-0 sm:w-[min(96%,720px)] sm:pt-20 ${
          showTrayRow ? 'pb-40' : 'pb-12'
        }`}
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
          showMobileChatTogglePill={showMobileChatTogglePill}
          chatPanelOpen={chatPanelOpen}
          onToggleChatPanel={() => {
            if (chatPanelOpen) {
              setChatPanelOpen(false)
              document.getElementById('chat-input')?.blur()
              return
            }

            setChatPanelOpen(true)
          }}
          showScrollToToday={showScrollToToday}
          showDesktopChatEdgeHandle={showDesktopChatEdgeHandle}
          desktopChatPanelOpen={desktopChatPanelOpen}
          onToggleDesktopChatPanel={() => setDesktopChatPanelOpen(!desktopChatPanelOpen)}
          onScrollToToday={() => {
            window.dispatchEvent(new CustomEvent(TIMELINE_SCROLL_TODAY_EVENT))
          }}
        />
      )}
    </div>
  )
}
