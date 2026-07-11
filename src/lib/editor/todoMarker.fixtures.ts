export const TODO_TOGGLE_CASES: Array<[label: string, input: string, expected: string]> = [
  ['unchecked to checked', '- [ ] buy milk', '- [x] buy milk'],
  ['checked to unchecked', '- [x] buy milk', '- [ ] buy milk'],
  ['uppercase X to unchecked', '- [X] buy milk', '- [ ] buy milk'],
  ['indented unchecked', '  - [ ] nested task', '  - [x] nested task'],
  ['tab-indented unchecked', '\t- [ ] nested task', '\t- [x] nested task'],
  ['preserves trailing markdown', '- [ ] call *mom* @today', '- [x] call *mom* @today'],
  ['empty todo text', '- [ ] ', '- [x] '],
]

export const NON_TODO_LINE_CASES: Array<[label: string, input: string]> = [
  ['plain text', 'just a note'],
  ['plain list item without brackets', '- an item'],
  ['heading line', '# Heading'],
  ['malformed brackets', '- [?] buy milk'],
  ['empty string', ''],
]
