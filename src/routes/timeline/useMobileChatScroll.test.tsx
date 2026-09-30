import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMobileChatScroll } from './useMobileChatScroll'

describe('mobile chat scroll', () => {
  it('opens at the bottom, follows a stream, and reports unseen content while reading older messages', () => {
    let height = 500
    const Harness = ({ active, contentKey }: { active: boolean; contentKey: string }) => {
      const { scrollerRef, contentRef, onScroll, following, hasUnseen, scrollToBottom } = useMobileChatScroll(active, contentKey)
      return <div ref={scrollerRef} onScroll={onScroll}>
        <div ref={contentRef}>Messages</div>
        <span data-testid="state">{following ? 'following' : hasUnseen ? 'unseen' : 'reading'}</span>
        <button onClick={scrollToBottom}>Latest</button>
      </div>
    }
    const view = render(<Harness active={false} contentKey="first" />)
    const scroller = view.container.firstElementChild as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { get: () => height })
    Object.defineProperty(scroller, 'clientHeight', { get: () => 100 })

    view.rerender(<Harness active contentKey="first" />)
    expect(scroller.scrollTop).toBe(400)

    height = 600
    view.rerender(<Harness active contentKey="stream 1" />)
    expect(scroller.scrollTop).toBe(500)

    height = 630
    act(() => window.dispatchEvent(new Event('resize')))
    expect(scroller.scrollTop).toBe(530)

    act(() => {
      scroller.scrollTop = 120
      fireEvent.scroll(scroller)
    })
    expect(view.getByTestId('state')).toHaveTextContent('reading')

    height = 700
    view.rerender(<Harness active contentKey="stream 2" />)
    expect(scroller.scrollTop).toBe(120)
    expect(view.getByTestId('state')).toHaveTextContent('unseen')

    height = 730
    act(() => window.dispatchEvent(new Event('resize')))
    expect(scroller.scrollTop).toBe(120)

    act(() => fireEvent.click(view.getByRole('button', { name: 'Latest' })))
    expect(scroller.scrollTop).toBe(630)
    expect(view.getByTestId('state')).toHaveTextContent('following')

    view.rerender(<Harness active={false} contentKey="stream 2" />)
    scroller.scrollTop = 0
    view.rerender(<Harness active contentKey="stream 2" />)
    expect(scroller.scrollTop).toBe(630)
  })

  it('resumes following after a stream update interrupts the touch idle period', () => {
    vi.useFakeTimers()
    try {
      let height = 500
      const Harness = ({ active, contentKey }: { active: boolean; contentKey: string }) => {
        const { scrollerRef, contentRef, onScroll, onTouchStart, onTouchEnd } = useMobileChatScroll(active, contentKey)
        return <div ref={scrollerRef} onScroll={onScroll} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div ref={contentRef}>Messages</div>
        </div>
      }
      const view = render(<Harness active={false} contentKey="first" />)
      const scroller = view.container.firstElementChild as HTMLDivElement
      Object.defineProperty(scroller, 'scrollHeight', { get: () => height })
      Object.defineProperty(scroller, 'clientHeight', { get: () => 100 })
      view.rerender(<Harness active contentKey="first" />)
      expect(scroller.scrollTop).toBe(400)

      fireEvent.touchStart(scroller)
      fireEvent.touchEnd(scroller)
      height = 600
      view.rerender(<Harness active contentKey="stream 1" />)
      expect(scroller.scrollTop).toBe(400)

      act(() => vi.advanceTimersByTime(161))
      expect(scroller.scrollTop).toBe(500)
      height = 700
      view.rerender(<Harness active contentKey="stream 2" />)
      expect(scroller.scrollTop).toBe(600)

      fireEvent.touchStart(scroller)
      view.rerender(<Harness active={false} contentKey="stream 2" />)
      scroller.scrollTop = 0
      view.rerender(<Harness active contentKey="stream 2" />)
      expect(scroller.scrollTop).toBe(600)
    } finally {
      vi.useRealTimers()
    }
  })
})
