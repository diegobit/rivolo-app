import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTodayId } from '../../lib/dates'
import type { ChatUiMessage } from '../../store/useChatStore'
import { useTimelineChat } from './useTimelineChat'

const mocks = vi.hoisted(() => ({
  buildContextDays: vi.fn(async () => []),
  chat: vi.fn(),
}))

vi.mock('../../lib/llm', () => ({ chat: mocks.chat }))
vi.mock('../../lib/llmContext', () => ({
  buildContextDays: mocks.buildContextDays,
  formatContext: vi.fn(() => ''),
}))

const activeLlmConfig = {
  provider: 'openai-compatible' as const,
  model: 'test-model',
  baseUrl: 'https://example.test/v1',
}

const useChatHarness = (onInsertNote: (targetDay: string, text: string) => Promise<void>) => {
  const [messages, setMessages] = useState<ChatUiMessage[]>([])
  const chat = useTimelineChat({
    messages,
    setMessages,
    aiLanguage: 'follow',
    allowWebSearch: false,
    activeLlmConfig,
    isNarrowViewport: false,
    chatPanelOpen: false,
    desktopChatPanelOpen: true,
    setChatPanelOpen: vi.fn(),
    setDesktopChatPanelOpen: vi.fn(),
    onInsertNote,
  })

  return { ...chat, messages }
}

const assistantMessage = (messages: ChatUiMessage[]) =>
  messages.find((message) => message.role === 'assistant')

describe('useTimelineChat automatic inserts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('automatically applies exactly one insert after the response completes', async () => {
    const responseText = '<insert text="Buy milk" target_day="2026-07-02"/>'
    mocks.chat.mockImplementation(async ({ onToken }: { onToken?: (chunk: string) => void }) => {
      onToken?.('<insert text="Buy')
      onToken?.(' milk" target_day="2026-07-02"/>')
      return { text: responseText, raw: null }
    })
    const onInsertNote = vi.fn(async () => undefined)
    const { result } = renderHook(() => useChatHarness(onInsertNote))

    await act(async () => {
      await result.current.handleChatSend('Add milk')
    })

    expect(onInsertNote).toHaveBeenCalledOnce()
    expect(onInsertNote).toHaveBeenCalledWith('2026-07-02', 'Buy milk')
    expect(assistantMessage(result.current.messages)?.meta).toMatchObject({
      insertText: 'Buy milk',
      insertTargetDay: '2026-07-02',
      insertStatus: 'applied',
      isStreaming: false,
    })
  })

  it('defaults an automatic insert to today', async () => {
    mocks.chat.mockResolvedValue({
      text: '<insert text="Buy milk"/>',
      raw: null,
    })
    const onInsertNote = vi.fn(async () => undefined)
    const { result } = renderHook(() => useChatHarness(onInsertNote))

    await act(async () => {
      await result.current.handleChatSend('Add milk')
    })

    expect(onInsertNote).toHaveBeenCalledWith(getTodayId(), 'Buy milk')
  })

  it('applies nothing when the model returns multiple inserts', async () => {
    mocks.chat.mockResolvedValue({
      text: '<insert text="One" target_day="2026-07-02"/> <insert text="Two" target_day="2026-07-03"/>',
      raw: null,
    })
    const onInsertNote = vi.fn(async () => undefined)
    const { result } = renderHook(() => useChatHarness(onInsertNote))

    await act(async () => {
      await result.current.handleChatSend('Add both')
    })

    expect(onInsertNote).not.toHaveBeenCalled()
    expect(result.current.chatError).toBe(
      'The assistant returned multiple insert actions, so nothing was added.',
    )
  })

  it('applies nothing when an insert contains a nested tag', async () => {
    mocks.chat.mockResolvedValue({
      text: '<insert text="Buy milk <ref day="2026-07-01" quote="milk"/>" target_day="2026-07-02"/>',
      raw: null,
    })
    const onInsertNote = vi.fn(async () => undefined)
    const { result } = renderHook(() => useChatHarness(onInsertNote))

    await act(async () => {
      await result.current.handleChatSend('Add cited milk')
    })

    expect(onInsertNote).not.toHaveBeenCalled()
  })

  it('keeps a failed insert available for one-tap retry', async () => {
    mocks.chat.mockResolvedValue({
      text: '<insert text="Buy milk" target_day="2026-07-02"/>',
      raw: null,
    })
    const onInsertNote = vi
      .fn<(targetDay: string, text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Storage full'))
      .mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useChatHarness(onInsertNote))

    await act(async () => {
      await result.current.handleChatSend('Add milk')
    })

    const failedMessage = assistantMessage(result.current.messages)
    expect(failedMessage?.meta?.insertStatus).toBe('failed')
    expect(result.current.chatError).toBe('Storage full')

    await act(async () => {
      await result.current.handleChatInsert(failedMessage!)
    })

    expect(onInsertNote).toHaveBeenCalledTimes(2)
    expect(assistantMessage(result.current.messages)?.meta?.insertStatus).toBe('applied')
    expect(result.current.chatError).toBeNull()
  })
})
