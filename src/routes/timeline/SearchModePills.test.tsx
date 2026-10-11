import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SearchModePills from './SearchModePills'
import type { SearchResultMode } from '../Timeline'

const renderPills = (
  layout: 'card' | 'composer',
  resultMode: SearchResultMode = 'whole-day',
  onResultModeChange = vi.fn(),
) =>
  render(
    <SearchModePills
      searchFilter={null}
      resultMode={resultMode}
      layout={layout}
      onSearchFilterChange={vi.fn()}
      onResultModeChange={onResultModeChange}
    />,
  )

describe('SearchModePills', () => {
  it('offers a Lines toggle in the phone composer, next to the filters', () => {
    renderPills('composer')

    expect(screen.getByRole('button', { name: 'Lines' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'TODOs' })).toBeInTheDocument()
  })

  it('hides the Lines toggle in the desktop card but keeps the filters', () => {
    renderPills('card')

    expect(screen.queryByRole('button', { name: 'Lines' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'TODOs' })).toBeInTheDocument()
  })

  it('switches between whole days and matching lines from the Lines toggle', () => {
    const onResultModeChange = vi.fn()
    const { unmount } = renderPills('composer', 'whole-day', onResultModeChange)
    fireEvent.click(screen.getByRole('button', { name: 'Lines' }))
    expect(onResultModeChange).toHaveBeenLastCalledWith('matched-lines')
    unmount()

    renderPills('composer', 'matched-lines', onResultModeChange)
    expect(screen.getByRole('button', { name: 'Lines' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Lines' }))
    expect(onResultModeChange).toHaveBeenLastCalledWith('whole-day')
  })

  it('keeps focus in the search field when a composer chip is tapped', () => {
    renderPills('composer')

    // A prevented mousedown is what stops the tap from taking focus.
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Lines' }))).toBe(false)
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'TODOs' }))).toBe(false)
  })
})
