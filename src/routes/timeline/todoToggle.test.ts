import { describe, expect, it } from 'vitest'
import { toggleTodoLineMarker } from './todoToggle'

describe('toggleTodoLineMarker', () => {
  it.each([
    ['unchecked to checked', '- [ ] buy milk', '- [x] buy milk'],
    ['checked to unchecked', '- [x] buy milk', '- [ ] buy milk'],
    ['uppercase X to unchecked', '- [X] buy milk', '- [ ] buy milk'],
    ['indented unchecked', '  - [ ] nested task', '  - [x] nested task'],
    ['tab-indented unchecked', '\t- [ ] nested task', '\t- [x] nested task'],
    ['preserves trailing markdown', '- [ ] call *mom* @today', '- [x] call *mom* @today'],
    ['empty todo text', '- [ ] ', '- [x] '],
  ])('%s', (_label, input, expected) => {
    expect(toggleTodoLineMarker(input)).toBe(expected)
  })

  it.each([
    ['plain text', 'just a note'],
    ['plain list item without brackets', '- an item'],
    ['heading line', '# Heading'],
    ['malformed brackets', '- [?] buy milk'],
    ['empty string', ''],
  ])('returns null for non-todo lines: %s', (_label, input) => {
    expect(toggleTodoLineMarker(input)).toBeNull()
  })

  it('round-trips back to the original line when toggled twice', () => {
    const original = '- [ ] buy milk'
    const toggledOnce = toggleTodoLineMarker(original)
    expect(toggledOnce).not.toBeNull()
    const toggledTwice = toggleTodoLineMarker(toggledOnce as string)
    expect(toggledTwice).toBe(original)
  })
})
