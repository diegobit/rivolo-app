import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatUiMessage } from '../../store/useChatStore'
import * as assistantMarkdown from '../../lib/assistantMarkdown'
import ChatMessageList from './ChatMessageList'

vi.mock('../../lib/assistantMarkdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/assistantMarkdown')>()
  return { ...actual, renderAssistantMarkdown: vi.fn(actual.renderAssistantMarkdown) }
})

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
  it('keeps message text and focusable controls in chronological DOM order', () => {
    render(
      <ChatMessageList
        mobile
        messages={[
          { id: 'first', role: 'user', content: 'First message' },
          { id: 'second', role: 'assistant', content: 'Second message' },
        ]}
        onAssistantMarkdownClick={vi.fn()}
        onAssistantMarkdownKeyDown={vi.fn()}
        onChatInsert={vi.fn()}
      />,
    )

    expect(screen.getByText('First message').compareDocumentPosition(screen.getByText('Second message')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Copy message' })).toHaveLength(2)
  })

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

  it('copies a user message and confirms', async () => {
    renderMessage({ id: 'user-1', role: 'user', content: 'Hi there.' })

    expect(screen.getByText('Hi there.')).toBeInTheDocument()
    const copyButton = screen.getByRole('button', { name: 'Copy message' })
    await userEvent.click(copyButton)

    expect(writeText).toHaveBeenCalledWith('Hi there.')
    expect(copyButton).toHaveTextContent('Copied')
  })

  it('offers no copy for an empty user message', () => {
    renderMessage({ id: 'user-2', role: 'user', content: '' })

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

describe('assistant Markdown rendering', () => {
  const renderMarkdown = vi.mocked(assistantMarkdown.renderAssistantMarkdown)
  const list = (messages: ChatUiMessage[]) => (
    // New handler functions on every render, as the timeline passes them.
    <ChatMessageList
      messages={messages}
      onAssistantMarkdownClick={() => undefined}
      onAssistantMarkdownKeyDown={() => undefined}
      onChatInsert={() => undefined}
    />
  )
  const first: ChatUiMessage = { id: 'a1', role: 'assistant', content: 'First **answer**.', meta: { citations: [] } }
  const question: ChatUiMessage = { id: 'u1', role: 'user', content: 'And then?' }
  const streaming = (content: string): ChatUiMessage => ({
    id: 'a2',
    role: 'assistant',
    content,
    meta: { citations: [], isStreaming: true },
  })

  beforeEach(() => {
    renderMarkdown.mockClear()
  })

  it('does not render a message again when the list re-renders unchanged', () => {
    const messages = [first, question, streaming('Second')]
    const { rerender, container } = render(list(messages))
    expect(renderMarkdown).toHaveBeenCalledTimes(2)

    rerender(list(messages))
    rerender(list([...messages]))

    expect(renderMarkdown).toHaveBeenCalledTimes(2)
    expect(container.querySelector('strong')).toHaveTextContent('answer')
  })

  it('renders only the streaming message again as its text grows', () => {
    const { rerender, container } = render(list([first, question, streaming('Second')]))
    renderMarkdown.mockClear()

    rerender(list([first, question, streaming('Second *part*')]))

    expect(renderMarkdown).toHaveBeenCalledTimes(1)
    expect(renderMarkdown).toHaveBeenCalledWith('Second *part*', [])
    expect(container.querySelector('em')).toHaveTextContent('part')
  })

  it('renders a message again when its citations change', () => {
    const cited = (quote: string): ChatUiMessage => ({
      id: 'a1',
      role: 'assistant',
      content: 'See @@CITATION_0@@',
      meta: { citations: [{ day: '2026-07-02', quote }] },
    })
    const { rerender, container } = render(list([cited('milk')]))

    rerender(list([cited('bread')]))

    expect(renderMarkdown).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-citation-index="0"]')).toHaveAttribute('title', expect.stringContaining('bread'))
  })
})
