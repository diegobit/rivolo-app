import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { TODO_INTERACTION_HINT, todoStateLabel } from './editor/todoMarker'
import { tags } from '@lezer/highlight'
import { Decoration, EditorView, ViewPlugin, ViewUpdate, type DecorationSet } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, type EditorState, type Extension, type Line } from '@codemirror/state'
import { createNoteTokenRegex } from './noteTokens'

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
  const tagRegex = createNoteTokenRegex('#@')
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
const todoLineDecoration = Decoration.line({ class: 'cm-list-line cm-todo-line' })

const inCodeBlock = (state: EditorState, pos: number) => {
  let node = syntaxTree(state).resolveInner(pos, 1)
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true
    if (!node.parent) break
    node = node.parent
  }
  return false
}

const buildTagDecorations = (state: EditorState) => {
  const text = state.doc.toString()
  const ranges = findTagHighlightRanges(text)
  const lineStarts = new Set<number>()
  const todoLineStarts = new Set<number>()

  const todoRegex = /(^|\n)([ \t]*-\s+\[[ xX-]\])([^\n]*)/g
  let match = todoRegex.exec(text)

  while (match) {
    const prefixLength = match[1].length
    const token = match[2]
    const start = match.index + prefixLength
    if (inCodeBlock(state, start + token.length - 1)) {
      match = todoRegex.exec(text)
      continue
    }
    todoLineStarts.add(start)
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
    if (inCodeBlock(state, end - 1)) {
      match = listRegex.exec(text)
      continue
    }
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
    builder.add(lineStart, lineStart, todoLineStarts.has(lineStart) ? todoLineDecoration : listLineDecoration)
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
      this.decorations = buildTagDecorations(view.state)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = buildTagDecorations(update.state)
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)

const headingLineDecoration = Decoration.line({ class: 'cm-heading-line' })

const markdownFence = Decoration.mark({ class: 'cm-markdown-fence' })
const inlineCode = Decoration.mark({ class: 'cm-inline-code' })
const codeLine = Decoration.line({ class: 'cm-code-line' })
const codeFirstLine = Decoration.line({ class: 'cm-code-first' })
const codeLastLine = Decoration.line({ class: 'cm-code-last' })

// Use the Markdown tree so punctuation in ordinary text stays untouched.
const buildMarkdownDecorations = (state: EditorState) => {
  const ranges: ReturnType<typeof markdownFence.range>[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'EmphasisMark' || node.name === 'CodeMark') {
        ranges.push(markdownFence.range(node.from, node.to))
      } else if (node.name === 'InlineCode') {
        ranges.push(inlineCode.range(node.from, node.to))
      } else if (
        node.name === 'CodeBlock' ||
        // CommonMark runs an unclosed fence to the end of the document. Box it
        // only once its closing fence exists, so typing ``` leaves the rest alone.
        (node.name === 'FencedCode' && node.node.getChildren('CodeMark').length >= 2)
      ) {
        const firstLine = state.doc.lineAt(node.from).number
        const lastLine = state.doc.lineAt(node.to).number
        for (let line = firstLine; line <= lastLine; line++) {
          const from = state.doc.line(line).from
          ranges.push(codeLine.range(from))
          if (line === firstLine) ranges.push(codeFirstLine.range(from))
          if (line === lastLine) ranges.push(codeLastLine.range(from))
        }
      }
    },
  })
  return Decoration.set(ranges, true)
}

const markdownDecorationPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildMarkdownDecorations(view.state)
  }

  update(update: ViewUpdate) {
    if (update.docChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = buildMarkdownDecorations(update.state)
    }
  }
}, { decorations: (value) => value.decorations })

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

// The "- " before a todo's checkbox, shown only while the row is being edited.
const todoDashRegex = /^(\s*)(-\s+)\[[ xX-]\]/
const hiddenTodoDash = Decoration.replace({})

const editedLineNumbers = (view: EditorView) => {
  const numbers = new Set<number>()
  if (!view.hasFocus) return numbers
  const { doc, selection } = view.state
  for (const range of selection.ranges) {
    const last = doc.lineAt(range.to).number
    for (let number = doc.lineAt(range.from).number; number <= last; number++) numbers.add(number)
  }
  return numbers
}

const isTodoDashHidden = (edited: Set<number>, lineNumber: number, text: string) =>
  !edited.has(lineNumber) && todoDashRegex.test(text)

const forEachVisibleLine = (view: EditorView, callback: (line: Line) => void) => {
  const { doc } = view.state
  let lastLine = 0
  for (const range of view.visibleRanges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = doc.lineAt(pos)
      if (line.number > lastLine) {
        lastLine = line.number
        callback(line)
      }
      pos = line.to + 1
    }
  }
}

const buildTodoDashDecorations = (view: EditorView) => {
  const builder = new RangeSetBuilder<Decoration>()
  const edited = editedLineNumbers(view)
  forEachVisibleLine(view, (line) => {
    if (inCodeBlock(view.state, Math.min(line.from + 1, line.to))) return
    const match = isTodoDashHidden(edited, line.number, line.text) && todoDashRegex.exec(line.text)
    if (match) {
      const from = line.from + match[1].length
      builder.add(from, from + match[2].length, hiddenTodoDash)
    }
  })
  return builder.finish()
}

const todoDashPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildTodoDashDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = buildTodoDashDecorations(update.view)
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

