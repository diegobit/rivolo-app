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
  <div className="pointer-events-auto flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <button
      className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full border border-[#bfd9ff] bg-[#EBF4FF] px-2 text-xs font-semibold text-[#0f5580] shadow-[0_1px_2px_rgba(15,23,42,0.1),0_2px_8px_rgba(15,23,42,0.06)] transition hover:border-[#9dc6ff] sm:h-8"
      type="button"
      onClick={onToggleResultMode}
      aria-label={`Toggle result mode. Current mode: ${getResultModeLabel(resultMode)}`}
    >
      <span className="px-1 text-[10px] uppercase tracking-[0.05em] text-[#0f5580]/70">Show</span>
      <span
        className={`rounded-full px-2 py-1 sm:py-0.5 ${
          resultMode === 'whole-day' ? 'bg-white text-[#0f5580] shadow-sm' : 'text-[#0f5580]/70'
        }`}
      >
        Days
      </span>
      <span
        className={`rounded-full px-2 py-1 sm:py-0.5 ${
          resultMode === 'matched-lines' ? 'bg-white text-[#0f5580] shadow-sm' : 'text-[#0f5580]/70'
        }`}
      >
        Lines
      </span>
    </button>
    {searchFilter ? (
      <button
        className="group inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-[#bfd9ff] bg-[#EBF4FF] px-3 text-xs font-semibold text-[#0f5580] shadow-[0_1px_2px_rgba(15,23,42,0.1),0_2px_8px_rgba(15,23,42,0.06)] transition hover:border-[#9dc6ff] sm:h-8"
        type="button"
        onClick={() => onSearchFilterChange(null)}
        aria-label={`Remove ${SEARCH_FILTER_OPTIONS.find((option) => option.value === searchFilter)?.label ?? 'filter'} filter`}
      >
        {SEARCH_FILTER_OPTIONS.find((option) => option.value === searchFilter)?.label}
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[#0f5580] transition group-hover:bg-[#dcecff]">
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
          className="inline-flex h-10 shrink-0 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.1),0_2px_8px_rgba(15,23,42,0.06)] transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 sm:h-8"
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
