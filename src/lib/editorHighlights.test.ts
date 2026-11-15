import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { afterEach, describe, expect, it } from 'vitest'
import { editorHighlights } from './editorHighlights'

describe('editorHighlights', () => {
  let view: EditorView
  afterEach(() => view?.destroy())

  const renderEditor = (doc: string) => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc, extensions: [markdown(), editorHighlights] }),
    })
    return view.contentDOM
  }

  it.each([
    ['Una #novità oggi', ['#novità']],
    ['#novita\u0300 #東京', ['#novita\u0300', '#東京']],
    ['città#novità', []],
  ])('decorates complete Unicode tags with word boundaries: %s', (doc, expected) => {
    const content = renderEditor(doc)
    expect(Array.from(content.querySelectorAll('.cm-hashtag'), (tag) => tag.textContent)).toEqual(expected)
    expect(content.textContent).toBe(doc)
  })

  it('updates visible tags when text changes from a word suffix to a separate tag', () => {
    const content = renderEditor('città#novità')
    expect(content.querySelector('.cm-hashtag')).toBeNull()

    view.dispatch({ changes: { from: 5, insert: ' ' } })

    expect(content.querySelector('.cm-hashtag')).toHaveTextContent('#novità')
    expect(content.textContent).toBe('città #novità')

    view.dispatch({ changes: { from: 6, to: view.state.doc.length, insert: '@東京' } })

    expect(content.querySelector('.cm-hashtag')).toBeNull()
    expect(content.querySelector('.cm-mention')).toHaveTextContent('@東京')
    expect(content.textContent).toBe('città @東京')
  })

  it('marks Markdown fences and code without treating ordinary punctuation as formatting', () => {
    const doc = 'plain * punctuation; **bold** _italic_ `code`\n\n```text\ncode here\n```'
    const content = renderEditor(doc)
    expect(Array.from(content.querySelectorAll('.cm-markdown-fence'), (el) => el.textContent))
      .toEqual(['**', '**', '_', '_', '`', '`', '```', '```'])
    expect(content.querySelector('.cm-inline-code')).toHaveTextContent('`code`')
    expect(Array.from(content.querySelectorAll('.cm-code-line'), (el) => el.textContent))
      .toEqual(['```text', 'code here', '```'])
    expect(content.textContent).toContain('plain * punctuation')
    expect(Array.from(content.querySelectorAll('.cm-code-first'), (el) => el.textContent)).toEqual(['```text'])
    expect(Array.from(content.querySelectorAll('.cm-code-last'), (el) => el.textContent)).toEqual(['```'])
  })

  it('leaves the rest of the note unstyled while a fence is still open, then boxes it once closed', () => {
    const doc = 'intro\n```\nciao\n\n# Heading\n- item'
    const content = renderEditor(doc)
    expect(content.querySelector('.cm-code-line')).toBeNull()
    expect(Array.from(content.querySelectorAll('.cm-markdown-fence'), (el) => el.textContent)).toEqual(['```'])

    view.dispatch({ changes: { from: 'intro\n```\nciao'.length, insert: '\n```' } })

    expect(Array.from(content.querySelectorAll('.cm-code-line'), (el) => el.textContent))
      .toEqual(['```', 'ciao', '```'])
    expect(content.querySelector('.cm-heading-line')).toHaveTextContent('# Heading')
  })

  it('keeps list and todo text literal inside code blocks while formatting lists outside', () => {
    const content = renderEditor('```text\n- item\n  - nested\n- [ ] task\n```\n\n- outside')
    const codeLines = Array.from(content.querySelectorAll('.cm-code-line'))
    expect(codeLines.map((line) => line.textContent)).toEqual(['```text', '- item', '  - nested', '- [ ] task', '```'])
    for (const line of codeLines) {
      expect(line).not.toHaveClass('cm-list-line')
      expect(line.querySelector('.cm-list-marker, .cm-todo-marker')).toBeNull()
    }
    expect(content.querySelector('.cm-list-marker')).toHaveTextContent('-')
    expect(content.querySelector('.cm-list-line')).toHaveTextContent('- outside')
  })
})
