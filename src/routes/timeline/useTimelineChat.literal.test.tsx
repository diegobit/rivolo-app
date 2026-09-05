import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatUiMessage } from '../../store/useChatStore'
import { useTimelineChat } from './useTimelineChat'

const mocks = vi.hoisted(() => ({
  buildContextDays: vi.fn(async (): Promise<{ dayId: string; contentMd: string }[]> => []),
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

describe('useTimelineChat literal examples', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['final response', 'streamed chunks', 'retry response'])('does not execute insert tags in fenced examples (%s)', async (delivery) => {
    const responseText = 'Example syntax:\n```xml\n<insert text="unrequested mutation"/>\n<ref day="2026-07-01" quote="example"/>\n```'
    if (delivery === 'retry response') mocks.chat.mockResolvedValueOnce({ text: '', raw: null })
    mocks.chat.mockImplementation(async ({ onToken }: { onToken?: (chunk: string) => void }) => {
      if (delivery === 'streamed chunks') for (const char of responseText) onToken?.(char)
      return { text: responseText, raw: null }
    })
    const onInsertNote = vi.fn(async () => undefined)
    const { result } = renderHook(() => useChatHarness(onInsertNote))
    await act(async () => {
      await result.current.handleChatSend('Explain the insert tag format without changing notes')
    })
    const message = assistantMessage(result.current.messages)
    expect(mocks.chat).toHaveBeenCalledTimes(delivery === 'retry response' ? 2 : 1)
    expect(onInsertNote).not.toHaveBeenCalled()
    expect(message?.content).toBe(responseText)
    expect(message?.meta?.insertStatus).not.toBe('applied')
    expect(message?.meta?.insertStatus).not.toBe('failed')
    expect(message?.meta?.insertText).toBeNull()
    expect(message?.meta?.citations).toEqual([])
    expect(message?.meta?.isStreaming).toBe(false)
  })

  it.each([false, true])('executes a requested top-level insert after the example (streamed: %s)', async (streamed) => {
    const example = '```xml\n<insert text="example"/>\n```'
    const responseText = `${example}\n<insert text="Requested note" target_day="2026-07-02"/>`
    mocks.chat.mockImplementation(async ({ onToken }: { onToken?: (chunk: string) => void }) => {
      if (streamed) for (const char of responseText) onToken?.(char)
      return { text: responseText, raw: null }
    })
    const onInsertNote = vi.fn(async () => undefined)
    const { result } = renderHook(() => useChatHarness(onInsertNote))
    await act(async () => {
      await result.current.handleChatSend('Show syntax and add Requested note on July 2')
    })
    expect(onInsertNote).toHaveBeenCalledExactlyOnceWith('2026-07-02', 'Requested note')
    expect(assistantMessage(result.current.messages)?.content).toBe(example)
    expect(assistantMessage(result.current.messages)?.meta?.insertStatus).toBe('applied')
  })
})
