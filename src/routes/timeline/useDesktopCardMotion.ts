import { useCallback, useState } from 'react'
import type { TransitionEvent } from 'react'
import type { DesktopCard } from '../../components/app-shell/desktopCards'

/**
 * Where a desktop card sits, so the CSS can move it the way Reeder moves its
 * article pane. Both cards share the right edge:
 * - open: in place, on top;
 * - out: sliding off the right edge, after closing to the timeline;
 * - under: shrinking and dimming beneath the card that replaced it;
 * - parked: off the right edge without animating, so its next opening slides
 *   in from there.
 */
export type DesktopCardMotion = 'open' | 'out' | 'under' | 'parked'

type CardMotions = Record<DesktopCard, DesktopCardMotion>

const CARDS: DesktopCard[] = ['search', 'chat']

const restingMotions = (openCard: DesktopCard | null): CardMotions => ({
  search: openCard === 'search' ? 'open' : 'parked',
  chat: openCard === 'chat' ? 'open' : 'parked',
})

const nextMotions = (
  motions: CardMotions,
  previous: DesktopCard | null,
  openCard: DesktopCard | null,
): CardMotions => {
  // Reopening the card still shrinking beneath the current one undoes the
  // switch: it grows back while the current card slides out over it.
  const undoingSwitch = openCard !== null && motions[openCard] === 'under'
  const next = { ...motions }
  for (const card of CARDS) {
    if (card === openCard) {
      next[card] = 'open'
    } else if (openCard === null) {
      // Closing to the timeline takes any card still shrinking beneath along.
      if (motions[card] !== 'parked') next[card] = 'out'
    } else if (card === previous) {
      next[card] = undoingSwitch ? 'out' : 'under'
    }
  }
  return next
}

export function useDesktopCardMotion(openCard: DesktopCard | null) {
  const [state, setState] = useState(() => ({ openCard, motions: restingMotions(openCard) }))

  let { motions } = state
  if (state.openCard !== openCard) {
    motions = nextMotions(state.motions, state.openCard, openCard)
    setState({ openCard, motions })
  }

  // Once a card has left the screen, park it: one that shrank out of sight
  // beneath the new card then slides in again next time instead of growing back.
  const handleTransitionEnd = useCallback((card: DesktopCard, event: TransitionEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') return
    setState((current) =>
      current.motions[card] === 'under' || current.motions[card] === 'out'
        ? { ...current, motions: { ...current.motions, [card]: 'parked' } }
        : current,
    )
  }, [])

  return { motions, handleTransitionEnd }
}
