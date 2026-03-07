import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import BottomTrayRow from './app-shell/BottomTrayRow'
import ShortcutsPopover from './app-shell/ShortcutsPopover'
import {
  TIMELINE_FOCUS_TODAY_EVENT,
  TIMELINE_NEW_CHAT_EVENT,
  TIMELINE_SCROLL_TODAY_EVENT,
} from '../lib/timelineEvents'
import { useIsNarrowViewport } from '../hooks/useIsNarrowViewport'
import { useKeyboardOffsetCssVar } from '../hooks/useKeyboardOffsetCssVar'
import { useAutoPullSync } from './app-shell/useAutoPullSync'
import { useSettingsStore } from '../store/useSettingsStore'
import { useSyncStore } from '../store/useSyncStore'
import { useUIStore } from '../store/useUIStore'

const topIconButton =
  'flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 sm:h-9 sm:w-9'
const trayIconButton =
  'flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 sm:h-10 sm:w-10'
const backButtonClass =
  'flex h-11 w-11 items-center justify-center rounded-full bg-[#22B3FF] shadow-sm transition hover:bg-[#22B3FF]/90 sm:h-9 sm:w-9'

export default function AppShell() {
  const location = useLocation()
  const { loadSettings, wallpaper, highlightInputMode } = useSettingsStore()
  const { loadState: loadSyncState, status: syncStatus, syncing, syncOperation } = useSyncStore()
  const {
    mode,
    setMode,
    chatPanelOpen,
    setChatPanelOpen,
    desktopChatPanelOpen,
    setDesktopChatPanelOpen,
    chatMessageCount,
  } = useUIStore()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [showScrollToToday, setShowScrollToToday] = useState(false)
  const isNarrowViewportMode = useIsNarrowViewport()
  const shortcutsRef = useRef<HTMLDivElement | null>(null)
  const showBackButton = location.pathname === '/settings'
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

  const chatButton = (
    <button
      className={`${trayIconButton} ${mode === 'chat' ? 'bg-slate-50' : ''}`}
      onClick={() => setMode('chat')}
      aria-label="Chat"
    >
      <img src="/sparkle.svg" alt="" className="h-5 w-5" />
    </button>
  )

  const searchButton = (
    <button
      className={`${trayIconButton} ${mode === 'search' ? 'bg-slate-50' : ''}`}
      onClick={() => setMode('search')}
      aria-label="Search"
    >
      <img src="/magnifying-glass.svg" alt="" className="h-5 w-5" />
    </button>
  )

  const trayCenter = (
    <div className="relative flex-1">
      <div
        id="bottom-tray-pills"
        data-mode={mode}
        className="bottom-tray-pills pointer-events-none absolute bottom-full left-0 right-0 mb-2 flex min-h-0 items-end justify-start"
      />
      <div
        id="bottom-tray"
        data-mode={mode}
        data-highlight-input={highlightInputMode}
        className="bottom-tray-shell hero-ui-fade-down flex-1 rounded-[2.5rem] border border-slate-200 bg-white p-2 shadow-[0_6px_18px_rgba(15,23,42,0.12)] transition duration-300 sm:p-3"
      />
    </div>
  )

  useEffect(() => {
    void loadSettings()
    void loadSyncState()
  }, [loadSettings, loadSyncState])

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
    if (isHome) return
    if (showShortcuts) {
      setShowShortcuts(false)
    }
  }, [isHome, showShortcuts])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const activeElement = document.activeElement as HTMLElement | null
      const isEditable = Boolean(
        activeElement &&
          (activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.tagName === 'SELECT' ||
            activeElement.isContentEditable),
      )
      const key = event.key.toLowerCase()

      if (key === 'i') {
        if (isEditable) return
        event.preventDefault()
        if (isHome) {
          const dispatchFocusToday = () => {
            window.dispatchEvent(new CustomEvent(TIMELINE_FOCUS_TODAY_EVENT))
          }
          if (mode !== 'chat') {
            setMode('chat')
            requestAnimationFrame(() => {
              requestAnimationFrame(dispatchFocusToday)
            })
            return
          }
          dispatchFocusToday()
        }
        return
      }

      if (isEditable) return

      if (key === 'a') {
        event.preventDefault()
        if (!isHome) return
        if (mode === 'chat') {
          document.getElementById('chat-input')?.focus()
          return
        }
        setMode('chat')
        return
      }

      if (key === 'f') {
        event.preventDefault()
        if (!isHome) return
        if (mode === 'search') {
          document.getElementById('search-input')?.focus()
          return
        }
        setMode('search')
        return
      }

    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [isHome, mode, setMode])

  useEffect(() => {
    if (!isHome) return
    if (mode === 'timeline') return
    const inputId = mode === 'chat' ? 'chat-input' : 'search-input'
    requestAnimationFrame(() => {
      document.getElementById(inputId)?.focus()
    })
  }, [isHome, mode])


  return (
    <div
      className="app-shell-root min-h-full text-slate-900"
      data-desktop-chat-sidebar-open={isDesktopChatSidebarOpen ? 'true' : 'false'}
    >
      {/* Fixed header with blur */}
      <div
        className={`app-shell-fixed-right-aware pointer-events-none hidden left-0 z-20 h-16 transition-all sm:fixed sm:block ${
          isScrolled
            ? 'bg-white/30 shadow-[0_4px_12px_rgba(0,0,0,0.04)] backdrop-blur-md'
            : ''
        }`}
      />
      <header
        className="app-shell-fixed-header-width app-shell-fixed-right-aware relative left-0 z-30 mx-auto grid h-16 grid-cols-[1fr_auto_1fr] items-center sm:fixed"
      >
        {showMobileChatHeaderBlur && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-0 bg-white/30 shadow-[0_4px_12px_rgba(0,0,0,0.04)] backdrop-blur-md sm:hidden"
            style={{ height: 'calc(env(safe-area-inset-top) + 4rem)' }}
            aria-hidden="true"
          />
        )}
        <div className="relative z-10 flex items-center gap-2">
          {showBackButton && (
            <NavLink to="/" className={backButtonClass} aria-label="Back">
              <img
                src="/caret-left.svg"
                alt=""
                className="h-5 w-5"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </NavLink>
          )}
          {isHome && (
            <ShortcutsPopover
              shortcutsRef={shortcutsRef}
              showShortcuts={showShortcuts}
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
              <img src="/pencil-simple-line.svg" alt="" className="h-5 w-5" />
            </button>
          )}
        </div>
        <NavLink to="/" className="relative z-10 justify-self-center" aria-label="Home">
          <img src="/logo.png" alt="Rivolo" className="app-logo h-10 w-auto" />
        </NavLink>
        <div className="relative z-10 flex items-center justify-end gap-2">
          {syncing && (
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200/70 bg-white/80 text-slate-500 shadow-sm"
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
