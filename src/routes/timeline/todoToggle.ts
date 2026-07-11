export const TODO_LINE_REGEX = /^(\s*-\s+)(\[[ xX]\])(.*)$/
const TODO_TOGGLE_REGEX = /^(\s*-\s+\[)([ xX])(\].*)$/

export const toggleTodoLineMarker = (line: string) => {
  const match = line.match(TODO_TOGGLE_REGEX)
  if (!match) {
    return null
  }

  const toggledValue = match[2].toLocaleLowerCase() === 'x' ? ' ' : 'x'
  return `${match[1]}${toggledValue}${match[3]}`
}
