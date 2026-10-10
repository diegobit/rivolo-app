import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderSyntaxLine } from './syntaxHighlight'

describe('todo search controls', () => {
  it('offers cancellation via right-click and Shift+Enter without opening the note', () => {
    const onToggleTodo = vi.fn()
    const onOpen = vi.fn()
    render(<div onClick={onOpen}>{renderSyntaxLine('- [ ] buy milk', '', 'todo', { onToggleTodo })}</div>)
    const button = screen.getByRole('button', { name: 'Toggle todo' })
    fireEvent.click(button)
    expect(onToggleTodo).toHaveBeenLastCalledWith('complete')
    fireEvent.contextMenu(button)
    expect(onToggleTodo).toHaveBeenLastCalledWith('cancel')
    fireEvent.keyDown(button, { key: 'Enter', shiftKey: true })
    expect(onToggleTodo).toHaveBeenLastCalledWith('cancel')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('renders cancellation with a readable state and strikes through only its text', () => {
    render(<div>{renderSyntaxLine('- [-] buy milk #errands', '', 'todo', { onToggleTodo: vi.fn() })}</div>)
    const button = screen.getByRole('button', { name: 'Toggle todo' })
    expect(button).toHaveTextContent('[-]')
    expect(button).toHaveAttribute('aria-description', expect.stringContaining('Cancelled.'))
    expect(screen.getByText(/buy milk/)).toHaveClass('line-through')
    expect(button).not.toHaveClass('line-through')
  })
})
