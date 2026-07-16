import { renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useIsNarrowViewport } from './useIsNarrowViewport'
import { NARROW_VIEWPORT_MEDIA_QUERY } from '../lib/viewport'

type ChangeListener = (event: { matches: boolean }) => void

// A controllable matchMedia stub. `modern: false` exposes only the legacy
// addListener/removeListener API so the fallback branch is exercised too.
const installMatchMedia = (matches: boolean, { modern = true } = {}) => {
  const listeners = new Set<ChangeListener>()
  const mediaQueryList = {
    matches,
    media: NARROW_VIEWPORT_MEDIA_QUERY,
    addEventListener: modern
      ? (_type: string, listener: ChangeListener) => listeners.add(listener)
      : undefined,
    removeEventListener: modern
      ? (_type: string, listener: ChangeListener) => listeners.delete(listener)
      : undefined,
    addListener: (listener: ChangeListener) => listeners.add(listener),
    removeListener: (listener: ChangeListener) => listeners.delete(listener),
  }
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue(mediaQueryList),
  })
  const emitChange = (nextMatches: boolean) => {
    mediaQueryList.matches = nextMatches
    listeners.forEach((listener) => listener({ matches: nextMatches }))
  }
  return { emitChange, listeners }
}

describe('useIsNarrowViewport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports the initial narrow state from matchMedia', () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useIsNarrowViewport())
    expect(result.current).toBe(true)
  })

  it('updates when the media query changes', () => {
    const media = installMatchMedia(false)
    const { result } = renderHook(() => useIsNarrowViewport())
    expect(result.current).toBe(false)

    act(() => media.emitChange(true))
    expect(result.current).toBe(true)

    act(() => media.emitChange(false))
    expect(result.current).toBe(false)
  })

  it('subscribes through the legacy addListener API when addEventListener is unavailable', () => {
    const media = installMatchMedia(false, { modern: false })
    const { result } = renderHook(() => useIsNarrowViewport())

    act(() => media.emitChange(true))
    expect(result.current).toBe(true)
  })

  it('unsubscribes on unmount', () => {
    const media = installMatchMedia(false)
    const { unmount } = renderHook(() => useIsNarrowViewport())
    expect(media.listeners.size).toBe(1)

    unmount()
    expect(media.listeners.size).toBe(0)
  })
})
