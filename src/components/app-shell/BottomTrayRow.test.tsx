import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BottomTrayRow from './BottomTrayRow'

const chatButton = <button type="button" aria-label="Chat" />
const searchButton = <button type="button" aria-label="Search" />
const modeToggleButton = <button type="button" aria-label="Switch mode" />
const trayCenter = <div data-testid="bottom-tray" />

type BottomTrayRowProps = Parameters<typeof BottomTrayRow>[0]

const baseProps: BottomTrayRowProps = {
  mode: 'timeline',
  chatButton,
  searchButton,
  modeToggleButton,
  trayCenter,
  showLauncherButtons: true,
  launcherSpread: false,
  showMobileChatTogglePill: false,
  chatPanelOpen: false,
  onToggleChatPanel: () => undefined,
  showScrollToToday: false,
  onScrollToToday: () => undefined,
}

const renderRow = (overrides: Partial<BottomTrayRowProps> = {}) =>
  render(<BottomTrayRow {...baseProps} {...overrides} />)

const getRow = () => {
  const row = document.querySelector('.bottom-tray-row')
  if (!(row instanceof HTMLElement)) {
    throw new Error('bottom tray row not found')
  }
  return row
}

describe('BottomTrayRow', () => {
  it('renders the launcher pair and keeps the tray slot mounted', () => {
    renderRow()

    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Switch mode' })).not.toBeInTheDocument()
    // The portal target must stay mounted even when the launcher owns the row.
    expect(screen.getByTestId('bottom-tray')).toBeInTheDocument()
  })

  it('hands the launcher pair to the viewport-pinned container on desktop', () => {
    const { container } = renderRow({ launcherSpread: true })

    const launchers = container.querySelector('.bottom-tray-launchers')
    expect(launchers).not.toBeNull()
    expect(launchers).toContainElement(screen.getByRole('button', { name: 'Search' }))
    expect(launchers).toContainElement(screen.getByRole('button', { name: 'Chat' }))
  })

  it('marks which card is open so the capsule thumb sits behind that half', () => {
    const { container, rerender } = renderRow({ launcherSpread: true, mode: 'timeline' })
    const launchers = () => container.querySelector('.bottom-tray-launchers')

    expect(launchers()).not.toHaveAttribute('data-open')

    rerender(<BottomTrayRow {...baseProps} launcherSpread mode="search" />)
    expect(launchers()).toHaveAttribute('data-open', 'search')

    rerender(<BottomTrayRow {...baseProps} launcherSpread mode="chat" />)
    expect(launchers()).toHaveAttribute('data-open', 'chat')

    rerender(<BottomTrayRow {...baseProps} launcherSpread mode="timeline" />)
    expect(launchers()).not.toHaveAttribute('data-open')
  })

  it('keeps the launcher pair inside the row on narrow viewports', () => {
    const { container } = renderRow({ launcherSpread: false })

    expect(container.querySelector('.bottom-tray-launchers')).toBeNull()
    expect(getRow()).toContainElement(screen.getByRole('button', { name: 'Search' }))
    expect(getRow()).toHaveClass('justify-center')
  })

  it('renders the mode toggle and tray composer instead of the launcher pair in mobile input modes', () => {
    renderRow({ mode: 'chat', showLauncherButtons: false })

    expect(screen.getByRole('button', { name: 'Switch mode' })).toBeInTheDocument()
    expect(screen.getByTestId('bottom-tray')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument()
  })

  it('lifts scroll-to-today clear of the desktop launcher capsule', () => {
    renderRow({ launcherSpread: true, showScrollToToday: true, mode: 'chat' })

    // The capsule is fixed outside the zero-height row, so only this offset keeps
    // the button above it; the real overlap is measured in the browser.
    const button = screen.getByRole('button', { name: 'Scroll to Today' })
    expect(button).toHaveClass('right-0', 'top-[-6.25rem]')
    expect(button).not.toHaveClass('sm:top-[-3.1rem]')
  })

  it('keeps the mobile scroll-to-today position when the pair is centered', () => {
    renderRow({ launcherSpread: false, showScrollToToday: true })

    const button = screen.getByRole('button', { name: 'Scroll to Today' })
    expect(button).toHaveClass('right-[15px]', 'sm:top-[-3.1rem]')
  })
})
