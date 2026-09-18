import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BottomTrayRow from './BottomTrayRow'

const chatButton = <button type="button" aria-label="Chat" />
const searchButton = <button type="button" aria-label="Search" />
const modeToggleButton = <button type="button" aria-label="Switch mode" />
const trayCenter = <div data-testid="bottom-tray" />

const renderRow = (overrides: Partial<Parameters<typeof BottomTrayRow>[0]> = {}) =>
  render(
    <BottomTrayRow
      mode="timeline"
      chatButton={chatButton}
      searchButton={searchButton}
      modeToggleButton={modeToggleButton}
      trayCenter={trayCenter}
      showLauncherButtons
      launcherSpread={false}
      showMobileChatTogglePill={false}
      chatPanelOpen={false}
      onToggleChatPanel={() => undefined}
      showScrollToToday={false}
      onScrollToToday={() => undefined}
      {...overrides}
    />,
  )

const getRow = () => {
  const row = screen.getByRole('button', { name: 'Search' }).parentElement
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

    expect(container.querySelector('.bottom-tray-launchers')).not.toBeNull()
  })

  it('keeps the launcher pair inside the row on narrow viewports', () => {
    const { container } = renderRow({ launcherSpread: false })

    expect(container.querySelector('.bottom-tray-launchers')).toBeNull()
    expect(getRow()).toContainElement(screen.getByRole('button', { name: 'Search' }))
  })

  it('renders the mode toggle and tray composer instead of the launcher pair in mobile input modes', () => {
    renderRow({ mode: 'chat', showLauncherButtons: false })

    expect(screen.getByRole('button', { name: 'Switch mode' })).toBeInTheDocument()
    expect(screen.getByTestId('bottom-tray')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument()
  })

  it('keeps scroll-to-today at the row edge once the launchers leave the row', () => {
    renderRow({ launcherSpread: true, showScrollToToday: true })

    expect(screen.getByRole('button', { name: 'Scroll to Today' })).toHaveClass('right-0')
  })

  it('keeps the mobile scroll-to-today position when the pair is centered', () => {
    renderRow({ launcherSpread: false, showScrollToToday: true })

    const button = screen.getByRole('button', { name: 'Scroll to Today' })
    expect(button).toHaveClass('right-[15px]')
  })
})
