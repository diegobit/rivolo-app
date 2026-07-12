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
