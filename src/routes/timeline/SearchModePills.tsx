import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import SegmentedCapsule from '../../components/SegmentedCapsule'
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
  'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition active:opacity-75'
const composerChipIdleClass = 'bg-[var(--theme-active)] text-[var(--theme-text-soft)]'
const composerChipActiveClass = 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)]'

// Filter taps keep focus in the search field, so the keyboard stays up.
const keepFieldFocus = (event: ReactMouseEvent) => event.preventDefault()

// A row of chips that scrolls sideways fades out at its right edge while it overflows.
const useOverflowFade = (...deps: unknown[]) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return [scrollerRef, overflows] as const
}

const chipRowClass =
  'flex w-full min-w-0 items-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

const RESULT_MODE_SEGMENTS: { value: SearchResultMode; label: string; ariaLabel: string }[] = [
  { value: 'whole-day', label: 'Days', ariaLabel: 'Days' },
  { value: 'matched-lines', label: 'Lines', ariaLabel: 'Lines' },
]

const removeFilterDisc = (
  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
    <path d="M4 4l8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M12 4L4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

// The phone search box's action row: a Days | Lines capsule, then one Filter
// dropdown. An active filter replaces the dropdown with its own pill and an X.
// The row scrolls sideways when a long filter name doesn't fit. The menu opens
// above the box: it sits outside the row, which would clip it, and is placed
// against the composer instead.
const ComposerSearchControls = ({
  searchFilter,
  resultMode,
  onSearchFilterChange,
  onResultModeChange,
}: {
  searchFilter: SearchFilter | null
  resultMode: SearchResultMode
  onSearchFilterChange: (filter: SearchFilter | null) => void
  onResultModeChange: (mode: SearchResultMode) => void
}) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuLeft, setMenuLeft] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const activeFilterLabel = SEARCH_FILTER_OPTIONS.find((option) => option.value === searchFilter)?.label
  const [scrollerRef, overflows] = useOverflowFade(searchFilter)

  useLayoutEffect(() => {
    if (!menuOpen) return
    const trigger = triggerRef.current
    const menu = menuRef.current
    const anchor = menu?.offsetParent
    if (!trigger || !menu || !anchor) return
    // Line the menu up with the Filter pill, kept inside the composer.
    const anchorRect = anchor.getBoundingClientRect()
    const left = trigger.getBoundingClientRect().left - anchorRect.left
    setMenuLeft(Math.max(0, Math.min(left, anchorRect.width - menu.offsetWidth)))
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [menuOpen])

  const chooseFilter = (filter: SearchFilter | null) => {
    setMenuOpen(false)
    onSearchFilterChange(filter)
  }

  const menuOptions: { value: SearchFilter | null; label: string }[] = [
    { value: null, label: 'No filter' },
    ...SEARCH_FILTER_OPTIONS,
  ]

  return (
    <div className="pointer-events-auto w-full min-w-0">
      <div ref={scrollerRef} className={`${chipRowClass} gap-1.5 ${overflows ? overflowFadeClass : ''}`}>
        <div onMouseDown={keepFieldFocus} className="shrink-0">
          <SegmentedCapsule
            className="mode-capsule-compact"
            label="Show"
            value={resultMode}
            segments={RESULT_MODE_SEGMENTS}
            onChange={onResultModeChange}
          />
        </div>
        {searchFilter ? (
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
            ref={triggerRef}
            type="button"
            className={`${composerChipClass} ${menuOpen ? 'bg-[var(--theme-hover)] text-[var(--theme-text)]' : composerChipIdleClass} pr-3 ${chipFocusClass}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onMouseDown={keepFieldFocus}
            onClick={() => setMenuOpen((open) => !open)}
          >
            Filter
            <svg
              viewBox="0 0 16 16"
              className={`h-3.5 w-3.5 opacity-70 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
              fill="none"
              aria-hidden="true"
            >
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      {menuOpen && !searchFilter ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Filter"
          className="tray-phone-filter-menu"
          style={{ left: menuLeft }}
          onMouseDown={keepFieldFocus}
        >
          {menuOptions.map((option) => {
            const checked = option.value === searchFilter
            return (
              <button
                key={option.value ?? 'none'}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                className={`flex h-11 w-full items-center justify-between gap-6 rounded-xl px-3 text-left text-sm font-medium transition active:bg-[var(--theme-active)] ${
                  checked ? 'text-[var(--theme-text)]' : 'text-[var(--theme-text-soft)]'
                } ${chipFocusClass}`}
                onClick={() => chooseFilter(option.value)}
              >
                {option.label}
                {checked ? (
                  <svg viewBox="0 0 16 16" className="h-4 w-4 text-[var(--theme-accent-text)]" fill="none" aria-hidden="true">
                    <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

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
  // no result toggle. 'composer': the row inside the phone search box, where
  // Days | Lines switches the timeline between whole days and matching lines.
  layout: 'card' | 'composer'
  onSearchFilterChange: (filter: SearchFilter | null) => void
  onResultModeChange: (mode: SearchResultMode) => void
}) => {
  const inComposer = layout === 'composer'
  const [scrollerRef, overflows] = useOverflowFade(searchFilter, layout)

  const activeFilterLabel = SEARCH_FILTER_OPTIONS.find((option) => option.value === searchFilter)?.label

  if (inComposer) {
    return (
      <ComposerSearchControls
        searchFilter={searchFilter}
        resultMode={resultMode}
        onSearchFilterChange={onSearchFilterChange}
        onResultModeChange={onResultModeChange}
      />
    )
  }

  return (
    <div
      ref={scrollerRef}
      className={`pointer-events-auto -mb-1 gap-2 pb-2 ${chipRowClass} ${
        overflows ? overflowFadeClass : ''
      }`}
    >
    {searchFilter ? (
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
