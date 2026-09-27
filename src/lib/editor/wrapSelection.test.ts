import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { wrapSelectionOnDelimiter } from './wrapSelection'

const createView = (doc: string, anchor: number, head: number) =>
  new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.range(anchor, head),
      extensions: [wrapSelectionOnDelimiter],
    }),
  })

const type = (view: EditorView, text: string, from = view.state.selection.main.from, to = view.state.selection.main.to) =>
  view.state.facet(EditorView.inputHandler)[0](view, from, to, text, () =>
    view.state.update({ changes: { from, to, insert: text } }),
  )

describe('wrapSelectionOnDelimiter', () => {
  it.each([
    ['*', '*word*'],
    ['_', '_word_'],
    ['~', '~word~'],
    ["'", "'word'"],
    ['"', '"word"'],
    ['`', '`word`'],
    ['(', '(word)'],
    ['[', '[word]'],
    ['{', '{word}'],
  ])('wraps a selection with %s', (delimiter, expected) => {
    const view = createView('a word here', 2, 6)

    expect(type(view, delimiter)).toBe(true)
    expect(view.state.doc.toString()).toBe(`a ${expected} here`)
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('word')
    view.destroy()
  })

  it('preserves selection direction and supports repeated delimiters', () => {
    const view = createView('word', 4, 0)

    expect(type(view, '*')).toBe(true)
    expect(type(view, '*')).toBe(true)
    expect(view.state.doc.toString()).toBe('**word**')
    expect(view.state.selection.main.anchor).toBe(6)
    expect(view.state.selection.main.head).toBe(2)
    view.destroy()
  })

  it('leaves ordinary typing, empty selections, and unrelated edits to CodeMirror', () => {
    const view = createView('word', 0, 4)

    expect(type(view, 'x')).toBe(false)
    expect(type(view, '*', 1, 3)).toBe(false)
    expect(view.state.doc.toString()).toBe('word')
    view.dispatch({ selection: EditorSelection.cursor(2) })
    expect(type(view, '*')).toBe(false)
    view.destroy()
  })
})
