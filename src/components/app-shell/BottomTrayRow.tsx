import { Fragment, type ReactNode } from 'react'

type BottomTrayRowProps = {
  mode: 'timeline' | 'chat' | 'search'
  chatButton: ReactNode
  searchButton: ReactNode
  trayCenter: ReactNode
  showMobileChatTogglePill: boolean
  chatPanelOpen: boolean
  onToggleChatPanel: () => void
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
  trayCenter,
  showMobileChatTogglePill,
  chatPanelOpen,
  onToggleChatPanel,
  showScrollToToday,
  showDesktopChatEdgeHandle,
  desktopChatPanelOpen,
  onToggleDesktopChatPanel,
  onScrollToToday,
}: BottomTrayRowProps) {
  const mobileScrollToTodayTopClass = mode === 'search' ? 'top-[-6rem] sm:top-[-3.1rem]' : 'top-[-3.1rem]'

  return (
    <>
      <div
        className={`app-shell-fixed-right-aware bottom-tray-blur hero-ui-fade-down pointer-events-none fixed left-0 z-20 bg-white/30 backdrop-blur-md [mask-image:linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.75)_20%,black_80%)] ${
          mode === 'search' ? 'bottom-tray-blur-search' : ''
        }`}
      />
      <div className="app-shell-fixed-right-aware bottom-tray-blur-tail hero-ui-fade-down pointer-events-none fixed left-0 z-20 bg-white/30 backdrop-blur-md" />

      <div className="app-shell-fixed-right-aware app-shell-fixed-tray-width bottom-tray-row hero-ui-fade-down fixed left-0 z-30 mx-auto flex items-center justify-center gap-2 px-2 sm:gap-3 sm:px-0">
        {mode !== 'chat' && <Fragment key="chat-btn">{chatButton}</Fragment>}
        {mode === 'chat' && <Fragment key="tray">{trayCenter}</Fragment>}

        {mode !== 'search' && <Fragment key="search-btn">{searchButton}</Fragment>}
        {mode === 'search' && <Fragment key="tray">{trayCenter}</Fragment>}

        {showMobileChatTogglePill && (
          <button
            type="button"
            className="absolute right-2 top-[-3.1rem] inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-slate-300 sm:hidden"
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
            className={`absolute ${mobileScrollToTodayTopClass} flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 sm:right-0 sm:h-10 sm:w-10 ${
              showMobileChatTogglePill ? 'right-[3.75rem]' : 'right-2'
            }`}
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
          className="timeline-chat-edge-handle fixed top-1/2 z-30 hidden h-16 w-8 -translate-y-1/2 items-center justify-center rounded-l-full border border-r-0 border-slate-200 bg-white text-slate-600 shadow-[-10px_0_22px_-20px_rgba(15,23,42,0.3)] hover:border-slate-300 sm:inline-flex"
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
