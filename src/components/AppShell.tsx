import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { pullFromDropbox } from '../lib/dropbox'
import { useDropboxStore } from '../store/useDropboxStore'
import { useSettingsStore } from '../store/useSettingsStore'

const topIconButton =
  'flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300'
const trayIconButton =
  'flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300'
const backButtonClass =
  'flex h-8 w-8 items-center justify-center rounded-full bg-[#22B3FF] shadow-sm transition hover:bg-[#22B3FF]/90'

export default function AppShell() {
  const location = useLocation()
  const { loadSettings, passcode, locked } = useSettingsStore()
  const { loadState, hasAuth, filePath } = useDropboxStore()
  const hasAutoPulled = useRef(false)
  const showBackButton = location.pathname === '/search' || location.pathname === '/settings'
  const isTimeline = location.pathname === '/'
  const isChat = location.pathname === '/chat'
  const isSearch = location.pathname === '/search'
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
    void loadState()
  }, [loadSettings, loadState])

  useEffect(() => {
    if (hasAutoPulled.current) return
    if (!navigator.onLine || locked) return
    if (!passcode.trim() || !hasAuth || !filePath) return

    hasAutoPulled.current = true
    void pullFromDropbox(passcode).catch(() => {
      // Auto-pull failures are handled by manual sync.
    })
  }, [filePath, hasAuth, locked, passcode])


  return (
    <div className="min-h-full bg-white text-slate-900">
      <main className="mx-auto flex min-h-screen w-[min(96%,620px)] flex-col gap-4 pt-4 pb-48">
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
            <NavLink to="/settings" className={topIconButton} aria-label="Settings">
              <img src="/gear.svg" alt="" className="h-4 w-4" />
            </NavLink>
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
