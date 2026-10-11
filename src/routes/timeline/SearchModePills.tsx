import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { SearchFilter } from '../../lib/dayRepository'
import { SEARCH_FILTER_OPTIONS } from '../../lib/searchFilters'
import type { SearchResultMode } from '../Timeline'

const chipFocusClass =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-accent)]'

const overflowFadeClass =
  '[-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] after:w-6 after:shrink-0 after:content-[\'\']'

// Inside the phone composer the chips match its Timeline and Menu chips; an
// active one takes the accent tint.
const composerChipClass =
  'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition active:opacity-75'
const composerChipIdleClass = 'bg-[var(--theme-active)] text-[var(--theme-text-soft)]'
const composerChipActiveClass = 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)]'

// Filter taps keep focus in the search field, so the keyboard stays up.
const keepFieldFocus = (event: ReactMouseEvent) => event.preventDefault()

const SearchModePills = memo(({
  searchFilter,
  resultMode,
  layout,
  onSearchFilterChange,
  onResultModeChange,
}: {
  searchFilter: SearchFilter | null
  resultMode: SearchResultMode
  // 'card': the desktop search card, which always lists every match, so it has
  // no result toggle. 'composer': the row inside the phone search box, where a
  // Lines chip switches the timeline from whole days to matching lines.
  layout: 'card' | 'composer'
  onSearchFilterChange: (filter: SearchFilter | null) => void
  onResultModeChange: (mode: SearchResultMode) => void
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const inComposer = layout === 'composer'

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const update = () => {
      // The end spacer exists only while scrolling, so measure the chips themselves.
      const contentWidth = Array.from(scroller.children).reduce(
        (sum, child) => sum + (child as HTMLElement).offsetWidth,
        0,
      )
      const styles = getComputedStyle(scroller)
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0
      const gaps = Math.max(0, scroller.children.length - 1) * gap
      setOverflows(contentWidth + gaps > scroller.clientWidth + 1)
    }

    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [searchFilter, layout])

  const activeFilterLabel = SEARCH_FILTER_OPTIONS.find((option) => option.value === searchFilter)?.label
  const removeFilterDisc = (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
      <path d="M4 4l8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 4L4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )

  return (
    <div
      ref={scrollerRef}
      className={`pointer-events-auto flex w-full min-w-0 items-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        inComposer ? 'gap-1.5' : 'gap-2 pb-2 -mb-1'
      } ${overflows ? overflowFadeClass : ''}`}
    >
    {inComposer && (
      <button
        type="button"
        className={`${composerChipClass} ${resultMode === 'matched-lines' ? composerChipActiveClass : composerChipIdleClass} ${chipFocusClass}`}
        aria-pressed={resultMode === 'matched-lines'}
        onMouseDown={keepFieldFocus}
        onClick={() => onResultModeChange(resultMode === 'matched-lines' ? 'whole-day' : 'matched-lines')}
      >
        Lines
      </button>
    )}
    {searchFilter ? (
      inComposer ? (
        <button
          type="button"
          className={`${composerChipClass} ${composerChipActiveClass} pr-2.5 ${chipFocusClass}`}
          onMouseDown={keepFieldFocus}
          onClick={() => onSearchFilterChange(null)}
          aria-label={`Remove ${activeFilterLabel ?? 'filter'} filter`}
        >
          {activeFilterLabel}
          {removeFilterDisc}
        </button>
      ) : (
        <button
          data-active="true"
          className={`capsule-chip group inline-flex h-11 shrink-0 items-center gap-2 pl-3.5 pr-2 text-xs font-semibold text-[var(--theme-text)] transition hover:border-[var(--theme-border-strong)] sm:h-8 ${chipFocusClass}`}
          type="button"
          onClick={() => onSearchFilterChange(null)}
          aria-label={`Remove ${activeFilterLabel ?? 'filter'} filter`}
        >
          {activeFilterLabel}
          <span className="capsule-chip-disc flex h-5 w-5 items-center justify-center rounded-full bg-[var(--theme-active)] text-[var(--theme-text-soft)] transition group-hover:bg-[var(--theme-border)] group-hover:text-[var(--theme-text)] sm:h-4 sm:w-4">
            {removeFilterDisc}
          </span>
        </button>
      )
    ) : (
      SEARCH_FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          className={
            inComposer
              ? `${composerChipClass} ${composerChipIdleClass} ${chipFocusClass}`
              : `capsule-chip inline-flex h-11 shrink-0 items-center px-3.5 text-xs font-semibold text-[var(--theme-text-soft)] transition hover:border-[var(--theme-border-strong)] hover:text-[var(--theme-text)] sm:h-8 ${chipFocusClass}`
          }
          type="button"
          onMouseDown={inComposer ? keepFieldFocus : undefined}
          onClick={() => onSearchFilterChange(option.value)}
        >
          {option.label}
        </button>
      ))
    )}
    </div>
  )
})

export default SearchModePills
