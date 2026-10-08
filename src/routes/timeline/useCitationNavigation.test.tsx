import { act, renderHook } from '@testing-library/react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCitationNavigation } from './useCitationNavigation'

const dayId = '2026-09-26'

const renderNavigation = (doc: string) => {
  const view = new EditorView({ state: EditorState.create({ doc }), parent: document.body })
  const dispatch = vi.spyOn(view, 'dispatch')
  const editorRefs = { current: new Map([[dayId, view]]) }
  const { result } = renderHook(() =>
    useCitationNavigation({
      days: [{ dayId, humanTitle: '', contentMd: doc, createdAt: 0, updatedAt: 0 }],
      editorRefs,
      loadDay: vi.fn(),
      pinDayForEditorMount: vi.fn(),
      revealDay: vi.fn(),
      setHighlightedQuote: vi.fn(),
      isNarrowViewportMode: false,
      setChatPanelOpen: vi.fn(),
      setMode: vi.fn(),
    }),
  )
  // The scroll target is the position of the scrollIntoView effect.
  const scrolledTo = () => {
    const spec = dispatch.mock.calls.at(-1)?.[0] as { effects?: { value: { range: { head: number } } } }
    return spec?.effects?.value.range.head
  }
  return { result, scrolledTo, view }
}

describe('useCitationNavigation', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  })

  const doc = 'apple repeated\nfiller\napple repeated'
  const secondOccurrence = doc.lastIndexOf('apple repeated')

  it('scrolls to the given line when a quote repeats', async () => {
    const { result, scrolledTo, view } = renderNavigation(doc)

    await act(async () => {
      await result.current.handleCitationClick({ day: dayId, quote: 'apple repeated', lineIndex: 2 })
    })

    expect(scrolledTo()).toBe(secondOccurrence)
    view.destroy()
  })

  it('falls back to the first occurrence when the line no longer holds the quote', async () => {
    const { result, scrolledTo, view } = renderNavigation(doc)

    await act(async () => {
      await result.current.handleCitationClick({ day: dayId, quote: 'apple repeated', lineIndex: 1 })
    })

    expect(scrolledTo()).toBe(0)
    view.destroy()
  })
})
