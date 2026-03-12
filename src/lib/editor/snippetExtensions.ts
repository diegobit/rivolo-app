import { EditorSelection, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

const TODO_SNIPPET_REGEX = /^(\s*)\/(?:td|todo)$/
const CODE_SNIPPET_REGEX = /^(\s*)\/(?:cd|code)$/

type Snippet = {
  text: string
  cursorOffset: number
}

const applyLineStartSnippet = (
  view: EditorView,
  triggerRegex: RegExp,
  buildSnippet: (indentation: string) => Snippet,
) => {
  if (view.state.selection.ranges.length !== 1) {
    return false
  }

  const selection = view.state.selection.main
  if (!selection.empty) {
    return false
  }

  const line = view.state.doc.lineAt(selection.head)
  const cursorOffset = selection.head - line.from
  const lineBeforeCursor = line.text.slice(0, cursorOffset)
  const lineAfterCursor = line.text.slice(cursorOffset)

  if (lineAfterCursor.trim()) {
    return false
  }

  const triggerMatch = lineBeforeCursor.match(triggerRegex)
  if (!triggerMatch) {
    return false
  }

  const indentation = triggerMatch[1] ?? ''
  const snippet = buildSnippet(indentation)

  view.dispatch({
    changes: {
      from: line.from,
      to: line.to,
      insert: snippet.text,
    },
    selection: EditorSelection.cursor(line.from + snippet.cursorOffset),
    scrollIntoView: true,
    userEvent: 'input.complete',
  })

  return true
}

const expandSnippetAtCursor = (view: EditorView) => {
  if (
    applyLineStartSnippet(view, TODO_SNIPPET_REGEX, (indentation) => {
      const text = `${indentation}- [ ] `
      return {
        text,
        cursorOffset: text.length,
      }
    })
  ) {
    return true
  }

  return applyLineStartSnippet(view, CODE_SNIPPET_REGEX, (indentation) => {
    const openingFence = `${indentation}\`\`\``
    const middleLine = indentation
    const closingFence = `${indentation}\`\`\``
    return {
      text: `${openingFence}\n${middleLine}\n${closingFence}`,
      cursorOffset: `${openingFence}\n${middleLine}`.length,
    }
  })
}

export const snippetKeymap = Prec.high(
  keymap.of([
    {
      key: 'Space',
      run: (view) => expandSnippetAtCursor(view),
    },
    {
      key: 'Enter',
      run: (view) => expandSnippetAtCursor(view),
    },
  ]),
)
