import { act, renderHook, waitFor } from '@testing-library/react'
import type { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCitationNavigation } from './useCitationNavigation'
import type { ChatUiMessage } from '../../store/useChatStore'

const makeParams = () => ({
  days: [],
  editorRefs: { current: new Map<string, EditorView>() },
  loadDay: vi.fn().mockResolvedValue(undefined),
  pinDayForEditorMount: vi.fn(),
  revealDay: vi.fn(),
  setHighlightedQuote: vi.fn(),
  isNarrowViewportMode: true,
  setChatPanelOpen: vi.fn(),
  setMode: vi.fn(),
})

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

describe('useCitationNavigation', () => {
  it.each(['click', 'Enter', ' '])('returns from a citation activated by %s', async (activation) => {
    const params = makeParams()
    const { result } = renderHook(() => useCitationNavigation(params))
    const citation = document.createElement('span')
    citation.dataset.citationIndex = '0'
    const message: ChatUiMessage = {
      id: 'cited-answer',
      role: 'assistant',
      content: 'An answer',
      meta: { citations: [{ day: '2026-09-26', quote: 'far fare agente' }] },
    }
    const preventDefault = vi.fn()

    act(() => {
      if (activation === 'click') {
        result.current.handleAssistantMarkdownClick(message, { target: citation, preventDefault } as unknown as React.MouseEvent<HTMLElement>)
      } else {
        result.current.handleAssistantMarkdownKeyDown(message, { key: activation, target: citation, preventDefault } as unknown as React.KeyboardEvent<HTMLElement>)
      }
    })

    expect(preventDefault).toHaveBeenCalledOnce()
    await waitFor(() => expect(params.setMode).toHaveBeenCalledWith('timeline'))
    expect(params.setChatPanelOpen).toHaveBeenCalledWith(false)
  })

  it('returns to the timeline when a citation is followed on a narrow viewport', async () => {
    const params = makeParams()
    const { result } = renderHook(() => useCitationNavigation(params))

    await act(async () => {
      await result.current.handleCitationClick({ day: '2026-09-26', quote: 'far fare agente' })
    })

    expect(params.setChatPanelOpen).toHaveBeenCalledWith(false)
    expect(params.setMode).toHaveBeenCalledWith('timeline')
  })

  it('leaves the mode untouched on a wide viewport', async () => {
    const params = { ...makeParams(), isNarrowViewportMode: false }
    const { result } = renderHook(() => useCitationNavigation(params))

    await act(async () => {
      await result.current.handleCitationClick({ day: '2026-09-26', quote: 'far fare agente' })
    })

    expect(params.setMode).not.toHaveBeenCalled()
    expect(params.setChatPanelOpen).not.toHaveBeenCalled()
  })
})
