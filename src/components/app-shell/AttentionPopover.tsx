import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SetupNoticeId } from '../../lib/setupAttention'

export type AttentionItem = {
  id: string
  title: string
  description: string
  settingsSectionId: 'settings-ai' | 'settings-sync' | 'settings-data'
  dismissibleSetupNoticeId?: SetupNoticeId
}

type AttentionPopoverProps = {
  items: AttentionItem[]
  onDismissSetupNotice: (noticeId: SetupNoticeId) => void
  onNavigate: () => void
}

export default function AttentionPopover({
  items,
  onDismissSetupNotice,
  onNavigate,
}: AttentionPopoverProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return
      setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const itemLabel =
    items.length === 1 ? '1 item needs attention' : `${items.length} items need attention`

  return (
    <div ref={containerRef} className="static">
      <button
        ref={triggerRef}
        type="button"
        className="flex h-11 w-11 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-sm font-bold text-amber-800 shadow-sm outline-none transition hover:border-amber-300 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 sm:h-9 sm:w-9"
        aria-label={itemLabel}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={items.map((item) => item.title).join('\n')}
        onClick={() => setIsOpen((current) => !current)}
      >
        {items.length}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full z-40 mt-2 w-[calc(100vw-2rem)] max-w-[19rem] rounded-2xl border border-amber-200 bg-white p-2 text-left shadow-lg"
          role="dialog"
          aria-label="Items needing attention"
        >
          <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            Needs attention
          </p>
          <div className="space-y-1">
            {items.map((item) => (
              <div key={item.id} className="flex items-start rounded-xl bg-amber-50">
                <Link
                  to={`/settings#${item.settingsSectionId}`}
                  className="min-w-0 flex-1 rounded-xl px-3 py-2 outline-none transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
                  onClick={() => {
                    setIsOpen(false)
                    onNavigate()
                  }}
                >
                  <span className="block text-sm font-semibold text-amber-900">{item.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-amber-800">
                    {item.description}
                  </span>
                </Link>
                {item.dismissibleSetupNoticeId && (
                  <button
                    type="button"
                    className="m-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-amber-700 outline-none transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-300"
                    aria-label={`Dismiss ${item.title}`}
                    title="Dismiss reminder"
                    onClick={() => onDismissSetupNotice(item.dismissibleSetupNoticeId!)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
