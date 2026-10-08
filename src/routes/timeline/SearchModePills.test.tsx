import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SearchModePills from './SearchModePills'

const renderPills = (showResultMode: boolean) =>
  render(
    <SearchModePills
      searchFilter={null}
      resultMode="whole-day"
      showResultMode={showResultMode}
      onSearchFilterChange={vi.fn()}
      onToggleResultMode={vi.fn()}
    />,
  )

describe('SearchModePills', () => {
  it('offers the Days/Lines toggle where whole-day results exist', () => {
    renderPills(true)

    expect(screen.getByRole('button', { name: /Toggle result mode/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'TODOs' })).toBeInTheDocument()
  })

  it('hides the Days/Lines toggle but keeps the filters', () => {
    renderPills(false)

    expect(screen.queryByRole('button', { name: /Toggle result mode/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'TODOs' })).toBeInTheDocument()
  })
})
