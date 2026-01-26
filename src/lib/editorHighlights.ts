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
  const ranges: Array<{ from: number; to: number; className: string }> = []
  const tagRegex = /(^|[^A-Za-z0-9_])([#@][A-Za-z0-9_/-]+)/g
  let match = tagRegex.exec(text)

  while (match) {
    const prefixLength = match[1].length
    const token = match[2]
    const start = match.index + prefixLength
    const end = start + token.length
    const className = token.startsWith('#') ? 'cm-hashtag' : 'cm-mention'
    ranges.push({ from: start, to: end, className })
    match = tagRegex.exec(text)
  }

  const todoRegex = /(^|\n)(\s*- \[[ xX]\])/g
  match = todoRegex.exec(text)

  while (match) {
    const prefixLength = match[1].length
    const token = match[2]
    const start = match.index + prefixLength
    const bracketMatch = token.match(/\[[ xX]\]/)
    if (bracketMatch) {
      const bracketStart = start + (bracketMatch.index ?? 0)
      const bracketEnd = bracketStart + bracketMatch[0].length
      ranges.push({ from: bracketStart, to: bracketEnd, className: 'cm-todo-marker' })
    }
    match = todoRegex.exec(text)
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to)

  const builder = new RangeSetBuilder<Decoration>()
  for (const range of ranges) {
    builder.add(range.from, range.to, Decoration.mark({ class: range.className }))
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
