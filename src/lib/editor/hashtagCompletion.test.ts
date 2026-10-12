import { CompletionContext, acceptCompletion, completionStatus, currentCompletions, autocompletion, startCompletion } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { history, undo } from '@codemirror/commands'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHashtagCompletionSource } from './hashtagCompletion'

const context = (doc: string, pos = doc.length) => new CompletionContext(EditorState.create({ doc, selection: { anchor: pos }, extensions: [markdown()] }), pos, false)
const load = vi.fn(async () => [{ token: '#next', count: 3 }, { token: '#next-ai', count: 2 }, { token: '#other', count: 10 }])
const complete = createHashtagCompletionSource('2026-10-12', load)
const views: EditorView[] = []
afterEach(() => { views.splice(0).forEach((view) => view.destroy()) })

describe('hashtag completion', () => {
  it('matches prefixes exactly, replaces the whole token, and passes the current day to SQLite', async () => {
    const result = await complete(context('Call #ne-ai later', 8))
    expect(result).toMatchObject({ from: 5, to: 11, filter: false, options: [{ label: '#next' }, { label: '#next-ai' }] })
    expect(load).toHaveBeenCalledWith('#ne', '2026-10-12')
  })

  it('keeps new unsaved tags and canonicalizes Unicode without suggesting the unfinished token', async () => {
    const result = await createHashtagCompletionSource('today', async () => [])(context('#NOVITA\u0300\n#nov'))
    expect(result?.options).toEqual([{ label: '#novità' }])
    expect(await complete(context('#ne'))).toMatchObject({ options: [{ label: '#next' }, { label: '#next-ai' }] })
    expect(await createHashtagCompletionSource('today', async () => [{ token: '#ne', count: 1 }])(context('#ne'))).toBeNull()
  })

  it('does not interrupt plain writing, headings, code or selected text', async () => {
    for (const doc of ['hello', '#', '###', '### Heading', 'città#ne', '##ne', '@#ne', '`#ne`', '```\n#ne\n```']) {
      const pos = doc === '`#ne`' ? 4 : doc.startsWith('```') ? 7 : doc.length
      expect(await complete(context(doc, pos)), doc).toBeNull()
    }
    const state = EditorState.create({ doc: '#ne', selection: EditorSelection.range(0, 3) })
    expect(await complete(new CompletionContext(state, 3, false))).toBeNull()
  })

  it('fails gracefully and discards an aborted async request', async () => {
    const failing = createHashtagCompletionSource('today', async () => { throw new Error('DB unavailable') })
    expect((await failing(context('#next-ai\n#ne')))?.options).toEqual([{ label: '#next-ai' }])
    const ctx = context('#ne')
    Object.defineProperty(ctx, 'aborted', { get: () => true })
    expect(await complete(ctx)).toBeNull()
  })

  it('accepts a completion in real CodeMirror as one undoable edit, preserving surrounding text', async () => {
    const view = new EditorView({ parent: document.body, doc: 'Call #ne-ai later', selection: { anchor: 8 }, extensions: [
      markdown(), history(), autocompletion({ override: [complete], interactionDelay: 0 }),
    ] })
    views.push(view)
    view.focus()
    startCompletion(view)
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'))
    expect(currentCompletions(view.state).map((option) => option.label)).toEqual(['#next', '#next-ai'])
    expect(acceptCompletion(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('Call #next later')
    expect(view.state.selection.main.head).toBe(10)
    expect(completionStatus(view.state)).toBeNull()
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('Call #ne-ai later')
  })
})
