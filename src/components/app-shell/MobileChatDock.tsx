import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { AttentionItem } from '../../lib/attention'
import type { SetupNoticeId } from '../../lib/setupAttention'
import { TIMELINE_NEW_CHAT_EVENT } from '../../lib/timelineEvents'
import { useUIStore } from '../../store/useUIStore'

type MobileChatDockProps = {
  databaseStale: boolean
  attentionItems: AttentionItem[]
  onDismissSetupNotice: (noticeId: SetupNoticeId) => void
  onNavigate: () => void
}

const dockButtonClass =
  'relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full py-1 text-xs font-medium outline-none hover:bg-[var(--theme-hover)] focus-visible:ring-2 focus-visible:ring-[var(--theme-border-strong)]'
const menuRowClass =
  'flex min-h-11 w-full items-center rounded-xl px-3 py-3 text-left text-sm font-semibold outline-none hover:bg-[var(--theme-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-border-strong)]'

export default function MobileChatDock({
  databaseStale,
  attentionItems,
  onDismissSetupNotice,
  onNavigate,
}: MobileChatDockProps) {
  const setMode = useUIStore((state) => state.setMode)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)

  const closeMenu = () => {
    setIsMenuOpen(false)
    menuButtonRef.current?.focus({ preventScroll: true })
  }
  const navigate = () => {
    setIsMenuOpen(false)
    onNavigate()
  }

  useEffect(() => {
    if (!isMenuOpen) return

    const getRows = () => sheetRef.current?.querySelectorAll<HTMLElement>('button, a[href]')
    getRows()?.[0]?.focus({ preventScroll: true })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setIsMenuOpen(false)
        menuButtonRef.current?.focus({ preventScroll: true })
      }
      if (event.key !== 'Tab') return
      const rows = getRows()
      if (!rows?.length) return
      const first = rows[0]
      const last = rows[rows.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isMenuOpen])

  return (
    <>
      <nav
        aria-label="Chat navigation"
        className="flex h-16 gap-1 rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] p-1 text-[var(--theme-text-soft)] shadow-sm"
      >
        <button type="button" className={dockButtonClass} onClick={() => setMode('timeline')}>
          <img src="/arrow-line-up.svg" alt="" className="h-5 w-5" />
          Today
        </button>
        <button type="button" className={`${dockButtonClass} bg-[var(--theme-active)]`} aria-current="page">
          <img src="/chats-teardrop.svg" alt="" className="h-5 w-5" />
          Chat
        </button>
        <button type="button" className={dockButtonClass} onClick={() => setMode('search')}>
          <img src="/magnifying-glass.svg" alt="" className="h-5 w-5" />
          Search
        </button>
        <button
          ref={menuButtonRef}
          type="button"
          className={dockButtonClass}
          aria-expanded={isMenuOpen}
          aria-haspopup="dialog"
          aria-controls={isMenuOpen ? 'mobile-chat-menu' : undefined}
          onClick={() => setIsMenuOpen(true)}
        >
          <img src="/dots-three.svg" alt="" className="h-5 w-5" />
          Menu
          {attentionItems.length > 0 && (
            <span className="absolute right-1 top-0 min-w-5 rounded-full bg-amber-100 px-1 text-[11px] font-bold text-amber-900">
              {attentionItems.length}
            </span>
          )}
          {databaseStale && (
            <span className="absolute left-1 top-0 h-2.5 w-2.5 rounded-full bg-amber-500">
              <span className="sr-only">Reload needed</span>
            </span>
          )}
        </button>
      </nav>

      {isMenuOpen && createPortal(
        <div className="fixed inset-0 z-50" style={{ bottom: 'var(--keyboard-offset, 0px)' }}>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close menu"
            className="absolute inset-0 h-full w-full bg-black/40"
            onClick={closeMenu}
          />
          <div
            ref={sheetRef}
            id="mobile-chat-menu"
            data-mobile-chat-menu
            role="dialog"
            aria-modal="true"
            aria-label="Chat menu"
            className="absolute inset-x-0 bottom-0 max-h-full overflow-y-auto overscroll-y-contain rounded-t-3xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3 text-[var(--theme-text-soft)] shadow-lg"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
          >
            {databaseStale && (
              <button
                type="button"
                className={`${menuRowClass} border border-amber-200 bg-amber-50 text-amber-800`}
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            )}
            <button
              type="button"
              className={menuRowClass}
              onClick={() => {
                closeMenu()
                window.dispatchEvent(new CustomEvent(TIMELINE_NEW_CHAT_EVENT))
              }}
            >
              New chat
            </button>
            <Link to="/settings" className={menuRowClass} onClick={navigate}>
              Settings
            </Link>
            {attentionItems.map((item) => (
              <div key={item.id} className="mt-1 flex items-start rounded-xl bg-amber-50">
                <Link
                  to={`/settings#${item.settingsSectionId}`}
                  className="min-h-11 min-w-0 flex-1 rounded-xl px-3 py-2 outline-none transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
                  onClick={navigate}
                >
                  <span className="block text-sm font-semibold text-amber-900">{item.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-amber-800">{item.description}</span>
                </Link>
                {item.dismissibleSetupNoticeId && (
                  <button
                    type="button"
                    className="m-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-amber-700 outline-none transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-300"
                    aria-label={`Dismiss ${item.title}`}
                    onClick={() => onDismissSetupNotice(item.dismissibleSetupNoticeId!)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
