import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ShortcutsPopover from './ShortcutsPopover'

const renderPopover = (showShortcuts: boolean, onToggle = vi.fn()) => {
  render(
    <ShortcutsPopover
      shortcutsRef={createRef<HTMLDivElement>()}
      showShortcuts={showShortcuts}
      onToggle={onToggle}
      buttonClassName="test-button"
    />,
  )
  return onToggle
}

describe('ShortcutsPopover', () => {
  it('exposes its open state and dialog semantics', () => {
    renderPopover(true)

    expect(screen.getByRole('button', { name: 'Shortcuts' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Shortcuts' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    )
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  it('closes with Escape and returns focus to its trigger', () => {
    const onToggle = renderPopover(true)
    const trigger = screen.getByRole('button', { name: 'Shortcuts' })

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onToggle).toHaveBeenCalledOnce()
    expect(trigger).toHaveFocus()
  })

  it('can be opened from the keyboard', async () => {
    const onToggle = renderPopover(false)
    const trigger = screen.getByRole('button', { name: 'Shortcuts' })

    trigger.focus()
    await userEvent.keyboard('{Enter}')

    expect(onToggle).toHaveBeenCalledOnce()
  })
})
