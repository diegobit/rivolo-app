import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SearchModePills from './SearchModePills'
import type { SearchFilter } from '../../lib/dayRepository'
import type { SearchResultMode } from '../Timeline'

const renderPills = (
  layout: 'card' | 'composer',
  {
    resultMode = 'whole-day',
    searchFilter = null,
    onResultModeChange = vi.fn(),
    onSearchFilterChange = vi.fn(),
  }: {
    resultMode?: SearchResultMode
    searchFilter?: SearchFilter | null
    onResultModeChange?: (mode: SearchResultMode) => void
    onSearchFilterChange?: (filter: SearchFilter | null) => void
  } = {},
) =>
  render(
    <SearchModePills
      searchFilter={searchFilter}
      resultMode={resultMode}
      layout={layout}
      onSearchFilterChange={onSearchFilterChange}
      onResultModeChange={onResultModeChange}
    />,
  )

describe('SearchModePills', () => {
  it('offers Days | Lines and a Filter dropdown in the phone composer', () => {
    renderPills('composer')

    expect(screen.getByRole('button', { name: 'Days' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Lines' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'TODOs' })).not.toBeInTheDocument()
  })

  it('hides the result toggle in the desktop card but keeps the filter chips', () => {
    renderPills('card')

    expect(screen.queryByRole('button', { name: 'Lines' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Filter' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'TODOs' })).toBeInTheDocument()
  })

  it('switches between whole days and matching lines', () => {
    const onResultModeChange = vi.fn()
    renderPills('composer', { onResultModeChange })

    fireEvent.click(screen.getByRole('button', { name: 'Lines' }))
    expect(onResultModeChange).toHaveBeenLastCalledWith('matched-lines')
    fireEvent.click(screen.getByRole('button', { name: 'Days' }))
    expect(onResultModeChange).toHaveBeenLastCalledWith('whole-day')
  })

  it('lists No filter and every filter in the dropdown, and closes on pick', () => {
    const onSearchFilterChange = vi.fn()
    renderPills('composer', { onSearchFilterChange })

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const items = screen.getAllByRole('menuitemradio').map((item) => item.textContent)
    expect(items).toEqual(['No filter', 'TODOs', '# Tags', '@ Mentions', 'Sections'])
    expect(screen.getByRole('menuitemradio', { name: 'No filter' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'TODOs' }))
    expect(onSearchFilterChange).toHaveBeenLastCalledWith('open-todos')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the dropdown on Escape or a tap outside', () => {
    renderPills('composer')

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows an active filter as a pill whose X clears it', () => {
    const onSearchFilterChange = vi.fn()
    renderPills('composer', { searchFilter: 'tags', onSearchFilterChange })

    expect(screen.queryByRole('button', { name: 'Filter' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove # Tags filter' }))
    expect(onSearchFilterChange).toHaveBeenLastCalledWith(null)
  })

  it('keeps focus in the search field when a composer control is tapped', () => {
    renderPills('composer')

    // A prevented mousedown is what stops the tap from taking focus.
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Lines' }))).toBe(false)
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Filter' }))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    expect(fireEvent.mouseDown(screen.getByRole('menuitemradio', { name: 'TODOs' }))).toBe(false)
  })
})
