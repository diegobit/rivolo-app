import { memo, useLayoutEffect, useRef, useState } from 'react'
import SegmentedCapsule from '../../components/SegmentedCapsule'
import type { SearchFilter } from '../../lib/dayRepository'
import { SEARCH_FILTER_OPTIONS } from '../../lib/searchFilters'
import type { SearchResultMode } from '../Timeline'

const resultModeSegments: { value: SearchResultMode; word: string }[] = [
  { value: 'whole-day', word: 'Days' },
  { value: 'matched-lines', word: 'Lines' },
]


const chipFocusClass =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-accent)]'

const overflowFadeClass =
  '[-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] after:w-6 after:shrink-0 after:content-[\'\']'

const SearchModePills = memo(({
  searchFilter,
  resultMode,
  showResultMode,
  onSearchFilterChange,
  onResultModeChange,
}: {
  searchFilter: SearchFilter | null
  resultMode: SearchResultMode
  // The desktop search card always lists every match, so it hides this toggle:
  // there the "Days" mode only deduplicated to one hit per day rather than
  // showing whole days the way the narrow-viewport timeline does.
  showResultMode: boolean
  onSearchFilterChange: (filter: SearchFilter | null) => void
  onResultModeChange: (mode: SearchResultMode) => void
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)

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
  }, [searchFilter, showResultMode])

  return (
    <div
      ref={scrollerRef}
      className={`pointer-events-auto flex w-full min-w-0 items-center gap-2 overflow-x-auto pb-2 -mb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${overflows ? overflowFadeClass : ''}`}
    >
    {showResultMode && (
      <SegmentedCapsule
        className="mode-capsule-compact"
        label="Show results as"
        value={resultMode}
        segments={resultModeSegments.map((segment) => ({
          value: segment.value,
          ariaLabel: `Show ${segment.word}`,
          label: (
            <span className="mode-capsule-lines" aria-hidden="true">
              <span>Show</span>
              <span>{segment.word}</span>
            </span>
          ),
        }))}
        onChange={onResultModeChange}
      />
    )}
    {searchFilter ? (
      <button
        data-active="true"
        className={`capsule-chip group inline-flex h-11 shrink-0 items-center gap-2 pl-3.5 pr-2 text-xs font-semibold text-[var(--theme-text)] transition hover:border-[var(--theme-border-strong)] sm:h-8 ${chipFocusClass}`}
        type="button"
        onClick={() => onSearchFilterChange(null)}
        aria-label={`Remove ${SEARCH_FILTER_OPTIONS.find((option) => option.value === searchFilter)?.label ?? 'filter'} filter`}
      >
        {SEARCH_FILTER_OPTIONS.find((option) => option.value === searchFilter)?.label}
        <span className="capsule-chip-disc flex h-5 w-5 items-center justify-center rounded-full bg-[var(--theme-active)] text-[var(--theme-text-soft)] transition group-hover:bg-[var(--theme-border)] group-hover:text-[var(--theme-text)] sm:h-4 sm:w-4">
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
            <path d="M4 4l8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M12 4L4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
      </button>
    ) : (
      SEARCH_FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          className={`capsule-chip inline-flex h-11 shrink-0 items-center px-3.5 text-xs font-semibold text-[var(--theme-text-soft)] transition hover:border-[var(--theme-border-strong)] hover:text-[var(--theme-text)] sm:h-8 ${chipFocusClass}`}
          type="button"
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
