import { EditorSelection, Prec, type Line } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { getToggledValue, matchTodoMarker, type TodoAction } from './todoMarker'

const LIST_MARKER_REGEX = /^(\s*)(?:[-+*]|\d+[.)])\s+(.*)$/

const getTodoMarker = (line: Line) => {
  const match = matchTodoMarker(line.text)
  if (!match) return null
  const bracketFrom = line.from + match.prefix.length - 1
  const bracketTo = bracketFrom + 3
  const toggleFrom = line.from + match.prefix.length
  return {
    bracketFrom,
    bracketTo,
    toggleFrom,
    toggleTo: toggleFrom + 1,
    value: match.value,
  }
}

const createTodoLine = (lineText: string) => {
  const listMatch = lineText.match(LIST_MARKER_REGEX)
  if (listMatch) {
    const content = listMatch[2].trimEnd()
    return content ? `${listMatch[1]}- [ ] ${content}` : `${listMatch[1]}- [ ] `
  }

  const indentation = lineText.match(/^\s*/)?.[0] ?? ''
  const content = lineText.slice(indentation.length).trimEnd()
  return content ? `${indentation}- [ ] ${content}` : `${indentation}- [ ] `
}

export const toggleTodoAtPos = (view: EditorView, pos: number, action: TodoAction = 'complete') => {
  const line = view.state.doc.lineAt(pos)
  const marker = getTodoMarker(line)
  if (!marker) return false
  if (pos < marker.bracketFrom || pos >= marker.bracketTo) return false
  view.dispatch({
    changes: {
      from: marker.toggleFrom,
      to: marker.toggleTo,
      insert: getToggledValue(marker.value, action),
    },
  })
  return true
}

const toggleOrCreateTodosInSelection = (view: EditorView, action: TodoAction = 'complete') => {
  const changes: Array<{ from: number; to: number; insert: string }> = []
  const seenLines = new Set<number>()
  const shouldMoveCursorToEnd =
    view.state.selection.ranges.length === 1 && view.state.selection.main.empty
  let nextCursorPos: number | null = null

  for (const range of view.state.selection.ranges) {
    const startLine = view.state.doc.lineAt(range.from)
    const endLine = view.state.doc.lineAt(range.to)

    for (let number = startLine.number; number <= endLine.number; number += 1) {
      const line = view.state.doc.line(number)

      const isCursor = range.from === range.to
      if (!isCursor) {
        const lineIntersects = range.from < line.to && range.to > line.from
        if (!lineIntersects) continue
      }

      if (seenLines.has(line.number)) continue
      seenLines.add(line.number)

      const marker = getTodoMarker(line)
      if (marker) {
        changes.push({
          from: marker.toggleFrom,
          to: marker.toggleTo,
          insert: getToggledValue(marker.value, action),
        })
        continue
      }

      if (action === 'cancel') continue
      const todoLineText = createTodoLine(line.text)
      changes.push({
        from: line.from,
        to: line.to,
        insert: todoLineText,
      })

      if (shouldMoveCursorToEnd) {
        nextCursorPos = line.from + todoLineText.length
      }
    }
  }

  if (!changes.length) return false
  changes.sort((a, b) => a.from - b.from)

  if (nextCursorPos == null) {
    view.dispatch({ changes })
    return true
  }

  view.dispatch({
    changes,
    selection: EditorSelection.cursor(nextCursorPos),
    scrollIntoView: true,
  })
  return true
}

const getPointerPos = (view: EditorView, x: number, y: number, target: EventTarget | null) => {
  const element = target instanceof Element ? target.closest('.cm-todo-marker') : null
  if (element && view.contentDOM.contains(element)) {
    return view.posAtDOM(element)
  }
  return view.posAtCoords({ x, y })
}

// Track taps separately from scrolling and suppress the synthetic mouse event
// after a touch activation. State belongs to each editor, including on hybrids.
const touches = new WeakMap<EditorView, { pos: number; x: number; y: number }>()
const lastTouchActivation = new WeakMap<EditorView, { time: number; pos: number }>()

export const todoPointerHandler = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    if (event.button !== 0 || event.ctrlKey) return false
    const pos = getPointerPos(view, event.clientX, event.clientY, event.target)
    if (pos == null) return false
    const lastTouch = lastTouchActivation.get(view)
    if (lastTouch?.pos === pos && Date.now() - lastTouch.time < 700) {
      event.preventDefault()
      return true
    }
    if (!toggleTodoAtPos(view, pos, 'complete')) return false
    event.preventDefault()
    view.focus()
    return true
  },
  contextmenu: (event, view) => {
    // Preserve the native text menu on a touch long-press.
    if (touches.has(view)) {
      touches.delete(view)
      return false
    }
    const pos = getPointerPos(view, event.clientX, event.clientY, event.target)
    if (pos == null || !toggleTodoAtPos(view, pos, 'cancel')) return false
    event.preventDefault()
    view.focus()
    return true
  },
  touchstart: (event, view) => {
    touches.delete(view)
    if (event.touches.length !== 1) return false
    const touch = event.touches.item(0)
    if (!touch) return false
    const pos = getPointerPos(view, touch.clientX, touch.clientY, event.target)
    if (pos == null) return false
    const marker = getTodoMarker(view.state.doc.lineAt(pos))
    if (!marker || pos < marker.bracketFrom || pos >= marker.bracketTo) return false
    touches.set(view, { pos, x: touch.clientX, y: touch.clientY })
    return false
  },
  touchmove: (event, view) => {
    const start = touches.get(view)
    const touch = event.touches.item(0)
    if (start && (!touch || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10)) {
      touches.delete(view)
    }
    return false
  },
  touchcancel: (_event, view) => {
    touches.delete(view)
    return false
  },
  touchend: (event, view) => {
    const start = touches.get(view)
    touches.delete(view)
    const touch = event.changedTouches.item(0)
    if (!start || !touch || event.touches.length ||
      Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) return false
    if (!toggleTodoAtPos(view, start.pos, 'cycle')) return false
    lastTouchActivation.set(view, { time: Date.now(), pos: start.pos })
    event.preventDefault()
    return true
  },
})

export const todoKeymap = Prec.high(
  keymap.of([
    {
      key: 'Mod-Shift-Enter',
      run: (view) => toggleOrCreateTodosInSelection(view, 'cancel'),
    },
    {
      key: 'Mod-Enter',
      run: (view) => toggleOrCreateTodosInSelection(view),
    },
  ]),
)
