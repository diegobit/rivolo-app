import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { Decoration, EditorView, ViewPlugin, ViewUpdate, type DecorationSet } from '@codemirror/view'
import { RangeSetBuilder, type Extension } from '@codemirror/state'

const highlightStyle = HighlightStyle.define([
  {
    tag: tags.heading,
    textDecoration: 'none',
    color: '#368b1c',
    fontWeight: '900',
  },
])

const buildTagDecorations = (text: string) => {
  const builder = new RangeSetBuilder<Decoration>()
  const tagRegex = /(^|[^A-Za-z0-9_])([#@][A-Za-z0-9_/-]+)/g
  let match = tagRegex.exec(text)

  while (match) {
    const prefixLength = match[1].length
    const token = match[2]
    const start = match.index + prefixLength
    const end = start + token.length
    const className = token.startsWith('#') ? 'cm-hashtag' : 'cm-mention'
    builder.add(start, end, Decoration.mark({ class: className }))
    match = tagRegex.exec(text)
  }

  const todoRegex = /(^|\n)(\s*- \[ \])/g
  match = todoRegex.exec(text)

  while (match) {
    const prefixLength = match[1].length
    const token = match[2]
    const start = match.index + prefixLength
    const end = start + token.length
    builder.add(start, end, Decoration.mark({ class: 'cm-todo-marker' }))
    match = todoRegex.exec(text)
  }

  return builder.finish()
}

const tagHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildTagDecorations(view.state.doc.toString())
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildTagDecorations(update.state.doc.toString())
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)

export const editorHighlights: Extension[] = [syntaxHighlighting(highlightStyle), tagHighlightPlugin]
