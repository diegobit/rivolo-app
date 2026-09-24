import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatUiMessage } from '../../store/useChatStore'
import ChatMessageList from './ChatMessageList'

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

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
    expect(screen.queryByRole('button', { name: /Retry insert/ })).not.toBeInTheDocument()
  })

  it('offers retry only after an automatic insert fails', async () => {
    const onChatInsert = renderMessage(insertMessage('failed'))

    await userEvent.click(screen.getByRole('button', { name: 'Retry insert into 2026-07-02' }))
    expect(onChatInsert).toHaveBeenCalledOnce()
  })
})

describe('ChatMessageList copy button', () => {
  it('copies the assistant message and confirms', async () => {
    renderMessage({ id: 'assistant-2', role: 'assistant', content: 'Hello there.' })

    const copyButton = screen.getByRole('button', { name: 'Copy message' })
    await userEvent.click(copyButton)

    expect(writeText).toHaveBeenCalledWith('Hello there.')
    expect(copyButton).toHaveTextContent('Copied')
  })

  it('offers no copy while the assistant is still streaming', () => {
    renderMessage({
      id: 'assistant-3',
      role: 'assistant',
      content: 'Half done',
      meta: { citations: [], isStreaming: true },
    })

    expect(screen.queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument()
  })

  it('offers no copy for user messages', () => {
    renderMessage({ id: 'user-1', role: 'user', content: 'Hi' })

    expect(screen.queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument()
  })

  it('reports a failed copy instead of confirming it', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn().mockReturnValue(false) })
    renderMessage({ id: 'assistant-4', role: 'assistant', content: 'Hello there.' })

    const copyButton = screen.getByRole('button', { name: 'Copy message' })
    await userEvent.click(copyButton)

    expect(copyButton).toHaveTextContent('Copy failed')
    expect(copyButton).not.toHaveTextContent('Copied')
  })

  it('ignores a clipboard result that arrives after unmount', async () => {
    let resolveWrite: (() => void) | undefined
    writeText.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        }),
    )
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')
    const { unmount } = render(
      <ChatMessageList
        messages={[{ id: 'assistant-5', role: 'assistant', content: 'Hello there.' }]}
        onAssistantMarkdownClick={vi.fn()}
        onAssistantMarkdownKeyDown={vi.fn()}
        onChatInsert={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Copy message' }))
    unmount()
    resolveWrite?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 2000)
  })
})
