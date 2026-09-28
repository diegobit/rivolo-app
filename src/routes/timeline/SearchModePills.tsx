import { memo } from 'react'
import type { SearchFilter } from '../../lib/dayRepository'
import type { SearchResultMode } from '../Timeline'

type SearchFilterOption = {
  value: SearchFilter
  label: string
}

const SEARCH_FILTER_OPTIONS: SearchFilterOption[] = [
  { value: 'open-todos', label: 'TODOs' },
  { value: 'tags', label: '# Tags' },
  { value: 'mentions', label: '@ Mentions' },
  { value: 'headings', label: 'Sections' },
]

const getResultModeLabel = (resultMode: SearchResultMode) =>
  resultMode === 'whole-day' ? 'Days' : 'Lines'

const chipFocusClass =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-accent)]'

const SearchModePills = memo(({
  searchFilter,
  resultMode,
  onSearchFilterChange,
  onToggleResultMode,
}: {
  searchFilter: SearchFilter | null
  resultMode: SearchResultMode
  onSearchFilterChange: (filter: SearchFilter | null) => void
  onToggleResultMode: () => void
}) => (
  <div className="pointer-events-auto flex items-center gap-2 overflow-x-auto pb-2 -mb-1 [-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] after:w-6 after:shrink-0 after:content-[''] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <button
      className={`capsule-segmented inline-flex h-10 shrink-0 items-center gap-0.5 text-xs font-semibold transition hover:border-[var(--theme-border-strong)] sm:h-8 ${chipFocusClass}`}
      type="button"
      onClick={onToggleResultMode}
      aria-label={`Toggle result mode. Current mode: ${getResultModeLabel(resultMode)}`}
    >
      <span className="px-2 text-[10px] uppercase tracking-[0.05em]">Show</span>
      <span
        data-active={resultMode === 'whole-day'}
        className="capsule-segment flex h-full items-center rounded-full px-3 transition-colors"
      >
        Days
      </span>
      <span
        data-active={resultMode === 'matched-lines'}
        className="capsule-segment flex h-full items-center rounded-full px-3 transition-colors"
      >
        Lines
      </span>
    </button>
    {searchFilter ? (
      <button
        data-active="true"
        className={`capsule-chip group inline-flex h-10 shrink-0 items-center gap-2 pl-3.5 pr-2 text-xs font-semibold text-[var(--theme-text)] transition hover:border-[var(--theme-border-strong)] sm:h-8 ${chipFocusClass}`}
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
          className={`capsule-chip inline-flex h-10 shrink-0 items-center px-3.5 text-xs font-semibold text-[var(--theme-text-soft)] transition hover:border-[var(--theme-border-strong)] hover:text-[var(--theme-text)] sm:h-8 ${chipFocusClass}`}
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
