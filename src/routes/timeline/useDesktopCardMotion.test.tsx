import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DesktopCard } from '../../components/app-shell/desktopCards'
import { useDesktopCardMotion } from './useDesktopCardMotion'

function Cards({ openCard }: { openCard: DesktopCard | null }) {
  const { motions, handleTransitionEnd } = useDesktopCardMotion(openCard)
  return (
    <>
      {(['search', 'chat'] as const).map((card) => (
        <aside
          key={card}
          data-testid={card}
          data-motion={motions[card]}
          onTransitionEnd={(event) => handleTransitionEnd(card, event)}
        />
      ))}
    </>
  )
}

const motionOf = (card: DesktopCard) => screen.getByTestId(card).dataset.motion
const finishMoving = (card: DesktopCard) =>
  fireEvent.transitionEnd(screen.getByTestId(card), { propertyName: 'transform' })

describe('useDesktopCardMotion', () => {
  it('shrinks the old card beneath the new one, then parks it so it slides in again', () => {
    const view = render(<Cards openCard="search" />)
    view.rerender(<Cards openCard="chat" />)

    expect(motionOf('search')).toBe('under')
    expect(motionOf('chat')).toBe('open')

    // Only the shrink finishing parks it; a fade or resize ending does not.
    fireEvent.transitionEnd(screen.getByTestId('search'), { propertyName: 'width' })
    expect(motionOf('search')).toBe('under')

    finishMoving('search')
    expect(motionOf('search')).toBe('parked')

    // Settled, switching back is a fresh switch: chat now shrinks beneath search.
    view.rerender(<Cards openCard="search" />)
    expect(motionOf('search')).toBe('open')
    expect(motionOf('chat')).toBe('under')
  })

  it('undoes a switch still under way by sliding the new card back off the old one', () => {
    const view = render(<Cards openCard="search" />)
    view.rerender(<Cards openCard="chat" />)
    view.rerender(<Cards openCard="search" />)

    expect(motionOf('search')).toBe('open')
    expect(motionOf('chat')).toBe('out')
  })

  it('slides every visible card out when closing to the timeline', () => {
    const view = render(<Cards openCard="search" />)
    view.rerender(<Cards openCard="chat" />)
    view.rerender(<Cards openCard={null} />)

    expect(motionOf('search')).toBe('out')
    expect(motionOf('chat')).toBe('out')

    finishMoving('chat')
    expect(motionOf('chat')).toBe('parked')
  })

  it('starts parked off the edge, or open without moving', () => {
    render(<Cards openCard="chat" />)

    expect(motionOf('chat')).toBe('open')
    expect(motionOf('search')).toBe('parked')
  })
})
