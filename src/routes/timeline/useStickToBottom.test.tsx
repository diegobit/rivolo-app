import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useStickToBottom } from './useStickToBottom'

// jsdom has no layout, so the list's scroll geometry is faked.
const fakeGeometry = (element: HTMLElement, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight })
}

function List({ contentKey }: { contentKey: string }) {
  const { ref, onScroll, following, hasUnseen, scrollToBottom } = useStickToBottom(true, contentKey)
  return (
    <div
      data-testid="list"
      data-following={following}
      ref={(element) => {
        if (element) fakeGeometry(element, 1000, 200)
        ref.current = element
      }}
      onScroll={onScroll}
    >
      {hasUnseen && <span>unseen</span>}
      <button type="button" onClick={scrollToBottom}>Jump to latest</button>
    </div>
  )
}

const scrollInputs = [
  {
    name: 'keyboard',
    start: (list: HTMLElement) => fireEvent.keyDown(list.querySelector('button')!, { key: 'ArrowUp' }),
    finish: async () => {
      await act(async () => {
        await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
      })
    },
  },
  { name: 'touch', start: (list: HTMLElement) => fireEvent.touchStart(list), finish: (list: HTMLElement) => fireEvent.touchEnd(list) },
  { name: 'scrollbar drag', start: (list: HTMLElement) => fireEvent.pointerDown(list), finish: () => fireEvent.pointerUp(window) },
] as const

describe('useStickToBottom', () => {
  it('leaves a reader who scrolled up in place when the native scroll arrives after a frame', async () => {
    const view = render(<List contentKey="1" />)
    const list = screen.getByTestId('list')

    fireEvent.wheel(list, { deltaY: -100 })
    await act(async () => {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
    })
    list.scrollTop = 100
    fireEvent.scroll(list)
    act(() => {
      view.rerender(<List contentKey="2" />)
    })

    expect(list.scrollTop).toBe(100)
    expect(screen.getByText('unseen')).toBeInTheDocument()

    // Scrolling back to the end clears the flag.
    fireEvent.wheel(list, { deltaY: 100 })
    list.scrollTop = 800
    fireEvent.scroll(list)
    expect(screen.queryByText('unseen')).not.toBeInTheDocument()
  })

  it('does not flag content the reader saw before scrolling up', () => {
    const view = render(<List contentKey="1" />)
    const list = screen.getByTestId('list')

    // Content arrives while following, with no scroll event (the end did not move).
    act(() => {
      view.rerender(<List contentKey="2" />)
    })
    fireEvent.wheel(list, { deltaY: -100 })
    list.scrollTop = 100
    fireEvent.scroll(list)

    expect(screen.queryByText('unseen')).not.toBeInTheDocument()
  })

  it('does not carry a wheel at the top boundary into a later layout scroll', () => {
    render(<List contentKey="1" />)
    const list = screen.getByTestId('list')

    list.scrollTop = 0
    fireEvent.scroll(list)
    fireEvent.wheel(list, { deltaY: -100 })
    list.scrollTop = 100
    fireEvent.scroll(list)

    expect(list).toHaveAttribute('data-following', 'true')
    expect(screen.queryByText('unseen')).not.toBeInTheDocument()
  })

  it('recognizes a wheel after the browser has already moved the scroll position', () => {
    render(<List contentKey="1" />)
    const list = screen.getByTestId('list')

    list.scrollTop = 100
    fireEvent.wheel(list, { deltaY: -100 })
    fireEvent.scroll(list)

    expect(list).toHaveAttribute('data-following', 'false')
  })

  it('retires an unmoved wheel when new content changes the list', () => {
    const view = render(<List contentKey="1" />)
    const list = screen.getByTestId('list')

    list.scrollTop = 400
    fireEvent.scroll(list)
    fireEvent.wheel(list, { deltaY: -100 })
    act(() => {
      view.rerender(<List contentKey="2" />)
    })
    // Move in the old wheel's direction, so direction rejection cannot hide
    // a stale intent surviving the content change.
    list.scrollTop = 300
    fireEvent.scroll(list)

    expect(list).toHaveAttribute('data-following', 'true')
    expect(screen.queryByText('unseen')).not.toBeInTheDocument()
  })

  it('does not treat scroll movement opposite to the wheel direction as user scrolling', () => {
    render(<List contentKey="1" />)
    const list = screen.getByTestId('list')

    list.scrollTop = 400
    fireEvent.scroll(list)
    fireEvent.wheel(list, { deltaY: -100 })
    list.scrollTop = 500
    fireEvent.scroll(list)

    expect(list).toHaveAttribute('data-following', 'true')
    expect(screen.queryByText('unseen')).not.toBeInTheDocument()
  })

  it.each(scrollInputs)('keeps $name scrolling functional and clears its intent after use', async ({ start, finish }) => {
    render(<List contentKey="1" />)
    const list = screen.getByTestId('list')

    start(list)
    list.scrollTop = 100
    fireEvent.scroll(list)
    expect(list).toHaveAttribute('data-following', 'false')

    await finish(list)
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }))
    expect(list.scrollTop).toBe(1000)
    list.scrollTop = 700
    fireEvent.scroll(list)

    expect(list).toHaveAttribute('data-following', 'true')
  })

  it('keeps following when a scroll event comes from layout movement without user input', () => {
    const view = render(<List contentKey="1" />)
    const list = screen.getByTestId('list')

    list.scrollTop = 100
    fireEvent.scroll(list)
    act(() => {
      view.rerender(<List contentKey="2" />)
    })

    expect(list).toHaveAttribute('data-following', 'true')
    expect(screen.queryByText('unseen')).not.toBeInTheDocument()
  })
})
