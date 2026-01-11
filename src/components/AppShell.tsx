import { useEffect, useRef } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { pullFromDropbox } from '../lib/dropbox'
import { useDropboxStore } from '../store/useDropboxStore'
import { useSettingsStore } from '../store/useSettingsStore'

const navItems = [
  { to: '/', label: 'Timeline' },
  { to: '/search', label: 'Search' },
  { to: '/chat', label: 'Chat' },
  { to: '/settings', label: 'Settings' },
]

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium transition',
    isActive
      ? 'bg-[#22B3FF] text-white shadow-sm'
      : 'text-slate-600 hover:bg-[#22B3FF]/10 hover:text-[#22B3FF]',
  ].join(' ')

export default function AppShell() {
  const { loadSettings, passcode, locked } = useSettingsStore()
  const { loadState, hasAuth, filePath } = useDropboxStore()
  const hasAutoPulled = useRef(false)

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
    <div className="min-h-full bg-slate-50 text-slate-900">
      <main className="mx-auto flex min-h-screen w-[min(96%,480px)] flex-col gap-4 pt-4 pb-48">
        <Outlet />
      </main>

      <div
        id="bottom-tray"
        className="fixed bottom-24 left-0 right-0 z-30 mx-auto w-[min(96%,480px)] rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur"
      />

      <nav className="fixed bottom-4 left-0 right-0 z-40 mx-auto w-[min(96%,480px)] rounded-2xl border border-slate-200 bg-white/90 p-2 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass} end>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
