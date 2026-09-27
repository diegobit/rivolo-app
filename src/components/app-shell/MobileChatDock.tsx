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

const DOCK_MODES = [
  { mode: 'timeline', label: 'Today', icon: '/arrow-line-up.svg' },
  { mode: 'chat', label: 'Chat', icon: '/chats-teardrop.svg' },
  { mode: 'search', label: 'Search', icon: '/magnifying-glass.svg' },
] as const

const menuRowClass =
  'flex min-h-11 w-full items-center rounded-xl px-3 py-3 text-left text-sm font-semibold outline-none hover:bg-[var(--theme-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-border-strong)]'

export default function MobileChatDock({
  databaseStale,
  attentionItems,
  onDismissSetupNotice,
  onNavigate,
}: MobileChatDockProps) {
  const mode = useUIStore((state) => state.mode)
  const setMode = useUIStore((state) => state.setMode)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)

  const activeIndex = DOCK_MODES.findIndex((item) => item.mode === mode)

  const menuStatusId = 'mobile-chat-menu-status'
  const menuStatus = [
    attentionItems.length > 0
      ? `${attentionItems.length} ${attentionItems.length === 1 ? 'item needs' : 'items need'} attention`
      : '',
    databaseStale ? 'Reload needed' : '',
  ]
    .filter(Boolean)
    .join('. ')

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
      <nav aria-label="Mobile navigation" className="dock-capsule">
        <span
          className="dock-capsule-thumb"
          aria-hidden="true"
          data-visible={activeIndex >= 0 ? 'true' : 'false'}
          style={{ transform: `translateX(${Math.max(activeIndex, 0) * 100}%)` }}
        />
        {DOCK_MODES.map((item) => (
          <button
            key={item.mode}
            type="button"
            className="dock-capsule-button"
            aria-current={mode === item.mode ? 'page' : undefined}
            onClick={() => setMode(item.mode)}
          >
            <img src={item.icon} alt="" />
            <span>{item.label}</span>
          </button>
        ))}
        <button
          ref={menuButtonRef}
          type="button"
          className="dock-capsule-button"
          aria-label="Menu"
          aria-describedby={menuStatus ? menuStatusId : undefined}
          aria-expanded={isMenuOpen}
          aria-haspopup="dialog"
          aria-controls={isMenuOpen ? 'mobile-chat-menu' : undefined}
          onClick={() => setIsMenuOpen(true)}
        >
          <img src="/dots-three.svg" alt="" />
          <span aria-hidden="true">Menu</span>
          {attentionItems.length > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-1 top-0 min-w-5 rounded-full bg-[var(--theme-warning-soft)] px-1 text-[11px] font-bold text-[var(--theme-warning-text)]"
            >
              {attentionItems.length}
            </span>
          )}
          {databaseStale && (
            <span aria-hidden="true" className="absolute left-1 top-0 h-2.5 w-2.5 rounded-full bg-[var(--theme-warning-text)]" />
          )}
        </button>
        <span id={menuStatusId} className="sr-only">
          {menuStatus}
        </span>
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
            <Link
              to="/"
              className="mb-1 flex min-h-11 items-center justify-center border-b border-[var(--theme-border)]"
              aria-label="Home"
              onClick={navigate}
            >
              <img src="/logo.svg" alt="Rivolo" className="h-7 w-auto" />
            </Link>
            {databaseStale && (
              <button
                type="button"
                className={`${menuRowClass} border border-[var(--theme-warning-border)] bg-[var(--theme-warning-soft)] text-[var(--theme-warning-text)]`}
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
              <div key={item.id} className="mt-1 flex items-start rounded-xl bg-[var(--theme-warning-soft)]">
                <Link
                  to={`/settings#${item.settingsSectionId}`}
                  className="min-h-11 min-w-0 flex-1 rounded-xl px-3 py-2 outline-none transition hover:bg-[var(--theme-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-warning-border)]"
                  onClick={navigate}
                >
                  <span className="block text-sm font-semibold text-[var(--theme-warning-text)]">{item.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--theme-warning-text)]">{item.description}</span>
                </Link>
                {item.dismissibleSetupNoticeId && (
                  <button
                    type="button"
                    className="m-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-[var(--theme-warning-text)] outline-none transition hover:bg-[var(--theme-hover)] focus-visible:ring-2 focus-visible:ring-[var(--theme-warning-border)]"
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
