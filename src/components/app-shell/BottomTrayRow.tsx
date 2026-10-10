import { Fragment, useState, type ReactNode } from 'react'

type BottomTrayRowProps = {
  mode: 'timeline' | 'chat' | 'search'
  chatButton: ReactNode
  searchButton: ReactNode
  modeToggleButton: ReactNode
  trayCenter: ReactNode
  showLauncherButtons: boolean
  launcherSpread: boolean
  mobileMenu: ReactNode
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
  mobileMenu,
  showScrollToToday,
  onScrollToToday,
}: BottomTrayRowProps) {
  const [selection, setSelection] = useState({ mode, position: mode === 'chat' ? 'chat' : 'search', slides: false })
  if (selection.mode !== mode) {
    // Update before paint so opening from the plain timeline never briefly
    // shows the thumb under the other launcher.
    setSelection({
      mode,
      position: mode === 'timeline' ? selection.position : mode,
      // Let an in-flight glide finish while closing, without moving its target.
      slides: selection.mode !== 'timeline',
    })
  }
  const mobileScrollToTodayTopClass = mode === 'search' ? 'top-[-6rem] sm:top-[-3.1rem]' : 'top-[-3.5rem] sm:top-[-3.1rem]'
  // The launchers (Search, then Chat) show on desktop in every mode and on
  // narrow viewports in timeline mode. The tray composer only appears on narrow
  // viewports in chat/search mode.
  const showTraySlot = !showLauncherButtons
  const trayRowAlignmentClass = showTraySlot ? 'items-end' : 'items-center'
  const trayRowJustifyClass = 'justify-center'
  const modeToggleOffsetClassName = showTraySlot ? 'mb-1.5 sm:mb-3' : ''
  const mobileScrollToTodayRightClass = 'right-[15px] sm:right-0'
  // On desktop it sits centred just above the launcher capsule (it is rendered
  // inside it), so it moves with the capsule and never lands under it.
  const scrollToTodayPositionClass = launcherSpread
    ? 'bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2'
    : `${mobileScrollToTodayTopClass} ${mobileScrollToTodayRightClass}`
  const scrollToTodayButton = showScrollToToday ? (
    <button
      type="button"
      className={`absolute ${scrollToTodayPositionClass} flex h-11 w-11 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] shadow-sm transition hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-hover)] sm:h-10 sm:w-10`}
      aria-label="Scroll to Today"
      title="Scroll to Today"
      onClick={onScrollToToday}
    >
      <img src="/arrow-line-up.svg" alt="" className="h-5 w-5" />
    </button>
  ) : null

  return (
    <>
      <div
        className={`app-shell-fixed-right-aware bottom-tray-blur hero-ui-fade-down pointer-events-none fixed left-0 z-20 [mask-image:linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.6)_18%,black_72%)] ${
          mode === 'search' && !launcherSpread ? 'bottom-tray-blur-search' : ''
        }`}
        data-mode={mode}
      />
      <div className="app-shell-fixed-right-aware bottom-tray-blur-tail hero-ui-fade-down pointer-events-none fixed left-0 z-20" />

      <div className={`app-shell-fixed-right-aware app-shell-fixed-tray-width bottom-tray-row hero-ui-fade-down fixed left-0 z-30 mx-auto flex ${trayRowAlignmentClass} ${trayRowJustifyClass} gap-2 px-2 sm:gap-3 sm:px-0`}>
        {showLauncherButtons ? (
          // On desktop CSS lifts this pair out of the row and pins it to the
          // viewport centre, so a card opening never shifts the buttons.
          <div
            className={`flex items-center ${launcherSpread ? 'bottom-tray-launchers' : 'gap-2 sm:gap-3'}`}
            // Tells the capsule which half the sliding thumb sits behind.
            data-open={launcherSpread && (mode === 'search' || mode === 'chat') ? mode : undefined}
            data-position={selection.position}
            data-slide={selection.slides ? 'true' : 'false'}
          >
            {launcherSpread ? (
              // Desktop mirrors the cards: search opens on the left, chat on the right.
              <>
                <Fragment key="search-btn">{searchButton}</Fragment>
                <Fragment key="chat-btn">{chatButton}</Fragment>
              </>
            ) : (
              <>
                <Fragment key="chat-btn">{chatButton}</Fragment>
                <Fragment key="search-btn">{searchButton}</Fragment>
              </>
            )}
            {launcherSpread && scrollToTodayButton}
          </div>
        ) : !mobileMenu && (
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

        {mobileMenu && <div className="mb-1.5">{mobileMenu}</div>}

        {!launcherSpread && scrollToTodayButton}
      </div>
    </>
  )
}
