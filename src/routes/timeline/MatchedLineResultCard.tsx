import { memo } from 'react'
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
  sourceLineIndex: number | null
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
  enableTodoToggle: boolean
  todayId: string
  contentTextStyle: React.CSSProperties
  searchQuery: string
  onOpen: (dayId: string, quote: string) => void
  onToggleTodo: (dayId: string, blockIndex: number, sourceLineIndex: number) => void
}) => {
  const dayLabel = getMatchedResultDayLabel(day.dayId, todayId)

  return (
    <section className="scroll-anchor relative rounded-[4px] border border-slate-200/60 bg-white px-3 py-2.5 pr-14 shadow-[0_6px_6px_-4px_rgba(0,0,0,0.10),0_2px_12px_rgba(0,0,0,0.06)] transition hover:border-slate-300/60">
      <button
        className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-700 sm:h-9 sm:w-9"
        type="button"
        aria-label={`Open note for ${dayLabel}`}
        onClick={() => onOpen(day.dayId, openQuote)}
      >
        <img src="/arrow-square-in.svg" alt="" className="h-5 w-5" />
      </button>
      <div className="mb-1.5">
        <p className="m-0" style={{ ...contentTextStyle, color: 'var(--theme-text-muted)' }}>
          {dayLabel}
        </p>
      </div>
      <div className="space-y-0" style={contentTextStyle}>
        {block.split('\n').map((line, lineIndex) => (
          <p key={`${day.dayId}-${lineIndex}`} className="m-0 whitespace-pre-wrap break-words px-[2px] pl-[6px] text-[var(--theme-editor-text)]">
            {line
              ? renderSyntaxLine(
                  line,
                  searchQuery,
                  `${day.dayId}-${lineIndex}`,
                  enableTodoToggle && sourceLineIndex !== null && lineIndex === 0
                    ? {
                        onToggleTodo: () => {
                          onToggleTodo(day.dayId, blockIndex, sourceLineIndex)
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
