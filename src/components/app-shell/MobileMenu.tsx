import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { AttentionItem } from '../../lib/attention'
import { formatTimeAgo } from '../../lib/dates'
import type { SetupNoticeId } from '../../lib/setupAttention'
import { SYNC_PROVIDER_LABELS } from '../../lib/syncState'
import { getNextThemePreference } from '../../lib/theme'
import { TIMELINE_NEW_CHAT_EVENT } from '../../lib/timelineEvents'
import { lockPageScroll } from '../../lib/pageScrollLock'
import {
  pullFromSyncAndRefresh,
  pushToSyncAndRefresh,
  recordBlockedPush,
  recordSyncAttention,
} from '../../store/syncActions'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useSyncStore } from '../../store/useSyncStore'
import { useUIStore } from '../../store/useUIStore'

type MobileMenuProps = {
  databaseStale: boolean
  syncing: boolean
  onMenuOpenChange?: (open: boolean) => void
  attentionItems: AttentionItem[]
  onDismissSetupNotice: (noticeId: SetupNoticeId) => void
  onNavigate: () => void
}

const MENU_MODES = [
  { mode: 'chat', label: 'Chat', icon: '/chats-teardrop.svg' },
  { mode: 'search', label: 'Search', icon: '/magnifying-glass.svg' },
] as const

const THEME_TILE = {
  system: { meta: 'Auto', icon: '/sun-horizon.svg' },
  light: { meta: 'Light', icon: '/sun.svg' },
  dark: { meta: 'Dark', icon: '/moon.svg' },
} as const

const menuRowClass =
  'mobile-menu-row flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface-soft)] px-3 py-2 text-left text-base font-semibold text-[var(--theme-text)] shadow-[0_1px_2px_rgb(var(--theme-shadow-color)/0.08)] outline-none transition-colors hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-hover)] active:bg-[var(--theme-active)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent-muted-text)] disabled:cursor-not-allowed disabled:opacity-60'
const menuIconClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border'
// Quick actions are square tiles with the label underneath, as in Arc's page menu.
const menuTileClass =
  'group flex w-full min-w-0 cursor-pointer flex-col items-center gap-1.5 text-center outline-none disabled:cursor-not-allowed disabled:opacity-50'
const menuTileFaceClass =
  'relative flex aspect-square w-full max-w-[4.5rem] items-center justify-center rounded-[1.25rem] border shadow-[0_1px_2px_rgb(var(--theme-shadow-color)/0.08)] transition-colors group-hover:border-[var(--theme-border-strong)] group-hover:bg-[var(--theme-hover)] group-active:bg-[var(--theme-active)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--theme-accent-muted-text)] group-disabled:border-[var(--theme-border)] group-disabled:bg-[var(--theme-surface-soft)]'
const menuTileIdleFaceClass = 'border-[var(--theme-border)] bg-[var(--theme-surface-soft)]'
const menuTileLabelClass = 'text-xs font-semibold leading-tight text-[var(--theme-text)]'
const menuTileMetaClass = 'text-[11px] leading-tight text-[var(--theme-text-muted)]'
const menuCardClass =
  'flex min-h-16 w-full min-w-0 items-center gap-3 rounded-[1.25rem] border border-[var(--theme-border)] bg-[var(--theme-surface-soft)] px-4 py-2 text-left shadow-[0_1px_2px_rgb(var(--theme-shadow-color)/0.08)] outline-none transition-colors hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-hover)] active:bg-[var(--theme-active)] focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-muted-text)]'
const spinnerClass =
  'animate-spin rounded-full border-2 border-[var(--theme-accent-border)] border-t-[var(--theme-accent)] motion-reduce:animate-none'

type SyncOperation = 'pull' | 'push'

const runSync = async (operation: SyncOperation) => {
  try {
    if (operation === 'pull') {
      await pullFromSyncAndRefresh()
      return
    }
    const result = await pushToSyncAndRefresh()
    if (result.status === 'blocked') recordBlockedPush(result.reason)
  } catch (error) {
    // Failures surface as attention items, which this menu lists above the buttons.
    recordSyncAttention(
      operation,
      error instanceof Error ? error.message : `${operation === 'pull' ? 'Pull' : 'Push'} failed.`,
    )
  }
}

