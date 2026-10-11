import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SearchModePills from './SearchModePills'

describe('SearchModePills', () => {
  it('keeps focus in the search field when a composer chip is tapped', () => {
    render(
      <SearchModePills
        searchFilter={null}
        resultMode="whole-day"
        layout="composer"
        onSearchFilterChange={vi.fn()}
        onResultModeChange={vi.fn()}
      />,
    )

    // A prevented mousedown is what stops the tap from taking focus.
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Lines' }))).toBe(false)
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'TODOs' }))).toBe(false)
  })
})
