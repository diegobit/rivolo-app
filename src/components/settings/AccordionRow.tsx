type AccordionRowProps = {
  label: string
  badgeText?: string
  badgeClass?: string
  isActive?: boolean
  isOpen: boolean
  onToggle: () => void
  panelId: string
  children: React.ReactNode
}

export default function AccordionRow({
  label,
  badgeText,
  badgeClass,
  isActive,
  isOpen,
  onToggle,
  panelId,
  children,
}: AccordionRowProps) {
  return (
    <div>
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#22B3FF]/40"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggle}
      >
        {isActive !== undefined && (
          <svg
            className={`h-4 w-4 shrink-0 text-[#22B3FF] ${isActive ? '' : 'invisible'}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.29 6.8-6.79a1 1 0 0 1 1.4 0Z"
              clipRule="evenodd"
            />
          </svg>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">
          {label}
        </span>
        {badgeText && (
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${badgeClass}`}>
            {badgeText}
          </span>
        )}
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.58l3.3-3.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.42Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isOpen && (
        <div id={panelId} className="space-y-4 bg-slate-50 px-3 pb-4 sm:px-4">
          {children}
        </div>
      )}
    </div>
  )
}
