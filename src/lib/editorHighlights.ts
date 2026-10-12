import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { TODO_INTERACTION_HINT, todoStateLabel } from './editor/todoMarker'
import { tags } from '@lezer/highlight'
import { Decoration, EditorView, ViewPlugin, ViewUpdate, type DecorationSet } from '@codemirror/view'
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'

const highlightStyle = HighlightStyle.define([
  {
    tag: tags.heading,
    textDecoration: 'none',
    color: '#368b1c',
    fontWeight: '900',
  },
  {
    tag: tags.strong,
    fontWeight: '700',
  },
  {
    tag: tags.emphasis,
    fontStyle: 'italic',
  },
  {
    tag: tags.quote,
    fontStyle: 'italic',
  },
  {
    tag: tags.strikethrough,
    color: 'var(--theme-text-muted)',
    textDecoration: 'line-through',
  },
])

export const findTagHighlightRanges = (text: string) => {
  const ranges: Array<{ from: number; to: number; className: string; title?: string }> = []
  const tagRegex = /(^|[^\p{L}\p{M}\p{N}_])([#@][\p{L}\p{M}\p{N}_/-]+)/gu
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

  return ranges
}

const listLineDecoration = Decoration.line({ class: 'cm-list-line' })

const buildTagDecorations = (text: string) => {
  const ranges = findTagHighlightRanges(text)
  const lineStarts = new Set<number>()

  const todoRegex = /(^|\n)([ \t]*-\s+\[[ xX-]\])([^\n]*)/g
  let match = todoRegex.exec(text)

  while (match) {
    const prefixLength = match[1].length
    const token = match[2]
    const start = match.index + prefixLength
    const bracketMatch = token.match(/\[[ xX-]\]/)
    if (bracketMatch) {
      const bracketStart = start + (bracketMatch.index ?? 0)
      const bracketEnd = bracketStart + bracketMatch[0].length
      ranges.push({ from: bracketStart, to: bracketEnd, className: 'cm-todo-marker', title: `${todoStateLabel(bracketMatch[0][1])}. ${TODO_INTERACTION_HINT}` })
      if (bracketMatch[0] === '[-]' && match[3].length) {
        ranges.push({ from: start + token.length, to: start + token.length + match[3].length, className: 'cm-todo-cancelled' })
      }
    }
    match = todoRegex.exec(text)
  }

  const listRegex = /(^|\n)(\s*(?:[-+*]|\d+[.)]))(?=\s+)/g
  match = listRegex.exec(text)

  while (match) {
    const prefixLength = match[1].length
    const token = match[2]
    const start = match.index + prefixLength
    const end = start + token.length
    ranges.push({ from: start, to: end, className: 'cm-list-marker' })
    lineStarts.add(text.lastIndexOf('\n', end - 1) + 1)
    match = listRegex.exec(text)
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to)

  const builder = new RangeSetBuilder<Decoration>()
  let rangeIndex = 0
  for (const lineStart of [...lineStarts].sort((a, b) => a - b)) {
    for (; rangeIndex < ranges.length && ranges[rangeIndex].from < lineStart; rangeIndex++) {
      addMark(builder, ranges[rangeIndex])
    }
    // Line decorations sort before marks that start at the same position.
    builder.add(lineStart, lineStart, listLineDecoration)
  }
  for (; rangeIndex < ranges.length; rangeIndex++) addMark(builder, ranges[rangeIndex])

  return builder.finish()
}

const addMark = (
  builder: RangeSetBuilder<Decoration>,
  range: { from: number; to: number; className: string; title?: string },
) => {
  builder.add(range.from, range.to, Decoration.mark({ class: range.className, attributes: range.title ? { title: range.title } : undefined }))
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

const headingLineDecoration = Decoration.line({ class: 'cm-heading-line' })

// Read headings from the markdown tree so a `#` inside a code block doesn't count.
const buildHeadingLineDecorations = (state: EditorState) => {
  const builder = new RangeSetBuilder<Decoration>()
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name.startsWith('ATXHeading')) {
        const lineStart = state.doc.lineAt(node.from).from
        builder.add(lineStart, lineStart, headingLineDecoration)
      }
      return node.name === 'Document'
    },
  })
  return builder.finish()
}

const headingLinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildHeadingLineDecorations(view.state)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = buildHeadingLineDecorations(update.state)
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)

// Give list and todo rows a little air: 4px between two list rows, 8px
// between a list and plain text. Headings sit 12px below what precedes them
// and 4px above what follows. This lives in an editor theme because
// CodeMirror's own .cm-line padding beats layered CSS.
const lineSpacingTheme = EditorView.theme({
  '.cm-line.cm-list-line': {
    paddingTop: '2px',
    paddingBottom: '2px',
  },
  '.cm-line:not(.cm-list-line):not(.cm-heading-line) + .cm-line.cm-list-line': {
    paddingTop: '8px',
  },
  '.cm-line.cm-list-line + .cm-line:not(.cm-list-line):not(.cm-heading-line)': {
    paddingTop: '6px',
  },
  '.cm-line.cm-heading-line': {
    paddingBottom: '4px',
  },
  '.cm-line + .cm-line.cm-heading-line': {
    paddingTop: '12px',
  },
  '.cm-line.cm-list-line + .cm-line.cm-heading-line': {
    paddingTop: '10px',
  },
  '.cm-line.cm-heading-line + .cm-line.cm-list-line': {
    paddingTop: '0',
  },
})

export const editorHighlights: Extension[] = [syntaxHighlighting(highlightStyle), tagHighlightPlugin, headingLinePlugin, lineSpacingTheme]
