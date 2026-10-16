import { describe, expect, it } from 'vitest'
import { NON_TODO_LINE_CASES, TODO_TOGGLE_CASES } from '../../lib/editor/todoMarker.fixtures'
import { toggleTodoLineMarker } from './todoToggle'

describe('toggleTodoLineMarker', () => {
  it.each(TODO_TOGGLE_CASES)('%s', (_label, input, expected) => {
    expect(toggleTodoLineMarker(input)).toBe(expected)
  })

  it.each(NON_TODO_LINE_CASES)('returns null for non-todo lines: %s', (_label, input) => {
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

describe('cancelled todo markers', () => {
  it('cancels open and completed tasks and reopens cancelled tasks', () => {
    expect(toggleTodoLineMarker('  - [ ] buy *milk* #errands', 'cancel')).toBe('  - [-] buy *milk* #errands')
    expect(toggleTodoLineMarker('- [X] buy milk', 'cancel')).toBe('- [-] buy milk')
    expect(toggleTodoLineMarker('- [-] buy milk', 'cancel')).toBe('- [ ] buy milk')
    expect(toggleTodoLineMarker('- [-] buy milk')).toBe('- [x] buy milk')
  })

  it('cycles twice through open, completed, and cancelled without changing the text', () => {
    let line = '- [ ] buy ~~milk~~ @today'
    for (const marker of ['x', '-', ' ', 'x', '-', ' ']) {
      line = toggleTodoLineMarker(line, 'cycle')!
      expect(line).toBe(`- [${marker}] buy ~~milk~~ @today`)
    }
  })
})