const listPrefixWidth = (range: Range, fragment: Range, document: Document) => {
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let left = Infinity
  let right = -Infinity
  for (let node = root.nodeType === Node.TEXT_NODE ? root : walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.textContent!.length
    if (start === end) continue
    fragment.setStart(node, start)
    fragment.setEnd(node, end)
    for (const rect of fragment.getClientRects()) {
      left = Math.min(left, rect.left)
      right = Math.max(right, rect.right)
    }
    if (node === range.endContainer) break
  }
  return Number.isFinite(left) ? right - left : null
}

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
      const todoDashToggled = update.selectionSet || update.focusChanged
      const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state)
      if (update.docChanged || update.viewportChanged || todoDashToggled || refreshed || treeChanged) {
        this.decorations = this.build()
      }
      if (update.docChanged || update.viewportChanged || todoDashToggled || update.geometryChanged || treeChanged) {
        this.measure()
      }
    }

    destroy() {
      this.destroyed = true
    }

    // Rows are keyed by prefix, and by whether the todo dash is hidden, since
    // that changes the prefix's width.
    visibleListRows() {
      const rows: Array<{ from: number; end: number; key: string }> = []
      const edited = editedLineNumbers(this.view)
      forEachVisibleLine(this.view, (line) => {
        const prefix = listPrefixRegex.exec(line.text)?.[0]
        if (!prefix || inCodeBlock(this.view.state, line.from + prefix.length - 1)) return
        const hidden = isTodoDashHidden(edited, line.number, line.text)
        rows.push({
          from: line.from,
          end: line.from + prefix.length,
          key: hidden ? `hidden:${prefix}` : prefix,
        })
      })
      return rows
    }

    build() {
      const builder = new RangeSetBuilder<Decoration>()
      for (const { from, key } of this.visibleListRows()) {
        const width = this.widths.get(key)
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
          const document = view.contentDOM.ownerDocument
          const range = document.createRange()
          const fragment = document.createRange()
          for (const { from, end, key } of this.visibleListRows()) {
            if (measured.has(key)) continue
            // WebKit can round caret coordinates differently as the DOM changes.
            // Measure only text fragments so checkbox touch padding cannot widen the indent.
            const startDOM = view.domAtPos(from, 1)
            const endDOM = view.domAtPos(end, -1)
            range.setStart(startDOM.node, startDOM.offset)
            range.setEnd(endDOM.node, endDOM.offset)
            const width = listPrefixWidth(range, fragment, document)
            if (width != null) measured.set(key, Math.round(width * 10) / 10)
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

// Lists sit 8px away from plain text vertically. Headings sit 12px below what
// precedes them and 4px above what follows. This lives in an editor theme
// because CodeMirror's own .cm-line padding beats layered CSS.
const lineSpacingTheme = EditorView.theme({
  // Delimiters recede to the lightest text tone so the words they wrap lead.
  '.cm-markdown-fence': {
    color: 'var(--theme-text-subtle)',
  },
  '.cm-inline-code': {
    backgroundColor: 'var(--theme-code-bg)',
    borderRadius: '4px',
  },
  // A code block is a quiet rounded card drawn across its lines. Inset
  // shadows stand in for borders so the text stays aligned with its neighbours.
  '.cm-line.cm-code-line': {
    '--code-edge': 'var(--theme-border)',
    backgroundColor: 'var(--theme-code-bg)',
    boxShadow: 'inset 1px 0 var(--code-edge), inset -1px 0 var(--code-edge)',
  },
  '.cm-line.cm-code-first': {
    borderTopLeftRadius: '8px',
    borderTopRightRadius: '8px',
    paddingTop: '2px',
    boxShadow: 'inset 1px 0 var(--code-edge), inset -1px 0 var(--code-edge), inset 0 1px var(--code-edge)',
  },
  '.cm-line.cm-code-last': {
    borderBottomLeftRadius: '8px',
    borderBottomRightRadius: '8px',
    paddingBottom: '2px',
    boxShadow: 'inset 1px 0 var(--code-edge), inset -1px 0 var(--code-edge), inset 0 -1px var(--code-edge)',
  },
  '.cm-line.cm-code-first.cm-code-last': {
    boxShadow: 'inset 0 0 0 1px var(--code-edge)',
  },
  '.cm-line.cm-list-line': {
    marginLeft: 'var(--list-hang, 0px)',
    textIndent: 'calc(-1 * var(--list-hang, 0px))',
  },
  '.cm-line:not(.cm-list-line):not(.cm-heading-line) + .cm-line.cm-list-line': {
    paddingTop: '8px',
  },
  '.cm-line.cm-list-line + .cm-line:not(.cm-list-line):not(.cm-heading-line)': {
    paddingTop: '8px',
  },
  '.cm-line.cm-heading-line': {
    paddingBottom: '4px',
  },
  '.cm-line + .cm-line.cm-heading-line': {
    paddingTop: '12px',
  },
  // On touch screens, 4px between todo rows gives their markers room to tap.
  '@media (max-width: 640px), (pointer: coarse)': {
    '.cm-line.cm-todo-line': {
      paddingTop: '2px',
      paddingBottom: '2px',
    },
    '.cm-line.cm-todo-line + .cm-line:not(.cm-list-line):not(.cm-heading-line)': {
      paddingTop: '6px',
    },
    '.cm-line.cm-todo-line + .cm-line.cm-heading-line': {
      paddingTop: '10px',
    },
    '.cm-line.cm-heading-line + .cm-line.cm-todo-line': {
      paddingTop: '0',
    },
  },
})

export const editorHighlights: Extension[] = [syntaxHighlighting(highlightStyle), tagHighlightPlugin, headingLinePlugin, markdownDecorationPlugin, todoDashPlugin, listIndentPlugin, lineSpacingTheme]
