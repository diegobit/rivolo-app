import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { pullFromSync } from '../lib/sync'
import { useSettingsStore } from '../store/useSettingsStore'
import { useSyncStore } from '../store/useSyncStore'

const topIconButton =
  'flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300'
const trayIconButton =
  'flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300'
const backButtonClass =
  'flex h-8 w-8 items-center justify-center rounded-full bg-[#22B3FF] shadow-sm transition hover:bg-[#22B3FF]/90'

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { loadSettings, passcode, locked } = useSettingsStore()
  const { loadState: loadSyncState, status: syncStatus } = useSyncStore()
  const hasAutoPulled = useRef(false)
  const showBackButton = location.pathname === '/settings'
  const isTimeline = location.pathname === '/'
  const isChat = location.pathname === '/chat'
  const isSearch = location.pathname === '/search'
  const isDayEditor = location.pathname.startsWith('/day/')
  const showTrayRow = isTimeline || isChat || isSearch

  const timelineButton = (
    <NavLink to="/" className={trayIconButton} aria-label="Timeline">
      <img src="/notes.svg" alt="" className="h-5 w-5" />
    </NavLink>
  )

  const chatButton = (
    <NavLink to="/chat" className={trayIconButton} aria-label="Chat">
      <img src="/sparkles.svg" alt="" className="h-5 w-5" />
    </NavLink>
  )

  const searchButton = (
    <NavLink to="/search" className={trayIconButton} aria-label="Search">
      <img src="/lens.svg" alt="" className="h-5 w-5" />
    </NavLink>
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
    if (hasAutoPulled.current) return
    if (!navigator.onLine || locked) return
    if (!passcode.trim() || !syncStatus.connected || !syncStatus.filePath) return

    hasAutoPulled.current = true
    void pullFromSync(passcode).catch(() => {
      // Auto-pull failures are handled by manual sync.
    })
  }, [locked, passcode, syncStatus.connected, syncStatus.filePath])

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
        if (isTimeline) {
          document.getElementById('timeline-input')?.focus()
          return
        }
        if (isChat) {
          document.getElementById('chat-input')?.focus()
          return
        }
        if (isSearch) {
          document.getElementById('search-input')?.focus()
          return
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

      if (key === 'c') {
        event.preventDefault()
        if (!isChat) {
          navigate('/chat')
        }
        return
      }

      if (key === 's') {
        event.preventDefault()
        if (!isSearch) {
          navigate('/search')
        }
        return
      }

      if (key === 't') {
        event.preventDefault()
        if (!isTimeline) {
          navigate('/')
        }
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [isChat, isSearch, isTimeline, location.pathname, navigate])


  return (
    <div className="min-h-full bg-white text-slate-900">
      <main
        className={`mx-auto flex min-h-screen flex-col gap-4 ${
          showTrayRow ? 'pb-40' : 'pb-12'
        } ${isDayEditor ? 'w-[min(96%,880px)] pt-4' : 'w-[min(96%,720px)] pt-4'}`}
      >
        <header className="grid grid-cols-[1fr_auto_1fr] items-center pt-2">
          <div className="flex items-center">
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
          </div>
          <NavLink to="/" className="justify-self-center" aria-label="Home">
            <img src="/logo.png" alt="Rivolo" className="h-10 w-auto" />
          </NavLink>
          <div className="flex items-center justify-end gap-2">
            {!isDayEditor && (
              <NavLink to="/settings" className={topIconButton} aria-label="Settings">
                <img src="/gear.svg" alt="" className="h-4 w-4" />
              </NavLink>
            )}
          </div>

        </header>
        <Outlet />
      </main>

      {showTrayRow && (
        <>
          <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-20 h-32 bg-gradient-to-t from-white via-white/80 to-transparent" />

          <div className="fixed bottom-6 left-0 right-0 z-30 mx-auto flex w-[min(96%,620px)] items-center gap-3">
            {isTimeline && (
              <>
                {trayCenter}
                {chatButton}
                {searchButton}
              </>
            )}
            {isChat && (
              <>
                {timelineButton}
                {trayCenter}
                {searchButton}
              </>
            )}
            {isSearch && (
              <>
                {timelineButton}
                {chatButton}
                {trayCenter}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
