import { useEffect, useRef, type RefObject } from 'react'
import { isApplePlatform } from '../../lib/device'

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
  const primaryModifierLabel = isApplePlatform() ? 'Cmd' : 'Ctrl'
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!showShortcuts) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      onToggle()
      triggerRef.current?.focus()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onToggle, showShortcuts])

  return (
    <div ref={shortcutsRef} className="hero-ui-fade-up relative">
      <button
        ref={triggerRef}
        className={buttonClassName}
        type="button"
        aria-label="Shortcuts"
        aria-expanded={showShortcuts}
        aria-haspopup="dialog"
        onClick={onToggle}
      >
        <img src="/question-mark.svg" alt="" className="h-5 w-5" />
      </button>
      {showShortcuts && (
        <div
          className="absolute left-0 z-20 mt-2 w-max rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-lg"
          role="dialog"
          aria-label="Keyboard shortcuts"
        >
          <div className="grid gap-4">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Input Modes:
              </div>
              <div className="grid gap-1">
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">K</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Ask the AI</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
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
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">Shift</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">E</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>New Today entry</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">Shift</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">Y</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Scroll to Today/Top</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">Shift</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">S</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Show/hide sidebar</span>
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
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">Enter</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Toggle/Create todo</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