export default function MobileMenu({
  databaseStale,
  syncing,
  onMenuOpenChange,
  attentionItems,
  onDismissSetupNotice,
  onNavigate,
}: MobileMenuProps) {
  const mode = useUIStore((state) => state.mode)
  const chatSending = useUIStore((state) => state.chatSending)
  const chatPanelOpen = useUIStore((state) => state.chatPanelOpen)
  const chatMessageCount = useUIStore((state) => state.chatMessageCount)
  const setMode = useUIStore((state) => state.setMode)
  const themePreference = useSettingsStore((state) => state.themePreference)
  const updateThemePreference = useSettingsStore((state) => state.updateThemePreference)
  const activeSyncProvider = useSyncStore((state) => state.activeProvider)
  const syncStatus = useSyncStore((state) => state.status)
  const syncOperation = useSyncStore((state) => state.syncOperation)
  const syncPushBlocked = useSyncStore((state) => state.syncAttention?.blocked ?? false)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [now, setNow] = useState(() => Date.now())
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [menuPresent, setMenuPresent] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const menuClosingRef = useRef(false)

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

  const closeMenu = useCallback(() => {
    if (menuClosingRef.current) return
    menuClosingRef.current = true
    const sheet = sheetRef.current
    if (sheet) {
      // A dismissal during entry should slide down from the current position,
      // rather than jumping to the entry animation's fully open endpoint.
      sheet.style.setProperty('--mobile-menu-exit-transform', window.getComputedStyle(sheet).transform)
    }
    setIsMenuOpen(false)
    menuButtonRef.current?.focus({ preventScroll: true })
  }, [])
  const navigate = () => {
    setIsMenuOpen(false)
    setMenuPresent(false)
    onNavigate()
  }

  useEffect(() => {
    onMenuOpenChange?.(menuPresent)
  }, [menuPresent, onMenuOpenChange])

  useEffect(() => {
    if (isMenuOpen || !menuPresent) return
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
    const timer = window.setTimeout(() => setMenuPresent(false), delay)
    return () => window.clearTimeout(timer)
  }, [isMenuOpen, menuPresent])

  useEffect(() => () => onMenuOpenChange?.(false), [onMenuOpenChange])

  useEffect(() => {
    const handleStatus = () => setOnline(navigator.onLine)
    window.addEventListener('online', handleStatus)
    window.addEventListener('offline', handleStatus)
    return () => {
      window.removeEventListener('online', handleStatus)
      window.removeEventListener('offline', handleStatus)
    }
  }, [])

  // Keep the "5m ago" labels current while the menu stays open.
  useEffect(() => {
    if (!menuPresent) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [menuPresent])

  useEffect(() => {
    const sheet = sheetRef.current
    if (!menuPresent || !sheet) return

    let gesture: { id: number; x: number; y: number; swiping: boolean } | null = null
    let suppressClickUntil = 0
    const start = (event: TouchEvent) => {
      const wasSwiping = gesture?.swiping
      gesture = null
      suppressClickUntil = wasSwiping ? performance.now() + 500 : 0
      // A menu scrolled away from its top needs normal scrolling, not dismissal.
      if (menuClosingRef.current || event.touches.length !== 1 || sheet.scrollTop > 0) return
      const touch = event.touches[0]
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, swiping: false }
    }
    const move = (event: TouchEvent) => {
      if (!gesture) return
      if (event.touches.length !== 1) {
        if (gesture.swiping) suppressClickUntil = performance.now() + 500
        gesture = null
        return
      }
      const touch = event.touches[0]
      const dx = Math.abs(touch.clientX - gesture.x)
      const dy = touch.clientY - gesture.y
      if (touch.identifier !== gesture.id || dy < -10 || (dx > 10 && dx > dy)) {
        if (gesture.swiping) suppressClickUntil = performance.now() + 500
        gesture = null
        return
      }
      if (dy > 10 && dy > dx * 1.3) {
        gesture.swiping = true
        // Prevent Safari's rubber-band scroll once this is a downward gesture.
        event.preventDefault()
      }
    }
    const end = (event: TouchEvent) => {
      const current = gesture
      gesture = null
      if (!current?.swiping) return
      event.preventDefault()
      suppressClickUntil = performance.now() + 500
      const touch = Array.from(event.changedTouches).find((item) => item.identifier === current.id)
      if (!touch) return
      const dy = touch.clientY - current.y
      if (dy >= 64 && dy > Math.abs(touch.clientX - current.x) * 1.3) closeMenu()
    }
    const cancel = () => {
      if (gesture?.swiping) suppressClickUntil = performance.now() + 500
      gesture = null
    }
    const preventSwipeClick = (event: MouseEvent) => {
      if (performance.now() >= suppressClickUntil) return
      event.preventDefault()
      event.stopPropagation()
    }
    sheet.addEventListener('touchstart', start, { passive: true })
    sheet.addEventListener('touchmove', move, { passive: false })
    sheet.addEventListener('touchend', end, { passive: false })
    sheet.addEventListener('touchcancel', cancel)
    sheet.addEventListener('click', preventSwipeClick, true)
    return () => {
      sheet.removeEventListener('touchstart', start)
      sheet.removeEventListener('touchmove', move)
      sheet.removeEventListener('touchend', end)
      sheet.removeEventListener('touchcancel', cancel)
      sheet.removeEventListener('click', preventSwipeClick, true)
    }
  }, [menuPresent, closeMenu])

  useEffect(() => {
    if (!menuPresent) return

    const unlock = lockPageScroll()
    const preventBackgroundTouch = (event: TouchEvent) => {
      if (event.target instanceof Node && sheetRef.current?.contains(event.target)) return
      event.preventDefault()
    }
    document.addEventListener('touchmove', preventBackgroundTouch, { passive: false })

    const getRows = () => sheetRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')
    getRows()?.[0]?.focus({ preventScroll: true })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeMenu()
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('touchmove', preventBackgroundTouch)
      unlock()
    }
  }, [menuPresent, closeMenu])

  const syncReady = activeSyncProvider !== null && syncStatus.connected
  // An empty chat with no thread on screen has nothing to clear.
  const chatEmpty = chatMessageCount === 0 && !chatPanelOpen
  const theme = THEME_TILE[themePreference]
  // Sync problems sit with Pull and Push; everything else stays on top, where a
  // new warning never moves the controls below it.
  const syncAttentionItems = attentionItems.filter((item) => item.settingsSectionId === 'settings-sync')
  const otherAttentionItems = attentionItems.filter((item) => item.settingsSectionId !== 'settings-sync')
  // A refused push with local edits leaves both buttons disabled (Pull waits for
  // Push), so the warning takes their place, as the setup reminder does.
  const syncConflict = syncPushBlocked && syncStatus.localDirty && syncAttentionItems.length > 0

  const getSyncState = (operation: SyncOperation) => {
    const isPull = operation === 'pull'
    const running = syncing && syncOperation === operation
    // Older saved states lack per-operation times; the shared sync time stands
    // in until the next pull or push records its own.
    const lastAt = (isPull ? syncStatus.lastPullAt : syncStatus.lastPushAt) ?? syncStatus.lastSyncAt
    const pullBlockedByEdits = isPull && syncStatus.localDirty
    const unsyncedEdits = !isPull && syncReady && syncStatus.localDirty
    const label = isPull ? 'Pull' : 'Push'
    const meta = !syncReady
      ? 'Disconnected'
      : running
        ? isPull
          ? 'Pulling…'
          : 'Pushing…'
        : !online
          ? 'Offline'
          : pullBlockedByEdits
            ? 'Push first'
            : lastAt
              ? formatTimeAgo(lastAt, now)
              : 'Never'
    return {
      label,
      meta,
      running,
      unsyncedEdits,
      icon: isPull ? '/cloud-arrow-down.svg' : '/cloud-arrow-up.svg',
      ariaLabel: `${label}, ${meta}${unsyncedEdits ? ', unsynced edits' : ''}`,
      disabled: !syncReady || syncing || !online || databaseStale || pullBlockedByEdits,
    }
  }

  const renderSyncButton = (operation: SyncOperation) => {
    const state = getSyncState(operation)
    return (
      <button
        type="button"
        className={`${menuCardClass} relative cursor-pointer disabled:cursor-not-allowed disabled:opacity-50`}
        aria-label={state.ariaLabel}
        disabled={state.disabled}
        onClick={() => void runSync(operation)}
      >
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center">
          {state.running ? (
            <span className={`h-6 w-6 ${spinnerClass}`} />
          ) : (
            <img src={state.icon} alt="" className="h-6 w-6" />
          )}
        </span>
        <span aria-hidden="true" className="flex min-w-0 flex-col gap-0.5">
          <span className={menuTileLabelClass}>{state.label}</span>
          <span className={menuTileMetaClass}>{state.meta}</span>
        </span>
        {state.unsyncedEdits && (
          <span aria-hidden="true" className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[var(--theme-accent)]" />
        )}
      </button>
    )
  }

  const renderAttentionItem = (item: AttentionItem) => (
    <div
      key={item.id}
      className="flex overflow-hidden rounded-xl border border-[var(--theme-warning-border)] bg-[var(--theme-warning-soft)]"
    >
      <Link
        to={`/settings#${item.settingsSectionId}`}
        className="min-h-11 min-w-0 flex-1 px-3 py-2 outline-none transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-warning-border)]"
        onClick={navigate}
      >
        <span className="block text-sm font-semibold text-[var(--theme-warning-text)]">{item.title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-[var(--theme-warning-text)]">{item.description}</span>
      </Link>
      {item.dismissibleSetupNoticeId && (
        <button
          type="button"
          className="flex min-h-11 w-12 shrink-0 self-stretch items-center justify-center text-lg text-[var(--theme-warning-text)] outline-none transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-warning-border)]"
          aria-label={`Dismiss ${item.title}`}
          onClick={(event) => {
            const rows = Array.from(
              sheetRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? [],
            )
            const index = rows.indexOf(event.currentTarget)
            onDismissSetupNotice(item.dismissibleSetupNoticeId!)
            requestAnimationFrame(() => {
              const next = Array.from(
                sheetRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? [],
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
  )

  const modeIndex = mode === 'search' ? 1 : 0

  return (
    <>
      <button
        ref={menuButtonRef}
        type="button"
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] shadow-sm transition hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-hover)]"
        aria-label="Menu"
        aria-describedby={menuStatus ? menuStatusId : undefined}
        aria-expanded={isMenuOpen}
        aria-haspopup="dialog"
        aria-controls={isMenuOpen ? 'mobile-chat-menu' : undefined}
        onClick={() => {
          menuClosingRef.current = false
          setNow(Date.now())
          setMenuPresent(true)
          setIsMenuOpen(true)
        }}
      >
        {syncing ? (
          <span aria-hidden="true" className={`h-5 w-5 ${spinnerClass}`} />
        ) : (
          <img src="/menu-lines.svg" alt="" className="h-5 w-5" />
        )}
        {attentionItems.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 min-w-5 rounded-full border border-[var(--theme-warning-border)] bg-[var(--theme-warning-soft)] px-1 text-[11px] font-bold text-[var(--theme-warning-text)] shadow-[0_1px_2px_rgb(var(--theme-shadow-color)/0.18)]"
          >
            {attentionItems.length}
          </span>
        )}
        {databaseStale && (
          <span aria-hidden="true" className="absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--theme-warning-text)]" />
        )}
      </button>
      <span id={menuStatusId} className="sr-only">
        {menuStatus}
      </span>

      {menuPresent && createPortal(
        <div className="mobile-menu-overlay fixed inset-0 z-50" data-state={isMenuOpen ? 'open' : 'closing'} style={{ bottom: 'var(--keyboard-offset, 0px)' }}>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="mobile-menu-scrim absolute inset-0 h-full w-full" style={{ background: 'var(--theme-scrim)' }}
            onClick={closeMenu}
          />
          <div
            ref={sheetRef}
            id="mobile-chat-menu"
            data-mobile-chat-menu
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="mobile-menu-sheet absolute inset-x-0 bottom-0 max-h-full overflow-y-auto overscroll-y-contain rounded-t-3xl bg-[var(--theme-surface)] p-3 text-[var(--theme-text-soft)]"
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
            {databaseStale && (
              <button
                type="button"
                className={`${menuRowClass} mb-2 border-[var(--theme-warning-border)] bg-[var(--theme-warning-soft)] text-[var(--theme-warning-text)]`}
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
            {otherAttentionItems.length > 0 && (
              <div className="mb-3 space-y-2 border-b border-[var(--theme-border)] pb-3">
                {otherAttentionItems.map(renderAttentionItem)}
              </div>
            )}

            <div role="group" aria-label="Mode" className="mode-capsule mb-3">
              <span
                className="mode-capsule-thumb"
                aria-hidden="true"
                style={{ transform: `translateX(${modeIndex * 100}%)` }}
              />
              {MENU_MODES.map((item, index) => (
                <button
                  key={item.mode}
                  type="button"
                  className="mode-capsule-button"
                  aria-pressed={modeIndex === index}
                  onClick={() => {
                    closeMenu()
                    setMode(item.mode)
                  }}
                >
                  <img src={item.icon} alt="" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 items-start gap-2 py-1">
              <button
                type="button"
                className={menuTileClass}
                aria-label={chatSending ? 'Clear chat (response in progress)' : 'Clear chat'}
                disabled={chatSending || chatEmpty}
                title={chatSending ? 'Available when the response finishes' : undefined}
                onClick={() => {
                  closeMenu()
                  window.dispatchEvent(new CustomEvent(TIMELINE_NEW_CHAT_EVENT))
                }}
              >
                <span aria-hidden="true" className={`${menuTileFaceClass} ${menuTileIdleFaceClass}`}>
                  <img src="/eraser.svg" alt="" className="h-6 w-6" />
                </span>
                <span className={menuTileLabelClass}>Clear chat</span>
                {chatSending && <span className={menuTileMetaClass}>Replying…</span>}
              </button>
              <button
                type="button"
                className={menuTileClass}
                aria-label={`Theme: ${theme.meta}`}
                onClick={() => {
                  void updateThemePreference(getNextThemePreference(themePreference))
                }}
              >
                <span aria-hidden="true" className={`${menuTileFaceClass} ${menuTileIdleFaceClass}`}>
                  <img src={theme.icon} alt="" className="h-6 w-6" />
                </span>
                <span className={menuTileLabelClass}>Theme</span>
                <span className={menuTileMetaClass}>{theme.meta}</span>
              </button>
              <Link to="/settings" className={menuTileClass} onClick={navigate}>
                <span aria-hidden="true" className={`${menuTileFaceClass} ${menuTileIdleFaceClass}`}>
                  <img src="/gear.svg" alt="" className="h-6 w-6" />
                </span>
                <span className={menuTileLabelClass}>Settings</span>
              </Link>
            </div>

            <section aria-labelledby="mobile-menu-sync-title" className="mt-3">
              <h2
                id="mobile-menu-sync-title"
                className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--theme-text-muted)]"
              >
                {activeSyncProvider ? `Sync • ${SYNC_PROVIDER_LABELS[activeSyncProvider]}` : 'Sync'}
              </h2>
              {syncAttentionItems.length > 0 && (
                <div className={`space-y-2 ${activeSyncProvider && !syncConflict ? 'mb-2' : ''}`}>
                  {syncAttentionItems.map(renderAttentionItem)}
                </div>
              )}
              {activeSyncProvider ? (
                !syncConflict && (
                  <div className="grid grid-cols-2 gap-2">
                    {renderSyncButton('pull')}
                    {renderSyncButton('push')}
                  </div>
                )
              ) : (
                syncAttentionItems.length === 0 && (
                  // The setup reminder was dismissed: keep a quiet way in.
                  <Link to="/settings#settings-sync" className={menuCardClass} onClick={navigate}>
                    <img src="/cloud-arrow-up.svg" alt="" className="h-6 w-6 shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={menuTileLabelClass}>Set up cloud sync</span>
                      <span className={menuTileMetaClass}>Notes stay on this device until then</span>
                    </span>
                    <img src="/caret-left.svg" alt="" className="h-4 w-4 shrink-0 rotate-180 opacity-70" />
                  </Link>
                )
              )}
            </section>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
