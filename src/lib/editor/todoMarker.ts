const TODO_MARKER_REGEX = /^(\s*-\s+\[)([ xX])(\].*)$/

export type TodoMarkerMatch = {
  prefix: string
  value: string
  suffix: string
}

export const matchTodoMarker = (line: string): TodoMarkerMatch | null => {
  const match = line.match(TODO_MARKER_REGEX)
  if (!match) {
    return null
  }

  return { prefix: match[1], value: match[2], suffix: match[3] }
}

export const getToggledValue = (value: string) => (value.toLocaleLowerCase() === 'x' ? ' ' : 'x')

export const toggleTodoLineMarker = (line: string) => {
  const match = matchTodoMarker(line)
  if (!match) {
    return null
  }

  return `${match.prefix}${getToggledValue(match.value)}${match.suffix}`
}
