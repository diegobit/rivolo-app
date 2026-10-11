import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { todoKeymap, todoPointerHandler } from './todoExtensions'
import { editorHighlights } from '../editorHighlights'

describe('todo mouse, touch, and keyboard interactions', () => {
  let view: EditorView
  afterEach(() => { view?.destroy(); vi.restoreAllMocks() })

  const setup = (doc = '- [ ] buy milk') => {
    view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [editorHighlights, todoPointerHandler, todoKeymap] }) })
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

  it.each([
    ['left bracket', 2, true],
    ['state character', 3, true],
    ['right bracket', 4, true],
    ['before marker', 1, false],
    ['after marker', 5, false],
  ])('changes a todo only when the mouse reaches its marker: %s', (_label, position, toggles) => {
    setup()
    vi.mocked(view.posAtCoords).mockReturnValue(position)
    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true })

    view.contentDOM.dispatchEvent(event)

    expect(view.state.doc.toString()).toBe(toggles ? '- [x] buy milk' : '- [ ] buy milk')
    // CodeMirror can also consume outside clicks to move its selection.
    if (toggles) expect(event.defaultPrevented).toBe(true)
  })

  it('uses the decorated marker target to change only its own line', () => {
    setup('Una #novità\n  - [X] buy *milk* #errands\n- [ ] leave this task')
    // Hit testing normally needs layout. A rendered marker instead provides a
    // DOM position through CodeMirror's public posAtDOM interface.
    vi.mocked(view.posAtCoords).mockReturnValue(null)
    const marker = view.contentDOM.querySelector('.cm-todo-marker')!

    marker.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }))

    expect(view.state.doc.toString()).toBe('Una #novità\n  - [ ] buy *milk* #errands\n- [ ] leave this task')
    expect(view.hasFocus).toBe(true)
  })

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
