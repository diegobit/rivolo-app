import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

const buildHighlightDecorations = (text: string, query: string) => {
  const trimmed = query.trim()
  const builder = new RangeSetBuilder<Decoration>()
  if (!trimmed) {
    return builder.finish()
  }

  const lowerText = text.toLowerCase()
  const lowerQuery = trimmed.toLowerCase()
  let matchIndex = lowerText.indexOf(lowerQuery)

  while (matchIndex !== -1) {
    builder.add(matchIndex, matchIndex + trimmed.length, Decoration.mark({ class: 'cm-highlight' }))
    matchIndex = lowerText.indexOf(lowerQuery, matchIndex + trimmed.length)
  }

  return builder.finish()
}

export const createHighlightPlugin = (query: string) => {
  const trimmed = query.trim()
  if (!trimmed) return null

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildHighlightDecorations(view.state.doc.toString(), trimmed)
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildHighlightDecorations(update.state.doc.toString(), trimmed)
        }
      }
    },
    {
      decorations: (value) => value.decorations,
    },
  )
}
