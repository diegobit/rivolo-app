import type { RefObject } from 'react'

type ShortcutsPopoverProps = {
  shortcutsRef: RefObject<HTMLDivElement | null>
  showShortcuts: boolean
  onToggle: () => void
  buttonClassName: string
}

export default function ShortcutsPopover({
  shortcutsRef,
  showShortcuts,
  onToggle,
  buttonClassName,
}: ShortcutsPopoverProps) {
  return (
    <div ref={shortcutsRef} className="hero-ui-fade-up relative">
      <button
        className={buttonClassName}
        type="button"
        aria-label="Shortcuts"
        onClick={onToggle}
      >
        <img src="/question-mark.svg" alt="" className="h-5 w-5" />
      </button>
      {showShortcuts && (
        <div className="absolute left-0 z-20 mt-2 w-max rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-lg">
          <div className="grid gap-4">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Input Modes:
              </div>
              <div className="grid gap-1">
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">A</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Ask the AI</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">F</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Find</span>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Others:
              </div>
              <div className="grid gap-1">
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">T</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Scroll to Today/Top</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">N</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>New Today/Tomorrow</span>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Editing:
              </div>
              <div className="grid gap-1">
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">Cmd/Ctrl</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">Enter</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Toggle/Create todo</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">/td</kbd>
                    <span className="text-slate-400">/</span>
                    <kbd className="kbd">/todo</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Line-start TODO snippet</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">/cd</kbd>
                    <span className="text-slate-400">/</span>
                    <kbd className="kbd">/code</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Line-start code block snippet</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">I</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Focus Today editor</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">Esc</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Exit focus or back to Homepage</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
