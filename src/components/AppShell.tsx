import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { addDays, getTodayId } from '../lib/dates'
import { pullFromSync } from '../lib/sync'
import { useDaysStore } from '../store/useDaysStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useSyncStore } from '../store/useSyncStore'
import { useUIStore } from '../store/useUIStore'

const topIconButton =
  'flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300'
const trayIconButton =
  'flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300'
const backButtonClass =
  'flex h-8 w-8 items-center justify-center rounded-full bg-[#22B3FF] shadow-sm transition hover:bg-[#22B3FF]/90'

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { loadSettings } = useSettingsStore()
  const { loadState: loadSyncState, status: syncStatus } = useSyncStore()
  const { days } = useDaysStore()
  const { mode, setMode } = useUIStore()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const shortcutsRef = useRef<HTMLDivElement | null>(null)
  const hasAutoPulled = useRef(false)
  const todayId = getTodayId()
  const showBackButton = location.pathname === '/settings'
  const isHome = location.pathname === '/'
  const isDayEditor = location.pathname.startsWith('/day/')
  const showTrayRow = isHome

  const futureDayId = useMemo(() => {
    const existing = new Set(days.map((day) => day.dayId))
    let candidate = addDays(days[0]?.dayId ?? todayId, 1)
    while (existing.has(candidate)) {
      candidate = addDays(candidate, 1)
    }
    return candidate
  }, [days, todayId])

  const timelineButton = (
    <button
      className={`${trayIconButton} ${mode === 'timeline' ? 'bg-slate-50' : ''}`}
      onClick={() => setMode('timeline')}
      aria-label="Timeline"
    >
      <img src="/notes.svg" alt="" className="h-5 w-5" />
    </button>
  )

  const chatButton = (
    <button
      className={`${trayIconButton} ${mode === 'chat' ? 'bg-slate-50' : ''}`}
      onClick={() => setMode('chat')}
      aria-label="Chat"
    >
      <img src="/sparkles.svg" alt="" className="h-5 w-5" />
    </button>
  )

  const searchButton = (
    <button
      className={`${trayIconButton} ${mode === 'search' ? 'bg-slate-50' : ''}`}
      onClick={() => setMode('search')}
      aria-label="Search"
    >
      <img src="/lens.svg" alt="" className="h-5 w-5" />
    </button>
  )

  const trayCenter = (
    <div
      id="bottom-tray"
      className="flex-1 rounded-[2.5rem] border border-slate-200 bg-white p-3 shadow-[0_6px_18px_rgba(15,23,42,0.12)]"
    />
  )

  useEffect(() => {
    void loadSettings()
    void loadSyncState()
  }, [loadSettings, loadSyncState])

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 0)
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (hasAutoPulled.current) return
    if (!navigator.onLine) return
    if (!syncStatus.connected || !syncStatus.filePath) return

    hasAutoPulled.current = true
    void pullFromSync().catch(() => {
      // Auto-pull failures are handled by manual sync.
    })
  }, [syncStatus.connected, syncStatus.filePath])

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
    if (!isHome) return
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
        if (location.pathname.startsWith('/day/')) {
          const editor = document.querySelector<HTMLElement>('.cm-content')
          editor?.focus()
          return
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

      if (key === 't') {
        event.preventDefault()
        if (isHome) {
          setMode('timeline')
        }
        return
      }

      if (key === 'n') {
        event.preventDefault()
        navigate(`/day/${futureDayId}`)
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [futureDayId, isHome, location.pathname, mode, navigate, setMode])


  return (
    <div className="min-h-full bg-white text-slate-900">
      {/* Fixed header with blur */}
      <div className={`pointer-events-none fixed top-0 left-0 right-0 z-20 h-16 bg-white/30 backdrop-blur-md transition-shadow ${isScrolled ? 'shadow-[0_4px_12px_rgba(0,0,0,0.04)]' : ''}`} />
      <header
        className={`fixed top-0 left-0 right-0 z-30 mx-auto grid h-16 grid-cols-[1fr_auto_1fr] items-center ${
          isDayEditor ? 'w-[min(96%,880px)]' : 'w-[min(96%,720px)]'
        }`}
      >
        <div className="flex items-center gap-2">
          {showBackButton && (
            <NavLink to="/" className={backButtonClass} aria-label="Back">
              <img
                src="/arrow-back.svg"
                alt=""
                className="h-5 w-5"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </NavLink>
          )}
          {isHome && (
            <div ref={shortcutsRef} className="relative">
              <button
                className={topIconButton}
                type="button"
                aria-label="Shortcuts"
                onClick={() => setShowShortcuts((prev) => !prev)}
              >
                <img src="/question.svg" alt="" className="h-4 w-4" />
              </button>
              {showShortcuts && (
                <div className="absolute left-0 z-20 mt-2 w-max rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-600 shadow-lg">
                  <div className="space-y-1">
                    <div>A, C → Chat View</div>
                    <div>T → Timeline View</div>
                    <div>S, F → Search</div>
                    <div>N → New future day</div>
                    <div>I → Focus input box</div>
                    <div>Esc → Exit focus or back to Timeline</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <NavLink to="/" className="justify-self-center" aria-label="Home">
          <img src="/logo.png" alt="Rivolo" className="h-10 w-auto" />
        </NavLink>
        <div className="flex items-center justify-end gap-2">
          {!isDayEditor && (
            <NavLink
              to="/settings"
              className={topIconButton}
              aria-label="Settings"
              onClick={() => {
                if (isHome) {
                  sessionStorage.setItem('timeline-scroll', String(window.scrollY))
                }
              }}
            >
              <img src="/gear.svg" alt="" className="h-4 w-4" />
            </NavLink>
          )}
        </div>
      </header>

      <main
        className={`mx-auto flex min-h-screen flex-col gap-4 pt-20 ${
          showTrayRow ? 'pb-40' : 'pb-12'
        } ${isDayEditor ? 'w-[min(96%,880px)]' : 'w-[min(96%,720px)]'}`}
      >
        <Outlet />
      </main>

      {showTrayRow && (
        <>
          <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-20 h-32 bg-white/30 backdrop-blur-md [mask-image:linear-gradient(to_bottom,transparent,black_40%)]" />

          <div className="fixed bottom-6 left-0 right-0 z-30 mx-auto flex w-[min(96%,620px)] items-center gap-3">
            {mode !== 'timeline' && <Fragment key="timeline-btn">{timelineButton}</Fragment>}
            {mode === 'timeline' && <Fragment key="tray">{trayCenter}</Fragment>}

            {mode !== 'chat' && <Fragment key="chat-btn">{chatButton}</Fragment>}
            {mode === 'chat' && <Fragment key="tray">{trayCenter}</Fragment>}

            {mode !== 'search' && <Fragment key="search-btn">{searchButton}</Fragment>}
            {mode === 'search' && <Fragment key="tray">{trayCenter}</Fragment>}
          </div>
        </>
      )}
    </div>
  )
}
