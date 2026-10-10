import { memo, useId, type ComponentProps } from 'react'
import type { TodoAction } from '../../lib/editor/todoMarker'
import type { Day } from '../../lib/dayRepository'
import { addDays, formatHumanDate, parseDayId } from '../../lib/dates'
import { renderSyntaxLine } from './syntaxHighlight'

export type MatchedLineResultItem = {
  key: string
  day: Day
  block: string
  openQuote: string
  hasMore: boolean
  blockIndex: number
  // The line holding a todo marker, for toggling it; null for sections.
  sourceLineIndex: number | null
  // The line to open at, so repeated identical matches open where they are.
  openLineIndex: number | null
}

const getMatchedResultDayLabel = (dayId: string, todayId: string) => {
  const dayDate = parseDayId(dayId)
  const todayDate = parseDayId(todayId)
  const diffDays = Math.round((dayDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))
  const showWeekday = Math.abs(diffDays) <= 6
  const humanDate = formatHumanDate(dayId, todayId, {
    includeRelativeLabel: false,
    includeWeekday: showWeekday,
  })
  const isToday = dayId === todayId
  const isYesterday = dayId === addDays(todayId, -1)
  const isTomorrow = dayId === addDays(todayId, 1)
  const relativeLabel = isToday ? 'Today' : isYesterday ? 'Yesterday' : isTomorrow ? 'Tomorrow' : null

  if (relativeLabel) {
    return `${relativeLabel}, ${humanDate}`
  }

  return humanDate
}

const MatchedLineResultCard = memo(({
  day,
  block,
  openQuote,
  hasMore,
  blockIndex,
  sourceLineIndex,
  openLineIndex,
  enableTodoToggle,
  todayId,
  contentTextStyle,
  searchQuery,
  onOpen,
  onToggleTodo,
}: {
  day: Day
  block: string
  openQuote: string
  hasMore: boolean
  blockIndex: number
  sourceLineIndex: number | null
  openLineIndex: number | null
  enableTodoToggle: boolean
  todayId: string
  contentTextStyle: React.CSSProperties
  searchQuery: string
  onOpen: (dayId: string, quote: string, lineIndex?: number) => void
  onToggleTodo: (dayId: string, blockIndex: number, sourceLineIndex: number, action?: TodoAction) => void
}) => {
  const dayLabel = getMatchedResultDayLabel(day.dayId, todayId)
  // Several matches can share a day, so each Open button is described by its
  // own snippet to tell them apart.
  const snippetId = useId()

  return (
    <section
      className="matched-result-row relative cursor-pointer px-3 py-3 pr-16 transition-colors hover:bg-[var(--theme-hover)]"
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('button[aria-label="Toggle todo"]')) return
        // A click that ends a text selection is the user copying, not opening.
        if (window.getSelection()?.toString()) return
        onOpen(day.dayId, openQuote, openLineIndex ?? undefined)
      }}
    >
      <button
        className="result-open-button absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-700 sm:h-9 sm:w-9"
        type="button"
        aria-label={`Open note for ${dayLabel}`}
        aria-describedby={snippetId}
        onClick={(event) => {
          event.stopPropagation()
          onOpen(day.dayId, openQuote, openLineIndex ?? undefined)
        }}
      >
        <img src="/arrow-square-in.svg" alt="" className="h-5 w-5" />
      </button>
      <div id={snippetId} className="space-y-0" style={contentTextStyle}>
        {block.split('\n').map((line, lineIndex) => (
          <p key={`${day.dayId}-${lineIndex}`} className="m-0 whitespace-pre-wrap break-words px-[2px] pl-[6px] text-[var(--theme-editor-text)]">
            {line
              ? renderSyntaxLine(
                  line,
                  searchQuery,
                  `${day.dayId}-${lineIndex}`,
                  enableTodoToggle && sourceLineIndex !== null && lineIndex === 0
                    ? {
                        onToggleTodo: (action) => {
                          onToggleTodo(day.dayId, blockIndex, sourceLineIndex, action)
                        },
                      }
                    : undefined,
                )
              : <span>&nbsp;</span>}
          </p>
        ))}
        {hasMore && <p className="m-0 px-[2px] pl-[6px] text-slate-400">...</p>}
      </div>
    </section>
  )
})

export default MatchedLineResultCard

export function MatchedLineResultList({
  items,
  ...sharedProps
}: {
  items: MatchedLineResultItem[]
} & Pick<ComponentProps<typeof MatchedLineResultCard>,
  'enableTodoToggle' | 'todayId' | 'contentTextStyle' | 'searchQuery' | 'onOpen' | 'onToggleTodo'>) {
  const groups = new Map<string, MatchedLineResultItem[]>()
  for (const item of items) {
    const group = groups.get(item.day.dayId)
    if (group) group.push(item)
    else groups.set(item.day.dayId, [item])
  }

  return Array.from(groups, ([dayId, matches]) => (
    <section key={dayId} className="matched-result-group scroll-anchor">
      <p className="m-0 px-3 pt-3 pb-1" style={{ ...sharedProps.contentTextStyle, color: 'var(--theme-text-muted)' }}>
        {getMatchedResultDayLabel(dayId, sharedProps.todayId)}
      </p>
      {matches.map(({ key, ...item }) => (
        <MatchedLineResultCard key={key} {...item} {...sharedProps} />
      ))}
    </section>
  ))
}
