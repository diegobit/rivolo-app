import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { pullFromSyncAndRefresh } from '../store/syncActions'
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
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 767px)').matches
  })
  const shortcutsRef = useRef<HTMLDivElement | null>(null)
  const lastAutoPullAt = useRef(0)
  const autoPullInFlight = useRef(false)
  const showBackButton = location.pathname === '/settings'
  const isHome = location.pathname === '/'
  const isDesktopChatModeWithMessages = isHome && mode === 'chat' && !isNarrowViewport && chatMessageCount > 0
  const isDesktopChatSidebarOpen = isDesktopChatModeWithMessages && desktopChatPanelOpen
  const showTrayRow = isHome
  const showMobileChatTogglePill =
    isNarrowViewport && mode === 'chat' && (chatPanelOpen || chatMessageCount > 0)
  const showDesktopChatEdgeHandle = !isNarrowViewport && isDesktopChatModeWithMessages
  const showMobileChatHeaderBlur = isHome && isNarrowViewport && mode === 'chat' && chatPanelOpen
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
    <div
      id="bottom-tray"
      data-mode={mode}
      data-highlight-input={highlightInputMode}
      className="bottom-tray-shell hero-ui-fade-down flex-1 rounded-[2.5rem] border border-slate-200 bg-white p-2 shadow-[0_6px_18px_rgba(15,23,42,0.12)] transition duration-300 sm:p-3"
    />
  )

  useEffect(() => {
    void loadSettings()
    void loadSyncState()
  }, [loadSettings, loadSyncState])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)')

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
    const root = document.documentElement

    const updateKeyboardOffset = () => {
      if (!window.visualViewport) {
        root.style.setProperty('--keyboard-offset', '0px')
        document.body.dataset.keyboardOpen = 'false'
        return
      }

      const viewport = window.visualViewport
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      root.style.setProperty('--keyboard-offset', `${Math.round(offset)}px`)
      document.body.dataset.keyboardOpen = offset > 0 ? 'true' : 'false'
    }

    updateKeyboardOffset()

    if (!window.visualViewport) return

    window.visualViewport.addEventListener('resize', updateKeyboardOffset)
    window.visualViewport.addEventListener('scroll', updateKeyboardOffset)
    window.addEventListener('resize', updateKeyboardOffset)
    window.addEventListener('orientationchange', updateKeyboardOffset)

    return () => {
      window.visualViewport?.removeEventListener('resize', updateKeyboardOffset)
      window.visualViewport?.removeEventListener('scroll', updateKeyboardOffset)
      window.removeEventListener('resize', updateKeyboardOffset)
      window.removeEventListener('orientationchange', updateKeyboardOffset)
    }
  }, [])

  const maybeAutoPull = useCallback(
    (reason: 'start' | 'reconnect' | 'visibility') => {
      if (!navigator.onLine) return
      if (!syncStatus.connected || !syncStatus.filePath) return
      if (autoPullInFlight.current) return

      const now = Date.now()
      if (now - lastAutoPullAt.current < 2 * 60 * 1000) return

      autoPullInFlight.current = true
      lastAutoPullAt.current = now
      console.info('[Sync] auto-pull:trigger', { reason })
      void pullFromSyncAndRefresh()
        .catch(() => {
          // Auto-pull failures are handled by manual sync.
        })
        .finally(() => {
          autoPullInFlight.current = false
        })
    },
    [syncStatus.connected, syncStatus.filePath],
  )

  useEffect(() => {
    console.info('[Sync] auto-pull:event', { reason: 'start' })
    maybeAutoPull('start')
  }, [maybeAutoPull])

  useEffect(() => {
    const handleOnline = () => {
      console.info('[Sync] auto-pull:event', { reason: 'reconnect' })
      maybeAutoPull('reconnect')
    }
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      console.info('[Sync] auto-pull:event', { reason: 'visibility' })
      maybeAutoPull('visibility')
    }

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [maybeAutoPull])

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
            window.dispatchEvent(new CustomEvent('timeline-focus-today'))
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
            <div ref={shortcutsRef} className="hero-ui-fade-up relative">
              <button
                className={topIconButton}
                type="button"
                aria-label="Shortcuts"
                onClick={() => setShowShortcuts((prev) => !prev)}
              >
                <img src="/question-mark.svg" alt="" className="h-5 w-5" />
              </button>
              {showShortcuts && (
                <div className="absolute left-0 z-20 mt-2 w-max rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-lg">
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Input Modes:
                      </div>
                      <div className="grid gap-1">
                        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                          <span className="flex items-center gap-1">
                            <kbd className="kbd">A</kbd>
                          </span>
                          <span className="text-slate-400">-&gt;</span>
                          <span>Ask the AI</span>
                        </div>
                        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                          <span className="flex items-center gap-1">
                            <kbd className="kbd">F</kbd>
                          </span>
                          <span className="text-slate-400">-&gt;</span>
                          <span>Find</span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Others:
                      </div>
                      <div className="grid gap-1">
                        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                          <span className="flex items-center gap-1">
                            <kbd className="kbd">T</kbd>
                          </span>
                          <span className="text-slate-400">-&gt;</span>
                          <span>Scroll to Today/Top</span>
                        </div>
                        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                          <span className="flex items-center gap-1">
                            <kbd className="kbd">N</kbd>
                          </span>
                          <span className="text-slate-400">-&gt;</span>
                          <span>New Today/Tomorrow</span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Editing:
                      </div>
                      <div className="grid gap-1">
                        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                          <span className="flex items-center gap-1">
                            <kbd className="kbd">Cmd/Ctrl</kbd>
                            <span className="text-slate-400">+</span>
                            <kbd className="kbd">Enter</kbd>
                          </span>
                          <span className="text-slate-400">-&gt;</span>
                          <span>Toggle todo</span>
                        </div>
                        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                          <span className="flex items-center gap-1">
                            <kbd className="kbd">I</kbd>
                          </span>
                          <span className="text-slate-400">-&gt;</span>
                          <span>Focus Today editor</span>
                        </div>
                        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                          <span className="flex items-center gap-1">
                            <kbd className="kbd">Esc</kbd>
                          </span>
                          <span className="text-slate-400">-&gt;</span>
                          <span>Exit focus or back to Homepage</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
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
        <>
          <div className="app-shell-fixed-right-aware bottom-tray-blur hero-ui-fade-down pointer-events-none fixed left-0 z-20 bg-white/30 backdrop-blur-md [mask-image:linear-gradient(to_bottom,transparent,black_40%)]" />
          <div className="app-shell-fixed-right-aware bottom-tray-blur-tail hero-ui-fade-down pointer-events-none fixed left-0 z-20 bg-white/30 backdrop-blur-md" />

          <div className="app-shell-fixed-right-aware app-shell-fixed-tray-width bottom-tray-row hero-ui-fade-down fixed left-0 z-30 mx-auto flex items-center justify-center gap-2 px-2 sm:gap-3 sm:px-0">
            {mode !== 'chat' && <Fragment key="chat-btn">{chatButton}</Fragment>}
            {mode === 'chat' && <Fragment key="tray">{trayCenter}</Fragment>}

            {mode !== 'search' && <Fragment key="search-btn">{searchButton}</Fragment>}
            {mode === 'search' && <Fragment key="tray">{trayCenter}</Fragment>}

            {showMobileChatTogglePill && (
              <button
                type="button"
                className="absolute right-2 top-[-3.1rem] inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-slate-300 sm:hidden"
                aria-label={chatPanelOpen ? 'Hide chat' : 'Show chat'}
                onClick={() => {
                  if (chatPanelOpen) {
                    setChatPanelOpen(false)
                    document.getElementById('chat-input')?.blur()
                    return
                  }

                  setChatPanelOpen(true)
                }}
              >
                {chatPanelOpen ? (
                  <img
                    src="/caret-left.svg"
                    alt=""
                    className="h-5 w-5 -rotate-90 opacity-70 transition-transform duration-200"
                  />
                ) : (
                  <img src="/chats-teardrop.svg" alt="" className="h-5 w-5 opacity-75 transition-opacity duration-200" />
                )}
              </button>
            )}

            {showScrollToToday && (
              <button
                type="button"
                className={`absolute top-[-3.1rem] flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 sm:right-0 sm:h-10 sm:w-10 ${
                  showMobileChatTogglePill ? 'right-[3.75rem]' : 'right-2'
                }`}
                aria-label="Scroll to Today"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('timeline-scroll-today'))
                }}
              >
                <img src="/arrow-line-up.svg" alt="" className="h-5 w-5" />
              </button>
            )}
          </div>

          {showDesktopChatEdgeHandle && (
            <button
              type="button"
              className="timeline-chat-edge-handle fixed top-1/2 z-30 hidden h-16 w-8 -translate-y-1/2 items-center justify-center rounded-l-full border border-r-0 border-slate-200 bg-white text-slate-600 shadow-[-10px_0_22px_-20px_rgba(15,23,42,0.3)] hover:border-slate-300 sm:inline-flex"
              aria-label={desktopChatPanelOpen ? 'Hide chat' : 'Show chat'}
              onClick={() => setDesktopChatPanelOpen(!desktopChatPanelOpen)}
            >
              <span className="-translate-x-[1px]">
                <img
                  src="/caret-left.svg"
                  alt=""
                  className={`h-5 w-5 opacity-70 transition-transform translate-x-[2px] duration-200 ${desktopChatPanelOpen ? 'rotate-180' : ''}`}
                />
              </span>
            </button>
          )}
        </>
      )}
    </div>
  )
}
