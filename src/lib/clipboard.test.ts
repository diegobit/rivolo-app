import { describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from './clipboard'

describe('copyTextToClipboard', () => {
  it('writes through the async clipboard API', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    await expect(copyTextToClipboard('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to execCommand when the clipboard API rejects', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    await expect(copyTextToClipboard('hello')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('reports failure when no clipboard path works', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn().mockReturnValue(false) })

    await expect(copyTextToClipboard('hello')).resolves.toBe(false)
  })
})
