import { memo } from 'react'
import type { SearchFilter } from '../../lib/dayRepository'
import { SEARCH_FILTER_OPTIONS } from '../../lib/searchFilters'
import type { SearchResultMode } from '../Timeline'


const chipFocusClass =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-accent)]'

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
}) => (
  <div className="pointer-events-auto flex items-center gap-2 overflow-x-auto pb-2 -mb-1 [-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] after:w-6 after:shrink-0 after:content-[''] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {showResultMode && <div
      role="group"
      aria-label="Show results as"
      className="capsule-segmented inline-flex h-[50px] shrink-0 items-center gap-0.5 text-xs font-semibold sm:h-8"
    >
      <span aria-hidden="true" className="px-2 text-[10px] uppercase tracking-[0.05em]">
        Show
      </span>
      {(['whole-day', 'matched-lines'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={resultMode === mode}
          onClick={() => onResultModeChange(mode)}
          className={`capsule-segment flex h-full items-center rounded-full px-3 transition-colors ${chipFocusClass}`}
        >
          {mode === 'whole-day' ? 'Days' : 'Lines'}
        </button>
      ))}
    </div>}
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
))

export default SearchModePills
