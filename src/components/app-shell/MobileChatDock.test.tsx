import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MobileChatDock from './MobileChatDock'
import { useUIStore } from '../../store/useUIStore'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false }),
  })
})

const touch = (x: number, y: number, identifier = 1) => ({ clientX: x, clientY: y, identifier })

const openMenu = () => {
  render(
    <MemoryRouter>
      <MobileChatDock
        databaseStale={false}
        syncing={false}
        attentionItems={[]}
        onDismissSetupNotice={vi.fn()}
        onNavigate={vi.fn()}
      />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
  return screen.getByRole('dialog', { name: 'Menu' })
}

describe('Mobile menu swipe dismissal', () => {
  beforeEach(() => {
    useUIStore.setState({ mode: 'timeline', chatSending: false })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    })
  })

  it('dismisses a downward swipe, retaining the scroll lock until exit and restoring focus', async () => {
    const sheet = openMenu()
    fireEvent.touchStart(sheet, { touches: [touch(100, 100)] })
    expect(fireEvent.touchMove(sheet, { touches: [touch(105, 180)] })).toBe(false)
    fireEvent.touchEnd(sheet, { touches: [], changedTouches: [touch(105, 180)] })

    expect(document.querySelector('.mobile-menu-overlay')).toHaveAttribute('data-state', 'closing')
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument())
    expect(document.documentElement.style.overflow).toBe('')
  })

  it.each([
    ['short', 100, 125],
    ['horizontal', 190, 120],
    ['upward', 100, 20],
  ])('keeps the menu open after a %s gesture', (_name, x, y) => {
    const sheet = openMenu()
    fireEvent.touchStart(sheet, { touches: [touch(100, 100)] })
    fireEvent.touchMove(sheet, { touches: [touch(x, y)] })
    fireEvent.touchEnd(sheet, { touches: [], changedTouches: [touch(x, y)] })
    expect(document.querySelector('.mobile-menu-overlay')).toHaveAttribute('data-state', 'open')
  })

  it('leaves a scrolled menu available for native scrolling', () => {
    const sheet = openMenu()
    sheet.scrollTop = 50
    fireEvent.touchStart(sheet, { touches: [touch(100, 100)] })
    expect(fireEvent.touchMove(sheet, { touches: [touch(100, 200)] })).toBe(true)
    fireEvent.touchEnd(sheet, { touches: [], changedTouches: [touch(100, 200)] })
    expect(document.querySelector('.mobile-menu-overlay')).toHaveAttribute('data-state', 'open')
  })

  it.each(['cancel', 'multitouch'])('does not dismiss an interrupted %s gesture', (kind) => {
    const sheet = openMenu()
    fireEvent.touchStart(sheet, { touches: [touch(100, 100)] })
    fireEvent.touchMove(sheet, { touches: [touch(100, 180)] })
    if (kind === 'cancel') fireEvent.touchCancel(sheet)
    else fireEvent.touchStart(sheet, { touches: [touch(100, 180), touch(150, 180, 2)] })
    fireEvent.touchEnd(sheet, { touches: [], changedTouches: [touch(100, 200)] })
    expect(document.querySelector('.mobile-menu-overlay')).toHaveAttribute('data-state', 'open')
  })

  it('blocks an accidental row click after a swipe but allows the next deliberate tap', () => {
    openMenu()
    const row = screen.getByRole('button', { name: 'New chat' })
    fireEvent.touchStart(row, { touches: [touch(100, 100)] })
    fireEvent.touchMove(row, { touches: [touch(100, 130)] })
    fireEvent.touchEnd(row, { touches: [], changedTouches: [touch(100, 130)] })
    fireEvent.click(row)
    expect(useUIStore.getState().mode).toBe('timeline')
    fireEvent.touchStart(row, { touches: [touch(100, 100)] })
    fireEvent.touchEnd(row, { touches: [], changedTouches: [touch(100, 100)] })
    fireEvent.click(row)
    expect(useUIStore.getState().mode).toBe('chat')
  })
})
