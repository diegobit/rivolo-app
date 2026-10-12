import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { TODO_INTERACTION_HINT, todoStateLabel } from './editor/todoMarker'
import { tags } from '@lezer/highlight'
import { Decoration, EditorView, ViewPlugin, ViewUpdate, type DecorationSet } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, type EditorState, type Extension } from '@codemirror/state'

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

// A list row's marker and the spaces after it, e.g. "- ", "- [ ] " or "1. ".
const listPrefixRegex = /^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX-]\]\s+)?/

const refreshListIndent = StateEffect.define<null>()

// Hang wrapped list rows under the item's text rather than under its marker.
// Marker widths depend on the font, so they're measured from the layout and
// exposed to the theme below as --list-hang.
const listIndentPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    widths = new Map<string, number>()
    destroyed = false
    view: EditorView

    constructor(view: EditorView) {
      this.view = view
      this.decorations = this.build()
      this.measure()
    }

    update(update: ViewUpdate) {
      const refreshed = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshListIndent)))
      if (update.docChanged || update.viewportChanged || refreshed) {
        this.decorations = this.build()
      }
      if (update.docChanged || update.viewportChanged || update.geometryChanged) {
        this.measure()
      }
    }

    destroy() {
      this.destroyed = true
    }

    visibleListRows() {
      const rows: Array<{ from: number; prefix: string }> = []
      const { doc } = this.view.state
      let lastLine = 0
      for (const range of this.view.visibleRanges) {
        for (let pos = range.from; pos <= range.to; ) {
          const line = doc.lineAt(pos)
          if (line.number > lastLine) {
            lastLine = line.number
            const prefix = listPrefixRegex.exec(line.text)?.[0]
            if (prefix) rows.push({ from: line.from, prefix })
          }
          pos = line.to + 1
        }
      }
      return rows
    }

    build() {
      const builder = new RangeSetBuilder<Decoration>()
      for (const { from, prefix } of this.visibleListRows()) {
        const width = this.widths.get(prefix)
        if (width != null) {
          builder.add(from, from, Decoration.line({ attributes: { style: `--list-hang: ${width}px` } }))
        }
      }
      return builder.finish()
    }

    measure() {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const measured = new Map<string, number>()
          for (const { from, prefix } of this.visibleListRows()) {
            if (measured.has(prefix)) continue
            const start = view.coordsAtPos(from, 1)
            const end = view.coordsAtPos(from + prefix.length, -1)
            if (start && end) measured.set(prefix, Math.round((end.left - start.left) * 10) / 10)
          }
          return measured
        },
        write: (measured, view) => {
          let changed = false
          for (const [prefix, width] of measured) {
            if (this.widths.get(prefix) !== width) {
              this.widths.set(prefix, width)
              changed = true
            }
          }
          // Decorations can't change mid-measure, so apply them in a fresh update.
          if (changed) {
            setTimeout(() => {
              if (!this.destroyed) view.dispatch({ effects: refreshListIndent.of(null) })
            })
          }
        },
      })
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)

// Lists sit 6px in from plain text and 8px away from it vertically. Headings
// drop CodeMirror's 6px line padding to line up with the day title, and sit
// 12px below what precedes them and 4px above what follows. This lives in an
// editor theme because CodeMirror's own .cm-line padding beats layered CSS.
const lineSpacingTheme = EditorView.theme({
  '.cm-line.cm-list-line': {
    marginLeft: 'calc(6px + var(--list-hang, 0px))',
    textIndent: 'calc(-1 * var(--list-hang, 0px))',
  },
  '.cm-line:not(.cm-list-line):not(.cm-heading-line) + .cm-line.cm-list-line': {
    paddingTop: '8px',
  },
  '.cm-line.cm-list-line + .cm-line:not(.cm-list-line):not(.cm-heading-line)': {
    paddingTop: '8px',
  },
  '.cm-line.cm-heading-line': {
    paddingLeft: '0',
    paddingBottom: '4px',
  },
  '.cm-line + .cm-line.cm-heading-line': {
    paddingTop: '12px',
  },
  // On touch screens, 4px between list rows gives todo markers room to tap.
  '@media (max-width: 640px), (pointer: coarse)': {
    '.cm-line.cm-list-line': {
      paddingTop: '2px',
      paddingBottom: '2px',
    },
    '.cm-line.cm-list-line + .cm-line:not(.cm-list-line):not(.cm-heading-line)': {
      paddingTop: '6px',
    },
    '.cm-line.cm-list-line + .cm-line.cm-heading-line': {
      paddingTop: '10px',
    },
    '.cm-line.cm-heading-line + .cm-line.cm-list-line': {
      paddingTop: '0',
    },
  },
})

export const editorHighlights: Extension[] = [syntaxHighlighting(highlightStyle), tagHighlightPlugin, headingLinePlugin, listIndentPlugin, lineSpacingTheme]
