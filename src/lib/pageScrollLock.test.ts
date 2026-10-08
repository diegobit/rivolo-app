import { afterEach, describe, expect, it, vi } from 'vitest'
import { lockPageScroll } from './pageScrollLock'

afterEach(() => {
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  vi.restoreAllMocks()
})

describe('page scroll lock', () => {
  it('keeps the page locked until both chat and menu release it', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const releaseChat = lockPageScroll()
    const releaseMenu = lockPageScroll()

    expect(document.documentElement.style.overflow).toBe('hidden')
    releaseChat()
    expect(document.documentElement.style.overflow).toBe('hidden')
    releaseMenu()
    expect(document.documentElement.style.overflow).toBe('')
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
