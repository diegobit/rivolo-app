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

export type InteractedTodo = { dayId: string; sourceLineIndex: number }

// A completion can stop matching the open-todos filter. Keep the last task
// changed through a result control so a second tap can cancel or reopen it.
export const keepInteractedTodoInResults = (
  next: DaySearchResult[],
  previous: DaySearchResult[],
  interacted: InteractedTodo | null,
) => {
  if (!interacted) return next
  const kept = previous.find((result) => result.day.dayId === interacted.dayId && result.blockKind === 'line')
  const line = kept?.day.contentMd.split('\n')[interacted.sourceLineIndex]?.trimEnd()
  if (!kept || line === undefined || !kept.matchedBlocks.includes(line)) return next
  const existing = next.find((result) => result.day.dayId === interacted.dayId)
  if (existing?.matchedBlocks.includes(line)) return next
  if (existing) {
    return next.map((result) => result === existing
      ? { ...result, day: kept.day, matchedBlocks: [...result.matchedBlocks, line] }
      : result)
  }
  const retained = { ...kept, matchedBlocks: [line] }
  const index = next.findIndex((result) => result.day.dayId < interacted.dayId)
  return index === -1 ? [...next, retained] : [...next.slice(0, index), retained, ...next.slice(index)]
}
