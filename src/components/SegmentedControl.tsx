type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )

  return (
    <div className="relative flex rounded-full bg-[var(--theme-surface-strong)] p-0.5">
      <div
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 rounded-full bg-[var(--theme-surface)] shadow-sm transition-transform"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${selectedIndex * 100}%)`,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className={`relative z-10 min-h-7 cursor-pointer rounded-full px-4 py-1 text-xs font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--theme-accent-rgb)/0.42)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-page)] ${
            option.value === value
              ? 'text-[var(--theme-text)]'
              : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
          }`}
          onClick={() => onChange(option.value)}
        >
          {/* Every label is stacked (invisibly) in every button so all segments
              share the width of the widest label — the header shrink-wraps this
              control, so percentage/fr tracks can't equalize widths on their own. */}
          <span className="grid">
            {options.map((sizer) => (
              <span
                key={sizer.value}
                aria-hidden={sizer.value !== option.value || undefined}
                className={`col-start-1 row-start-1 ${sizer.value === option.value ? '' : 'invisible'}`}
              >
                {sizer.label}
              </span>
            ))}
          </span>
        </button>
      ))}
    </div>
  )
}
