import { Fragment, type ReactNode } from 'react'

type BottomTrayRowProps = {
  mode: 'timeline' | 'chat' | 'search'
  chatButton: ReactNode
  searchButton: ReactNode
  modeToggleButton: ReactNode
  trayCenter: ReactNode
  showLauncherButtons: boolean
  launcherSpread: boolean
  showMobileChatTogglePill: boolean
  chatPanelOpen: boolean
  onToggleChatPanel: () => void
  showScrollToToday: boolean
  onScrollToToday: () => void
}

export default function BottomTrayRow({
  mode,
  chatButton,
  searchButton,
  modeToggleButton,
  trayCenter,
  showLauncherButtons,
  launcherSpread,
  showMobileChatTogglePill,
  chatPanelOpen,
  onToggleChatPanel,
  showScrollToToday,
  onScrollToToday,
}: BottomTrayRowProps) {
  const mobileScrollToTodayTopClass = mode === 'search' ? 'top-[-6rem] sm:top-[-3.1rem]' : 'top-[-3.5rem] sm:top-[-3.1rem]'
  // The launcher pair (lens bottom-left, AI bottom-right) owns the row on
  // desktop in every mode and on timeline mode everywhere else. The tray
  // composer only appears on narrow viewports in chat/search mode.
  const showTraySlot = !showLauncherButtons
  const trayRowAlignmentClass = showTraySlot ? 'items-end' : 'items-center'
  const trayRowJustifyClass = 'justify-center'
  const modeToggleOffsetClassName = showTraySlot ? 'mb-1.5 sm:mb-3' : ''
  const scrollToTodayRightClass = launcherSpread
    ? 'right-0'
    : `${showMobileChatTogglePill ? 'right-[67px]' : 'right-[15px]'} sm:right-0`

  return (
    <>
      <div
        className={`app-shell-fixed-right-aware bottom-tray-blur hero-ui-fade-down pointer-events-none fixed left-0 z-20 bg-[var(--theme-blur-surface)] backdrop-blur-md [mask-image:linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.75)_20%,black_80%)] ${
          mode === 'search' && !launcherSpread ? 'bottom-tray-blur-search' : ''
        }`}
      />
      <div className="app-shell-fixed-right-aware bottom-tray-blur-tail hero-ui-fade-down pointer-events-none fixed left-0 z-20 bg-[var(--theme-blur-surface)] backdrop-blur-md" />

      <div className={`app-shell-fixed-right-aware app-shell-fixed-tray-width bottom-tray-row hero-ui-fade-down fixed left-0 z-30 mx-auto flex ${trayRowAlignmentClass} ${trayRowJustifyClass} gap-2 px-2 sm:gap-3 sm:px-0`}>
        {showLauncherButtons ? (
          // On desktop CSS lifts this pair out of the row and pins it to the
          // viewport centre, so a card opening never shifts the buttons.
          <div
            className={`flex items-center gap-2 sm:gap-3 ${launcherSpread ? 'bottom-tray-launchers' : ''}`}
          >
            <Fragment key="search-btn">{searchButton}</Fragment>
            <Fragment key="chat-btn">{chatButton}</Fragment>
          </div>
        ) : (
          <Fragment key="mode-toggle-btn">
            <div className={modeToggleOffsetClassName}>{modeToggleButton}</div>
          </Fragment>
        )}
        {/*
          The tray slot stays mounted in every mode (AppShell hides it while the
          launcher buttons own the row) so #bottom-tray keeps a stable identity
          for the BottomTrayPortal targets across viewport and mode changes.
        */}
        <Fragment key="tray">{trayCenter}</Fragment>

        {showMobileChatTogglePill && (
          <button
            type="button"
            className="absolute right-[15px] top-[-3.5rem] inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text-soft)] shadow-sm transition hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-hover)] sm:hidden"
            aria-label={chatPanelOpen ? 'Hide chat' : 'Show chat'}
            onClick={onToggleChatPanel}
          >
            {chatPanelOpen ? (
              <img
                src="/caret-left.svg"
                alt=""
                className="h-5 w-5 -rotate-90 opacity-70"
              />
            ) : (
              <img src="/chats-teardrop.svg" alt="" className="h-5 w-5 opacity-75 transition-opacity duration-200" />
            )}
          </button>
        )}

        {showScrollToToday && (
          <button
            type="button"
            className={`absolute ${mobileScrollToTodayTopClass} ${scrollToTodayRightClass} flex h-11 w-11 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] shadow-sm transition hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-hover)] sm:h-10 sm:w-10`}
            aria-label="Scroll to Today"
            onClick={onScrollToToday}
          >
            <img src="/arrow-line-up.svg" alt="" className="h-5 w-5" />
          </button>
        )}
      </div>
    </>
  )
}
