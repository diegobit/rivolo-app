import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { NON_TODO_LINE_CASES, TODO_TOGGLE_CASES } from './todoMarker.fixtures'
import { toggleTodoAtPos } from './todoExtensions'
import { matchTodoMarker } from './todoMarker'

describe('toggleTodoAtPos (editor click path)', () => {
  it.each(TODO_TOGGLE_CASES)('%s', (_label, input, expected) => {
    const view = new EditorView({ state: EditorState.create({ doc: input }) })
    const match = matchTodoMarker(input)
    const checkboxPos = match ? match.prefix.length : 0

    const handled = toggleTodoAtPos(view, checkboxPos)

    expect(handled).toBe(true)
    expect(view.state.doc.toString()).toBe(expected)
    view.destroy()
  })

  it.each(NON_TODO_LINE_CASES)('does not toggle non-todo lines: %s', (_label, input) => {
    const view = new EditorView({ state: EditorState.create({ doc: input }) })

    const handled = toggleTodoAtPos(view, 0)

    expect(handled).toBe(false)
    expect(view.state.doc.toString()).toBe(input)
    view.destroy()
  })

  it('matches the string-based toggle result for the same input line', () => {
    const input = '  - [ ] nested task'
    const match = matchTodoMarker(input)
    const view = new EditorView({ state: EditorState.create({ doc: input }) })

    toggleTodoAtPos(view, match!.prefix.length)

    expect(view.state.doc.toString()).toBe('  - [x] nested task')
    view.destroy()
  })
})
