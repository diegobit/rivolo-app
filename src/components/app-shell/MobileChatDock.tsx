import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { AttentionItem } from '../../lib/attention'
import type { SetupNoticeId } from '../../lib/setupAttention'
import { TIMELINE_NEW_CHAT_EVENT, TIMELINE_SCROLL_TODAY_EVENT } from '../../lib/timelineEvents'
import { useUIStore } from '../../store/useUIStore'

type MobileChatDockProps = {
  databaseStale: boolean
  syncing: boolean
  onMenuOpenChange?: (open: boolean) => void
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
  'flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2 text-left text-base font-semibold text-[var(--theme-text)] shadow-[0_1px_2px_rgb(var(--theme-shadow-color)/0.08)] outline-none transition-colors hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-hover)] active:bg-[var(--theme-active)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent-muted-text)]'
const menuIconClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border'

export default function MobileChatDock({
  databaseStale,
  syncing,
  onMenuOpenChange,
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
    syncing ? 'Syncing' : '',
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
    onMenuOpenChange?.(isMenuOpen)
  }, [isMenuOpen, onMenuOpenChange])

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
            onClick={() => {
              setMode(item.mode)
              if (item.mode === 'timeline') {
                // "Today" must also bring today's note back on screen.
                requestAnimationFrame(() => {
                  window.dispatchEvent(new CustomEvent(TIMELINE_SCROLL_TODAY_EVENT))
                })
              }
            }}
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
          {syncing ? (
            <span
              aria-hidden="true"
              className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--theme-accent-border)] border-t-[var(--theme-accent)] motion-reduce:animate-none"
            />
          ) : (
            <img src="/menu-lines.svg" alt="" />
          )}
          <span aria-hidden="true">Menu</span>
          {attentionItems.length > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0 min-w-5 rounded-full border border-[var(--theme-warning-border)] bg-[var(--theme-warning-soft)] px-1 text-[11px] font-bold text-[var(--theme-warning-text)] shadow-[0_1px_2px_rgb(var(--theme-shadow-color)/0.18)]"
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
            aria-hidden="true"
            className="absolute inset-0 h-full w-full" style={{ background: 'var(--theme-scrim)' }}
            onClick={closeMenu}
          />
          <div
            ref={sheetRef}
            id="mobile-chat-menu"
            data-mobile-chat-menu
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-x-0 bottom-0 max-h-full overflow-y-auto overscroll-y-contain rounded-t-3xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3 text-[var(--theme-text-soft)] shadow-lg"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
          >
            <div className="mb-2 flex justify-center">
              <button
                type="button"
                aria-label="Close menu"
                onClick={closeMenu}
                className="flex h-11 w-16 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface-soft)] text-[var(--theme-text-soft)] shadow-[0_1px_2px_rgb(var(--theme-shadow-color)/0.08)] outline-none transition-colors hover:bg-[var(--theme-hover)] active:bg-[var(--theme-active)] focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-muted-text)]"
              >
                <img src="/caret-left.svg" alt="" className="h-5 w-5 -rotate-90" />
              </button>
            </div>
            <div className="space-y-2">
              {databaseStale && (
                <button
                  type="button"
                  className={`${menuRowClass} border-[var(--theme-warning-border)] bg-[var(--theme-warning-soft)] text-[var(--theme-warning-text)]`}
                  onClick={() => window.location.reload()}
                >
                  <span
                    aria-hidden="true"
                    className={`${menuIconClass} border-[var(--theme-warning-border)] bg-[var(--theme-warning-soft)]`}
                  >
                    <img src="/arrow-up.svg" alt="" className="h-5 w-5" />
                  </span>
                  <span>Reload</span>
                </button>
              )}
              <button
                type="button"
                className={menuRowClass}
                onClick={() => {
                  closeMenu()
                  // Clear the thread and land in Chat, not wherever we were.
                  setMode('chat')
                  window.dispatchEvent(new CustomEvent(TIMELINE_NEW_CHAT_EVENT))
                }}
              >
                <span
                  aria-hidden="true"
                  className={`${menuIconClass} border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)]`}
                >
                  <img src="/pencil-simple-line.svg" alt="" className="h-5 w-5" />
                </span>
                <span>New chat</span>
              </button>
              <Link to="/settings" className={menuRowClass} onClick={navigate}>
                <span
                  aria-hidden="true"
                  className={`${menuIconClass} border-[var(--theme-border)] bg-[var(--theme-surface-soft)]`}
                >
                  <img src="/gear.svg" alt="" className="h-5 w-5" />
                </span>
                <span>Settings</span>
              </Link>
            </div>
            {attentionItems.length > 0 && (
              <div className="mt-3 border-t border-[var(--theme-border)] pt-3">
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
                        onClick={(event) => {
                          const rows = Array.from(
                            sheetRef.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? [],
                          )
                          const index = rows.indexOf(event.currentTarget)
                          onDismissSetupNotice(item.dismissibleSetupNoticeId!)
                          requestAnimationFrame(() => {
                            const next = Array.from(
                              sheetRef.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? [],
                            )
                            const target = next[Math.min(index, next.length - 1)] ?? menuButtonRef.current
                            target?.focus({ preventScroll: true })
                          })
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
