import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { editorHighlights } from './editorHighlights'

describe('editorHighlights', () => {
  let view: EditorView
  afterEach(() => view?.destroy())

  const renderEditor = (doc: string) => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc, extensions: editorHighlights }),
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
})
