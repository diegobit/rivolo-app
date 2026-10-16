import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NON_TODO_LINE_CASES, TODO_TOGGLE_CASES } from './todoMarker.fixtures'
import { todoKeymap, todoPointerHandler, toggleTodoAtPos } from './todoExtensions'
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

describe('todo mouse, touch, and keyboard interactions', () => {
  let view: EditorView
  afterEach(() => { view?.destroy(); vi.restoreAllMocks() })

  const setup = (doc = '- [ ] buy milk') => {
    view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [todoPointerHandler, todoKeymap] }) })
    vi.spyOn(view, 'posAtCoords').mockReturnValue(3)
    return view
  }
  const touch = (type: string, x = 10, y = 10, count = 1) => {
    const point = { clientX: x, clientY: y }
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      touches: { value: { length: type === 'touchend' ? 0 : count, item: () => point } },
      changedTouches: { value: { length: 1, item: () => point } },
    })
    view.contentDOM.dispatchEvent(event)
  }

  it('keeps desktop completion binary and toggles cancellation on right-click', () => {
    setup()
    for (const expected of ['x', ' ']) {
      view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }))
      expect(view.state.doc.toString()).toBe(`- [${expected}] buy milk`)
    }
    for (const expected of ['-', ' ']) {
      const event = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true })
      view.contentDOM.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(view.state.doc.toString()).toBe(`- [${expected}] buy milk`)
    }
  })

  it('cycles on touch release and suppresses the synthetic mouse activation', () => {
    setup()
    for (const expected of ['x', '-', ' ', 'x', '-', ' ']) {
      touch('touchstart')
      touch('touchend')
      view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
      expect(view.state.doc.toString()).toBe(`- [${expected}] buy milk`)
    }
  })

  it('leaves tasks alone during scrolling, multi-touch, and cancelled gestures', () => {
    setup()
    touch('touchstart'); touch('touchmove', 10, 50); touch('touchend', 10, 50)
    touch('touchstart'); touch('touchcancel'); touch('touchend')
    touch('touchstart', 10, 10, 2); touch('touchend')
    expect(view.state.doc.toString()).toBe('- [ ] buy milk')
  })

  it('preserves the native menu on a touch long-press without cycling on release', () => {
    setup()
    touch('touchstart')
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    view.contentDOM.dispatchEvent(event)
    touch('touchend')
    expect(event.defaultPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe('- [ ] buy milk')
  })

  it('does not intercept the context menu or change text outside a marker', () => {
    setup()
    vi.mocked(view.posAtCoords).mockReturnValue(8)
    const event = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true })
    view.contentDOM.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe('- [ ] buy milk')
  })

  it('cancels selected todos with the keyboard without converting plain text', () => {
    setup('- [ ] buy *milk*\nplain note\n- [X] report\n- [-] old task')
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true }), 'editor')).toBe(true)
    expect(view.state.doc.toString()).toBe('- [-] buy *milk*\nplain note\n- [-] report\n- [ ] old task')
  })
})
