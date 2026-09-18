import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import BottomTrayPortal from './BottomTrayPortal'

const removeTray = () => document.getElementById('bottom-tray')?.remove()

const createTray = () => {
  const container = document.createElement('div')
  container.id = 'bottom-tray'
  document.body.appendChild(container)
  return container
}

describe('BottomTrayPortal', () => {
  beforeEach(removeTray)

  afterEach(removeTray)

  it('renders into the tray container', () => {
    const tray = createTray()
    render(
      <BottomTrayPortal>
        <span>tray content</span>
      </BottomTrayPortal>,
    )

    expect(tray).toContainElement(screen.getByText('tray content'))
  })
})
