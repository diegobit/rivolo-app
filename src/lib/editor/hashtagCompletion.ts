import { acceptCompletion, autocompletion, type CompletionSource } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { Prec } from '@codemirror/state'
import { EditorView, keymap, tooltips } from '@codemirror/view'
import { findHashtagSuggestions } from '../hashtagRepository'
import type { HashtagSuggestion } from '../hashtagIndex'
import { countHashtags, normalizeNoteToken } from '../noteTokens'

type SuggestionLoader = (prefix: string, excludeDayId: string) => Promise<HashtagSuggestion[]>
const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'URL', 'Autolink'])

export const createHashtagCompletionSource = (dayId: string, load: SuggestionLoader = findHashtagSuggestions): CompletionSource =>
  async (context) => {
    if (context.state.readOnly || context.view?.composing || !context.state.selection.main.empty || context.state.selection.ranges.length > 1) return null
    const match = context.matchBefore(/#[\p{L}\p{M}\p{N}_/-]+/u)
    if (!match) return null
    const before = context.state.sliceDoc(Math.max(0, match.from - 2), match.from)
    if (/[\p{L}\p{M}\p{N}_#@]$/u.test(before)) return null
    for (let node = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent!) {
      if (CODE_NODES.has(node.name)) return null
    }

    const prefix = normalizeNoteToken(match.text)
    const line = context.state.doc.lineAt(context.pos)
    const suffix = line.text.slice(context.pos - line.from).match(/^[\p{L}\p{M}\p{N}_/-]*/u)![0]
    const to = context.pos + suffix.length
    // Exclude the token currently being typed, including its suffix if the
    // cursor is in the middle of an existing tag. Keep unsaved tags elsewhere.
    const draft = context.state.sliceDoc(0, match.from) + ' ' + context.state.sliceDoc(to)
    const counts = countHashtags(draft)
    context.addEventListener('abort', () => {}, { onDocChange: true })
    try {
      // Replace this day's saved tags with its live draft, so removed or
      // half-written tags from the last autosave aren't offered back to it.
      for (const suggestion of await load(prefix, dayId)) {
        counts.set(suggestion.token, (counts.get(suggestion.token) ?? 0) + suggestion.count)
      }
    } catch {
      // Suggestions are optional. A storage/secondary-tab failure must never
      // interrupt typing; tags in the current draft still work offline.
    }
    if (context.aborted) return null
    const options = [...counts]
      .filter(([token]) => token.startsWith(prefix) && token !== prefix)
      .sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b))
      .slice(0, 8)
      .map(([token]) => ({ label: token }))
    return options.length ? { from: match.from, to, options, filter: false } : null
  }

export const hashtagCompletion = (dayId: string) => [
  autocompletion({
    override: [createHashtagCompletionSource(dayId)],
    icons: false,
    maxRenderedOptions: 8,
    tooltipClass: () => 'hashtag-suggestions',
  }),
  Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
  // The note card clips its editor for rounded corners. Place the popup in
  // the body and let CodeMirror position it against the visible viewport.
  tooltips({
    parent: document.body,
    tooltipSpace: (view) => {
      const win = view.dom.ownerDocument.defaultView!
      const viewport = win.visualViewport
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      return {
        left: left + 8,
        right: left + (viewport?.width ?? win.innerWidth) - 8,
        top: top + 8,
        bottom: top + (viewport?.height ?? win.innerHeight) - 8,
      }
    },
  }),
  EditorView.theme({
    '.cm-tooltip.hashtag-suggestions': {
      backgroundColor: 'var(--theme-surface-elevated)',
      color: 'var(--theme-text)',
      border: '1px solid var(--theme-border)',
      borderRadius: '10px',
      boxShadow: 'var(--theme-float-shadow)',
      overflow: 'hidden',
      maxWidth: 'min(20rem, calc(100vw - 2rem))',
      minWidth: '0',
    },
    '.cm-tooltip.hashtag-suggestions > ul': {
      fontFamily: 'inherit',
      fontSize: '14px',
      minWidth: '9rem',
      maxHeight: 'min(16rem, 40dvh)',
    },
    '.cm-tooltip.hashtag-suggestions > ul > li': {
      minHeight: '44px',
      display: 'flex',
      alignItems: 'center',
      padding: '8px 12px',
      boxSizing: 'border-box',
      overflowWrap: 'anywhere',
      whiteSpace: 'normal',
    },
    '.cm-tooltip.hashtag-suggestions > ul > li[aria-selected]': {
      backgroundColor: 'var(--theme-accent-soft)',
      color: 'var(--theme-accent-muted-text)',
    },
  }),
]
