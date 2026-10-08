import { act, renderHook } from '@testing-library/react'
import type { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCitationNavigation } from './useCitationNavigation'

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
