import { Fragment, type ReactNode } from 'react'

type BottomTrayRowProps = {
  mode: 'timeline' | 'chat' | 'search'
  chatButton: ReactNode
  searchButton: ReactNode
  modeToggleButton: ReactNode
  trayCenter: ReactNode
  mobileChatDock: ReactNode
  showScrollToToday: boolean
  showDesktopChatEdgeHandle: boolean
  desktopChatPanelOpen: boolean
  onToggleDesktopChatPanel: () => void
  onScrollToToday: () => void
}

export default function BottomTrayRow({
  mode,
  chatButton,
  searchButton,
  modeToggleButton,
  trayCenter,
  mobileChatDock,
  showScrollToToday,
  showDesktopChatEdgeHandle,
  desktopChatPanelOpen,
  onToggleDesktopChatPanel,
  onScrollToToday,
}: BottomTrayRowProps) {
  const mobileScrollToTodayTopClass = mode === 'search' ? 'top-[-6rem] sm:top-[-3.1rem]' : 'top-[-3.5rem] sm:top-[-3.1rem]'
  const trayRowAlignmentClass = mode === 'timeline' ? 'items-center' : 'items-end'
  // The desktop tray has 12px padding and a 1px border below Send.
  const modeToggleOffsetClassName = mode === 'timeline' ? '' : 'mb-[13px]'
  // Timeline on mobile home shows only the dock; every other combination has
  // controls of its own (launchers, mode toggle + composer, or the search field).
  const hasTrayControls = !mobileChatDock || mode !== 'timeline'

  return (
    <>
      <div
        className={`app-shell-fixed-right-aware bottom-tray-blur hero-ui-fade-down pointer-events-none fixed left-0 z-20 [mask-image:linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.6)_18%,black_72%)] ${
          mode === 'search' ? 'bottom-tray-blur-search' : ''
        }`}
        data-mobile-dock={mobileChatDock ? 'true' : 'false'}
        data-mode={mode}
      />
      <div className="app-shell-fixed-right-aware bottom-tray-blur-tail hero-ui-fade-down pointer-events-none fixed left-0 z-20" />

      <div className={`app-shell-fixed-right-aware app-shell-fixed-tray-width bottom-tray-row hero-ui-fade-down fixed left-0 z-30 mx-auto flex ${mobileChatDock ? 'flex-col' : trayRowAlignmentClass} justify-center gap-2 px-2 sm:gap-3 sm:px-0`}>
        {/* The whole bottom area fades out under the welcome hero, so the hero
            stays clean with no dock or composer. */}
        {hasTrayControls && (
          <div className={`flex w-full justify-center gap-2 ${mobileChatDock ? '' : mode === 'timeline' ? 'items-center' : 'items-end'}`}>
            {mode === 'timeline' ? (
              <>
                <Fragment key="chat-btn">{chatButton}</Fragment>
                <Fragment key="search-btn">{searchButton}</Fragment>
              </>
            ) : (
              <>
                <Fragment key="mode-toggle-btn">
                  {!mobileChatDock && <div className={modeToggleOffsetClassName}>{modeToggleButton}</div>}
                </Fragment>
                <Fragment key="tray">{mobileChatDock ? <div className="w-full">{trayCenter}</div> : trayCenter}</Fragment>
              </>
            )}
          </div>
        )}

        {mobileChatDock && (
          <div className="w-full">{mobileChatDock}</div>
        )}

        {showScrollToToday && (
          <button
            type="button"
            className={`absolute ${mobileScrollToTodayTopClass} flex h-11 w-11 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] shadow-sm transition hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-hover)] sm:right-0 sm:h-10 sm:w-10 right-[15px]`}
            aria-label="Scroll to Today"
            onClick={onScrollToToday}
          >
            <img src="/arrow-line-up.svg" alt="" className="h-5 w-5" />
          </button>
        )}
      </div>

      {showDesktopChatEdgeHandle && (
        <button
          type="button"
          className="timeline-chat-edge-handle fixed top-1/2 z-30 hidden h-16 w-8 -translate-y-1/2 items-center justify-center rounded-l-full border border-r-0 border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text-soft)] shadow-[-10px_0_22px_-20px_rgb(var(--theme-shadow-color)/0.50)] hover:border-[var(--theme-border-strong)] sm:inline-flex"
          aria-label={desktopChatPanelOpen ? 'Hide chat' : 'Show chat'}
          onClick={onToggleDesktopChatPanel}
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
  )
}
