import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { pullFromSyncAndRefresh } from '../store/syncActions'
import { useSettingsStore } from '../store/useSettingsStore'
import { useSyncStore } from '../store/useSyncStore'
import { useUIStore } from '../store/useUIStore'

const topIconButton =
  'flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300'
const trayIconButton =
  'flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 sm:h-10 sm:w-10'
const backButtonClass =
  'flex h-8 w-8 items-center justify-center rounded-full bg-[#22B3FF] shadow-sm transition hover:bg-[#22B3FF]/90'

export default function AppShell() {
  const location = useLocation()
  const { loadSettings, wallpaper, highlightInputMode } = useSettingsStore()
  const { loadState: loadSyncState, status: syncStatus, syncing, syncOperation } = useSyncStore()
  const { mode, setMode } = useUIStore()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [showScrollToToday, setShowScrollToToday] = useState(false)
  const [viewportOffset, setViewportOffset] = useState(0)
  const shortcutsRef = useRef<HTMLDivElement | null>(null)
  const lastAutoPullAt = useRef(0)
  const autoPullInFlight = useRef(false)
  const showBackButton = location.pathname === '/settings'
  const isHome = location.pathname === '/'
  const showTrayRow = isHome
  const syncLabel = syncOperation === 'push' ? 'Pushing to Dropbox' : 'Pulling from Dropbox'

  const timelineButton = (
    <button
      className={`${trayIconButton} ${mode === 'timeline' ? 'bg-slate-50' : ''}`}
      onClick={() => setMode('timeline')}
      aria-label="Timeline"
    >
      <img src="/pencil-simple-line.svg" alt="" className="h-5 w-5" />
    </button>
  )

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
      className="bottom-tray-shell flex-1 rounded-[2.5rem] border border-slate-200 bg-white p-2 shadow-[0_6px_18px_rgba(15,23,42,0.12)] transition duration-300 sm:p-3"
    />
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
    const viewport = window.visualViewport
    if (!viewport) return

    const updateOffset = () => {
      setViewportOffset(viewport.offsetTop)
    }

    viewport.addEventListener('resize', updateOffset)
    return () => {
      viewport.removeEventListener('resize', updateOffset)
    }
  }, [])

  useEffect(() => {
    document.body.dataset.wallpaper = wallpaper
  }, [wallpaper])

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
          if (mode === 'timeline') {
            document.getElementById('timeline-input')?.focus()
            return
          }
          if (mode === 'chat') {
            document.getElementById('chat-input')?.focus()
            return
          }
          if (mode === 'search') {
            document.getElementById('search-input')?.focus()
            return
          }
        }
        if (location.pathname === '/settings') {
          document.getElementById('settings-passcode')?.focus()
        }
        return
      }

      if (isEditable) return

      if (key === 'c' || key === 'a') {
        event.preventDefault()
        if (isHome) {
          setMode('chat')
        }
        return
      }

      if (key === 's' || key === 'f') {
        event.preventDefault()
        if (isHome) {
          setMode('search')
        }
        return
      }

      if (key === 'q') {
        event.preventDefault()
        if (isHome) {
          setMode('timeline')
        }
        return
      }

    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [isHome, location.pathname, mode, setMode])

  useEffect(() => {
    if (!isHome) return
    const inputId =
      mode === 'chat' ? 'chat-input' : mode === 'search' ? 'search-input' : 'timeline-input'
    requestAnimationFrame(() => {
      document.getElementById(inputId)?.focus()
    })
  }, [isHome, mode])


  return (
    <div className="min-h-full text-slate-900">
      {/* Fixed header with blur */}
      <div
        style={{ top: viewportOffset }}
        className={`pointer-events-none fixed left-0 right-0 z-20 h-16 transition-all ${isScrolled ? 'bg-white/30 shadow-[0_4px_12px_rgba(0,0,0,0.04)] backdrop-blur-md' : ''}`}
      />
      <header
        style={{ top: viewportOffset }}
        className="fixed left-0 right-0 z-30 mx-auto grid h-16 w-[min(96%,720px)] grid-cols-[1fr_auto_1fr] items-center"
      >
        <div className="flex items-center gap-2">
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
                            <kbd className="kbd">Q</kbd>
                          </span>
                          <span className="text-slate-400">-&gt;</span>
                          <span>Quick add</span>
                        </div>
                        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                          <span className="flex items-center gap-1">
                            <kbd className="kbd">A</kbd>
                            <span className="text-slate-400">or</span>
                            <kbd className="kbd">C</kbd>
                          </span>
                          <span className="text-slate-400">-&gt;</span>
                          <span>Chat with AI</span>
                        </div>
                        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                          <span className="flex items-center gap-1">
                            <kbd className="kbd">S</kbd>
                            <span className="text-slate-400">or</span>
                            <kbd className="kbd">F</kbd>
                          </span>
                          <span className="text-slate-400">-&gt;</span>
                          <span>Search/Find</span>
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
                          <span>Scroll to Today</span>
                        </div>
                        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                          <span className="flex items-center gap-1">
                            <kbd className="kbd">N</kbd>
                          </span>
                          <span className="text-slate-400">-&gt;</span>
                          <span>New Future Day</span>
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
                          <span>Focus Input Box</span>
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
        <NavLink to="/" className="justify-self-center" aria-label="Home">
          <img src="/logo.png" alt="Rivolo" className="app-logo h-10 w-auto" />
        </NavLink>
        <div className="flex items-center justify-end gap-2">
          {syncing && (
            <div
              className="flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/80 px-3 py-1 text-xs text-slate-400 shadow-sm"
              role="status"
              aria-live="polite"
            >
              <span className="whitespace-nowrap">{syncLabel}</span>
              <span className="loader text-slate-300" aria-hidden="true" />
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
        className={`mx-auto flex min-h-screen w-[min(96%,720px)] flex-col gap-4 pt-20 ${
          showTrayRow ? 'pb-40' : 'pb-12'
        }`}
      >
        <Outlet />
      </main>

      {showTrayRow && (
        <>
          <div className="hero-ui-fade-down pointer-events-none fixed bottom-0 left-0 right-0 z-20 h-32 bg-white/30 backdrop-blur-md [mask-image:linear-gradient(to_bottom,transparent,black_40%)]" />

          <div className="hero-ui-fade-down fixed bottom-2 left-0 right-0 z-30 mx-auto flex w-[min(96%,620px)] items-center gap-2 px-2 sm:bottom-6 sm:gap-3 sm:px-0">
            {mode !== 'timeline' && <Fragment key="timeline-btn">{timelineButton}</Fragment>}
            {mode === 'timeline' && <Fragment key="tray">{trayCenter}</Fragment>}

            {mode !== 'chat' && <Fragment key="chat-btn">{chatButton}</Fragment>}
            {mode === 'chat' && <Fragment key="tray">{trayCenter}</Fragment>}

            {mode !== 'search' && <Fragment key="search-btn">{searchButton}</Fragment>}
            {mode === 'search' && <Fragment key="tray">{trayCenter}</Fragment>}

            {showScrollToToday && (
              <button
                type="button"
                className="absolute right-2 top-[-3.1rem] flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 sm:right-0 sm:h-10 sm:w-10"
                aria-label="Scroll to Today"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('timeline-scroll-today'))
                }}
              >
                <img src="/arrow-line-up.svg" alt="" className="h-5 w-5" />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
