import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCitationIndexFromTarget, renderAssistantMarkdown } from '../../lib/assistantMarkdown'
import { getTodayId } from '../../lib/dates'
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

  it('applies nothing when an insert targets an invalid calendar date', async () => {
    mocks.chat.mockResolvedValue({
      text: '<insert text="Buy milk" target_day="2026-02-30"/>',
      raw: null,
    })
    const onInsertNote = vi.fn(async () => undefined)
    const { result } = renderHook(() => useChatHarness(onInsertNote))

    await act(async () => {
      await result.current.handleChatSend('Add milk')
    })

    expect(onInsertNote).not.toHaveBeenCalled()
    expect(assistantMessage(result.current.messages)?.meta?.insertText).toBeNull()
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

  it('surfaces a failed retry through the same visible error path as a first-send failure', async () => {
    mocks.chat
      .mockResolvedValueOnce({ text: '', raw: null })
      .mockRejectedValueOnce(new Error('Provider unavailable'))
    const onInsertNote = vi.fn(async () => undefined)
    const { result } = renderHook(() => useChatHarness(onInsertNote))

    await act(async () => {
      await result.current.handleChatSend('hello')
    })

    expect(mocks.chat).toHaveBeenCalledTimes(2)
    expect(result.current.chatError).toBe('Provider unavailable')
    expect(assistantMessage(result.current.messages)?.meta?.isStreaming).toBe(false)
    expect(result.current.sending).toBe(false)
  })
})

describe.each(['final response', 'streamed chunks', 'retry response'] as const)(
  'useTimelineChat citation grounding with %s',
  (delivery) => {
    beforeEach(() => {
      vi.clearAllMocks()
      mocks.buildContextDays.mockResolvedValue([
        { dayId: '2026-09-05', contentMd: 'grounded quote and another source' },
      ])
    })

    const cases = [
      {
        name: 'keeps valid citations attached to their original claims after grounding validation',
        claims: [
          { text: 'False claim', quote: 'fabricated', expectedQuote: null },
          { text: 'True claim', quote: 'grounded quote', expectedQuote: 'grounded quote' },
        ],
      },
      {
        name: 'keeps citations on both sides of an invalid middle reference',
        claims: [
          { text: 'First claim', quote: 'grounded quote', expectedQuote: 'grounded quote' },
          { text: 'False claim', quote: 'fabricated', expectedQuote: null },
          { text: 'Last claim', quote: 'another source', expectedQuote: 'another source' },
        ],
      },
      {
        name: 'keeps repeated valid references attached to the same citation',
        claims: [
          { text: 'False claim', quote: 'fabricated', expectedQuote: null },
          { text: 'True claim', quote: 'grounded quote', expectedQuote: 'grounded quote' },
          { text: 'Repeated claim', quote: 'grounded quote', expectedQuote: 'grounded quote' },
        ],
      },
      {
        name: 'removes all citation markers when every reference fails grounding',
        claims: [
          { text: 'False claim', quote: 'fabricated', expectedQuote: null },
          { text: 'Another false claim', quote: 'also fabricated', expectedQuote: null },
        ],
      },
    ]

    it.each(cases)('$name', async ({ claims }) => {
      const responseText = claims
        .map(({ text, quote }) => `${text} <ref day="2026-09-05" quote="${quote}"/>`)
        .join('\n')
      if (delivery === 'retry response') {
        mocks.chat.mockResolvedValueOnce({ text: '', raw: null })
      }
      mocks.chat.mockImplementation(async ({ onToken }: { onToken?: (chunk: string) => void }) => {
        if (delivery === 'streamed chunks') {
          for (let offset = 0; offset < responseText.length; offset += 7) {
            onToken?.(responseText.slice(offset, offset + 7))
          }
        }
        return { text: responseText, raw: null }
      })
      const { result } = renderHook(() => useChatHarness(vi.fn(async () => undefined)))

      await act(async () => {
        await result.current.handleChatSend('Summarize my notes')
      })

      expect(result.current.chatError).toBeNull()
      expect(mocks.chat).toHaveBeenCalledTimes(delivery === 'retry response' ? 2 : 1)
      const message = assistantMessage(result.current.messages)!
      const citations = message.meta!.citations
      const expectedQuotes = [...new Set(claims.flatMap(({ expectedQuote }) =>
        expectedQuote === null ? [] : [expectedQuote],
      ))]
      expect(citations).toEqual(expectedQuotes.map((quote) => ({ day: '2026-09-05', quote })))
      expect(message.meta?.isStreaming).toBe(false)

      const rendered = document.createElement('div')
      rendered.innerHTML = renderAssistantMarkdown(message.content, citations)
      const paragraphs = rendered.querySelectorAll('p')
      expect(paragraphs).toHaveLength(claims.length)
      claims.forEach(({ text, expectedQuote }, index) => {
        const paragraph = paragraphs[index]
        expect(paragraph.textContent).toContain(text)
        const chips = paragraph.querySelectorAll<HTMLElement>('[data-citation-index]')
        expect(chips).toHaveLength(expectedQuote === null ? 0 : 1)
        if (expectedQuote !== null) {
          const chip = chips[0]
          expect(chip.title).toBe(`2026-09-05\n${expectedQuote}`)
          const citationIndex = getCitationIndexFromTarget(chip)
          expect(citationIndex).toBe(expectedQuotes.indexOf(expectedQuote))
          expect(citations[citationIndex!]).toEqual({ day: '2026-09-05', quote: expectedQuote })
        }
      })
      if (expectedQuotes.length === 0) {
        expect(message.content).not.toContain('@@CITATION_')
      }
    })
  },
)
