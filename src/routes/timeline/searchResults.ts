import type { DaySearchResult } from '../../lib/dayRepository'

// On mobile the search results are the timeline, so a refresh that drops the
// note being typed in would unmount its editor mid-edit. Keep that day, in date
// order, until editing moves elsewhere or the query changes.
export const keepEditedDayInResults = (
  next: DaySearchResult[],
  previous: DaySearchResult[],
  editedDayId: string | null,
) => {
  if (!editedDayId || next.some((result) => result.day.dayId === editedDayId)) return next
  const kept = previous.find((result) => result.day.dayId === editedDayId)
  if (!kept) return next
  const index = next.findIndex((result) => result.day.dayId < editedDayId)
  return index === -1 ? [...next, kept] : [...next.slice(0, index), kept, ...next.slice(index)]
}
