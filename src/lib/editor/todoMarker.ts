const TODO_MARKER_REGEX = /^(\s*-\s+\[)([ xX-])(\].*)$/

export type TodoAction = 'complete' | 'cancel' | 'cycle'
export type TodoMarkerMatch = {
  prefix: string
  value: string
  suffix: string
}

export const matchTodoMarker = (line: string): TodoMarkerMatch | null => {
  const match = line.match(TODO_MARKER_REGEX)
  if (!match) return null
  return { prefix: match[1], value: match[2], suffix: match[3] }
}

export const getToggledValue = (value: string, action: TodoAction = 'complete') => {
  if (action === 'cancel') return value === '-' ? ' ' : '-'
  if (action === 'cycle') return value === '-' ? ' ' : value.toLowerCase() === 'x' ? '-' : 'x'
  return value.toLowerCase() === 'x' ? ' ' : 'x'
}

export const todoStateLabel = (value: string) =>
  value === '-' ? 'Cancelled' : value.toLowerCase() === 'x' ? 'Completed' : 'Open'

export const TODO_INTERACTION_HINT =
  'Click to complete or reopen; right-click to cancel or reopen. Touch: open → completed → cancelled → open.'

export const toggleTodoLineMarker = (line: string, action: TodoAction = 'complete') => {
  const match = matchTodoMarker(line)
  if (!match) return null
  return `${match.prefix}${getToggledValue(match.value, action)}${match.suffix}`
}
