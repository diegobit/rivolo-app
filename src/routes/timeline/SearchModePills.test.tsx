import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SearchModePills from './SearchModePills'

const renderPills = (showResultMode: boolean) =>
  render(
    <SearchModePills
      searchFilter={null}
      resultMode="whole-day"
      showResultMode={showResultMode}
      onSearchFilterChange={vi.fn()}
      onResultModeChange={vi.fn()}
    />,
  )

describe('SearchModePills', () => {
  it('offers the Days/Lines toggle where whole-day results exist', () => {
    renderPills(true)

    expect(screen.getByRole('button', { name: 'Days' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Lines' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'TODOs' })).toBeInTheDocument()
  })

  it('hides the Days/Lines toggle but keeps the filters', () => {
    renderPills(false)

    expect(screen.queryByRole('group', { name: 'Show results as' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'TODOs' })).toBeInTheDocument()
  })
  it('selects a specific result mode from either segment', () => {
    const onResultModeChange = vi.fn()
    render(<SearchModePills searchFilter={null} resultMode="whole-day" showResultMode onSearchFilterChange={vi.fn()} onResultModeChange={onResultModeChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Lines' }))
    expect(onResultModeChange).toHaveBeenLastCalledWith('matched-lines')
    fireEvent.click(screen.getByRole('button', { name: 'Days' }))
    expect(onResultModeChange).toHaveBeenLastCalledWith('whole-day')
  })

})
