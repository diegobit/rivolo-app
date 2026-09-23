import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

const delimiters: Record<string, string> = {
  '*': '*',
  _: '_',
  '~': '~',
  "'": "'",
  '"': '"',
  '`': '`',
  '(': ')',
  '[': ']',
  '{': '}',
}

export const wrapSelectionOnDelimiter = EditorView.inputHandler.of((view, from, to, text) => {
  const closing = delimiters[text]
  const selection = view.state.selection.main
  if (
    !closing ||
    view.composing ||
    view.state.selection.ranges.length !== 1 ||
    selection.empty ||
    from !== selection.from ||
    to !== selection.to
  ) {
    return false
  }

  view.dispatch({
    changes: {
      from,
      to,
      insert: `${text}${view.state.sliceDoc(from, to)}${closing}`,
    },
    selection: EditorSelection.range(selection.anchor + text.length, selection.head + text.length),
    scrollIntoView: true,
    userEvent: 'input.type',
  })
  return true
})
