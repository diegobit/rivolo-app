import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ChatUiMessage } from '../../store/useChatStore'
import ChatMessageList from './ChatMessageList'

const renderMessage = (message: ChatUiMessage, onChatInsert = vi.fn()) => {
  render(
    <ChatMessageList
      messages={[message]}
      onAssistantMarkdownClick={vi.fn()}
      onAssistantMarkdownKeyDown={vi.fn()}
      onChatInsert={onChatInsert}
    />,
  )
  return onChatInsert
}

const insertMessage = (insertStatus: 'applied' | 'failed'): ChatUiMessage => ({
  id: 'assistant-1',
  role: 'assistant',
  content: 'Done.',
  meta: {
    citations: [],
    insertText: 'Buy milk',
    insertTargetDay: '2026-07-02',
    insertStatus,
    isStreaming: false,
  },
})

describe('ChatMessageList insert status', () => {
  it('shows a non-interactive status after an automatic insert succeeds', () => {
    renderMessage(insertMessage('applied'))

    expect(screen.getByRole('status')).toHaveTextContent('Added to 2026-07-02')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers retry only after an automatic insert fails', async () => {
    const onChatInsert = renderMessage(insertMessage('failed'))

    await userEvent.click(screen.getByRole('button', { name: 'Retry insert into 2026-07-02' }))
    expect(onChatInsert).toHaveBeenCalledOnce()
  })
})
