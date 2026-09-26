import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useStickToBottom } from './useStickToBottom'

// jsdom has no layout, so the list's scroll geometry is faked.
const fakeGeometry = (element: HTMLElement, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight })
}

function List({ contentKey }: { contentKey: string }) {
  const { ref, onScroll, hasUnseen } = useStickToBottom(true, contentKey)
  return (
    <div
      data-testid="list"
      ref={(element) => {
        if (element) fakeGeometry(element, 1000, 200)
        ref.current = element
      }}
      onScroll={onScroll}
    >
      {hasUnseen && <span>unseen</span>}
    </div>
  )
}

describe('useStickToBottom', () => {
  it('follows new content while the reader is at the bottom', () => {
    const view = render(<List contentKey="1" />)
    const list = screen.getByTestId('list')
    expect(list.scrollTop).toBe(1000)

    list.scrollTop = 0
    act(() => {
      view.rerender(<List contentKey="2" />)
    })

    // Still following: new content pulls the list back to the end.
    expect(list.scrollTop).toBe(1000)
    expect(screen.queryByText('unseen')).not.toBeInTheDocument()
  })

  it('leaves a reader who scrolled up in place and flags the new content', () => {
    const view = render(<List contentKey="1" />)
    const list = screen.getByTestId('list')

    list.scrollTop = 100
    fireEvent.scroll(list)
    act(() => {
      view.rerender(<List contentKey="2" />)
    })

    expect(list.scrollTop).toBe(100)
    expect(screen.getByText('unseen')).toBeInTheDocument()

    // Scrolling back to the end clears the flag.
    list.scrollTop = 800
    fireEvent.scroll(list)
    expect(screen.queryByText('unseen')).not.toBeInTheDocument()
  })
})
