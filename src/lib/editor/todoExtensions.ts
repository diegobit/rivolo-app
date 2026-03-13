import { EditorSelection, Prec, type Line } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

const TODO_MARKER_REGEX = /^(\s*-\s+\[)([ xX])(\])/
const LIST_MARKER_REGEX = /^(\s*)(?:[-+*]|\d+[.)])\s+(.*)$/

const getTodoMarker = (line: Line) => {
  const match = line.text.match(TODO_MARKER_REGEX)
  if (!match) return null
  const markerStartOffset = match.index ?? 0
  const markerFrom = line.from + markerStartOffset
  const markerTo = markerFrom + match[0].length
  const bracketFrom = line.from + match[1].length - 1
  const bracketTo = markerTo
  const toggleFrom = line.from + match[1].length
  return {
    markerFrom,
    markerTo,
    bracketFrom,
    bracketTo,
    toggleFrom,
    toggleTo: toggleFrom + 1,
    value: match[2],
  }
}

const getToggleValue = (value: string) => (value.toLowerCase() === 'x' ? ' ' : 'x')

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

const toggleTodoAtPos = (view: EditorView, pos: number) => {
  const line = view.state.doc.lineAt(pos)
  const marker = getTodoMarker(line)
  if (!marker) return false
  if (pos < marker.bracketFrom || pos >= marker.bracketTo) return false
  view.dispatch({
    changes: {
      from: marker.toggleFrom,
      to: marker.toggleTo,
      insert: getToggleValue(marker.value),
    },
  })
  return true
}

const toggleOrCreateTodosInSelection = (view: EditorView) => {
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
          insert: getToggleValue(marker.value),
        })
        continue
      }

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

export const todoPointerHandler = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    if (event.button !== 0) return false
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos == null) return false
    if (!toggleTodoAtPos(view, pos)) return false
    view.focus()
    return true
  },
  touchstart: (event, view) => {
    const touch = event.touches.item(0)
    if (!touch) return false
    const pos = view.posAtCoords({ x: touch.clientX, y: touch.clientY })
    if (pos == null) return false
    if (!toggleTodoAtPos(view, pos)) return false
    event.preventDefault()
    return true
  },
})

export const todoKeymap = Prec.high(
  keymap.of([
    {
      key: 'Mod-Enter',
      run: (view) => toggleOrCreateTodosInSelection(view),
    },
  ]),
)
