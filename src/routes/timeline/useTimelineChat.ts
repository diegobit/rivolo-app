import { useCallback, useEffect, useRef, useState } from 'react'
import { getTodayId } from '../../lib/dates'
import type { ChatMessage as LlmMessage } from '../../lib/llm'
import { hasAssistantPayloadContent, parseAssistantPayload, stripCodeFences, type AssistantPayload } from '../../lib/assistantPayload'
import { createStreamTagParser, toCitationMarker, type StreamTagPiece } from '../../lib/llm/streamTagParser'
import { DAILY_ANALYST_SYSTEM_PROMPT } from '../../lib/llm/systemPrompts'
import { validateActiveLlmConfig, type ActiveLlmConfig } from '../../lib/llm/types'
import { buildContextDays, formatContext } from '../../lib/llmContext'
import type { ChatCitation as Citation, ChatUiMessage } from '../../store/useChatStore'

type SetMessages = (updater: (state: ChatUiMessage[]) => ChatUiMessage[]) => void

type UseTimelineChatParams = {
  messages: ChatUiMessage[]
  setMessages: SetMessages
  aiLanguage: string
  allowWebSearch: boolean
  activeLlmConfig: ActiveLlmConfig
  isNarrowViewport: boolean
  chatPanelOpen: boolean
  desktopChatPanelOpen: boolean
  setChatPanelOpen: (open: boolean) => void
  setDesktopChatPanelOpen: (open: boolean) => void
  onInsertNote: (targetDay: string, text: string) => Promise<void>
}

const normalizeCitationText = (value: string) =>
  value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

export const useTimelineChat = ({
  messages,
  setMessages,
  aiLanguage,
  allowWebSearch,
  activeLlmConfig,
  isNarrowViewport,
  chatPanelOpen,
  desktopChatPanelOpen,
  setChatPanelOpen,
  setDesktopChatPanelOpen,
  onInsertNote,
}: UseTimelineChatParams) => {
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const messagesRef = useRef<ChatUiMessage[]>([])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const handleChatSend = useCallback(
    async (draft: string) => {
      const trimmed = draft.trim()
      if (!trimmed) return

      if (isNarrowViewport && !chatPanelOpen) {
        setChatPanelOpen(true)
      }

      if (!isNarrowViewport && !desktopChatPanelOpen) {
        setDesktopChatPanelOpen(true)
      }

      setChatError(null)

      const configError = validateActiveLlmConfig(activeLlmConfig)
      if (configError) {
        setChatError(configError)
        return
      }
      const requestConfig = { ...activeLlmConfig } as ActiveLlmConfig

      const userMessage: ChatUiMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed,
      }

      const assistantId = crypto.randomUUID()
      const assistantMessage: ChatUiMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        meta: { citations: [], isStreaming: true },
      }

      setMessages((state) => [...state, userMessage, assistantMessage])
      setSending(true)

      const currentMessages = [...messagesRef.current, userMessage].map((message) => ({
        role: message.role,
        content: message.content,
      })) as LlmMessage[]
      const streamedCitations: Citation[] = []
      const streamedCitationIndexes = new Map<string, number>()
      const streamedInserts: AssistantPayload['inserts'] = []
      let streamedAnswer = ''
      let pendingStreamText = ''
      let pendingStreamMetaChanged = false
      let streamUpdateFrame: number | null = null

      const flushStreamUpdate = () => {
        const textDelta = pendingStreamText
        const metaChanged = pendingStreamMetaChanged
        pendingStreamText = ''
        pendingStreamMetaChanged = false

        if (!textDelta && !metaChanged) {
          return
        }

        setMessages((state) =>
          state.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: textDelta ? `${message.content}${textDelta}` : message.content,
                  meta: {
                    citations: [...streamedCitations],
                    isStreaming: true,
                  },
                }
              : message,
          ),
        )
      }

      const cancelScheduledStreamUpdate = () => {
        if (streamUpdateFrame === null) {
          return
        }

        window.cancelAnimationFrame(streamUpdateFrame)
        streamUpdateFrame = null
      }

      const scheduleStreamUpdate = () => {
        if (streamUpdateFrame !== null) {
          return
        }

        streamUpdateFrame = window.requestAnimationFrame(() => {
          streamUpdateFrame = null
          flushStreamUpdate()
        })
      }

      const queueStreamUpdate = (textDelta: string, metaChanged: boolean) => {
        if (textDelta) {
          pendingStreamText += textDelta
        }
        if (metaChanged) {
          pendingStreamMetaChanged = true
        }
        scheduleStreamUpdate()
      }

      try {
        const { chat } = await import('../../lib/llm')
        const contextDays = await buildContextDays(trimmed)
        const contextText = formatContext(contextDays)
        const contextMap = new Map(contextDays.map((day) => [day.dayId, day.contentMd]))

        const languageInstruction =
          aiLanguage === 'follow' ? 'Reply in the same language the user writes in.' : `Always reply in ${aiLanguage}.`

        const date = new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: '2-digit',
          year: 'numeric',
          weekday: 'long',
        })

        const llmMessages = [
          {
            role: 'system' as const,
            content: `${DAILY_ANALYST_SYSTEM_PROMPT}\n\n<user_notes>\n${contextText}\n</user_notes>\n\nToday is ${date}.\nGiven the user's notes above, answer their question accurately and concisely. ${languageInstruction}`,
          },
          ...currentMessages,
        ]

        console.info('[LLM Request]', {
          provider: requestConfig.provider,
          model: requestConfig.model,
          messageCount: llmMessages.length,
          contextDays: contextDays.length,
          contextChars: contextText.length,
          userChars: trimmed.length,
        })

        const streamTagParser = createStreamTagParser()
        const applyStreamTagPieces = (pieces: StreamTagPiece[]) => {
          if (!pieces.length) {
            return
          }

          let textDelta = ''
          let metaChanged = false

          for (const piece of pieces) {
            if (piece.type === 'text') {
              textDelta += piece.value
              continue
            }

            if (piece.type === 'ref') {
              const key = `${piece.day}\u0000${piece.quote}`
              let citationIndex = streamedCitationIndexes.get(key)
              if (citationIndex === undefined) {
                citationIndex = streamedCitations.length
                streamedCitationIndexes.set(key, citationIndex)
                streamedCitations.push({ day: piece.day, quote: piece.quote })
                metaChanged = true
              }

              textDelta += toCitationMarker(citationIndex)
              continue
            }

            streamedInserts.push({ text: piece.text, targetDay: piece.targetDay })
          }

          if (textDelta) {
            streamedAnswer += textDelta
          }

          if (!textDelta && !metaChanged) {
            return
          }

          queueStreamUpdate(textDelta, metaChanged)
        }

        const { text: responseText } = await chat({
          config: requestConfig,
          messages: llmMessages,
          allowWebSearch,
          temperature: 0,
          stream: true,
          onToken: (chunk) => {
            const parsedChunk = streamTagParser.push(chunk)
            applyStreamTagPieces(parsedChunk.pieces)
          },
        })

        const finalStreamChunk = streamTagParser.flush()
        applyStreamTagPieces(finalStreamChunk.pieces)
        cancelScheduledStreamUpdate()
        flushStreamUpdate()

        let finalResponseText = responseText
        let payload: AssistantPayload | null = null

        if (streamedAnswer.trim() || streamedCitations.length || streamedInserts.length) {
          payload = {
            answer: streamedAnswer.trim(),
            citations: streamedCitations,
            inserts: streamedInserts,
          }
        }

        if (!payload) {
          payload = parseAssistantPayload(responseText)
        }

        const sanitized = stripCodeFences(responseText)
        console.info('[LLM Response]', {
          chars: responseText.length,
          sanitizedChars: sanitized.length,
          streamedChars: streamedAnswer.length,
        })

        if (hasAssistantPayloadContent(payload)) {
          console.info('[LLM Parsed]', { hasCitations: Boolean(payload?.citations.length) })
        } else {
          console.error('[LLM Parse Error]', { chars: sanitized.length })

          try {
            const { text: retryText } = await chat({
              config: requestConfig,
              messages: llmMessages,
              allowWebSearch,
              temperature: 0,
              stream: false,
            })

            finalResponseText = retryText
            payload = parseAssistantPayload(retryText)

            if (hasAssistantPayloadContent(payload)) {
              console.info('[LLM Retry Parsed]', { hasCitations: Boolean(payload?.citations.length) })
            } else {
              console.error('[LLM Retry Parse Error]', { chars: stripCodeFences(retryText).length })
            }
          } catch (retryError) {
            console.error('[LLM Retry Error]', retryError)
          }
        }

        const citations = (payload?.citations ?? []).filter((citation) => {
          const content = contextMap.get(citation.day)
          if (!content) return false

          if (content.includes(citation.quote)) {
            return true
          }

          const normalizedQuote = normalizeCitationText(citation.quote)
          if (!normalizedQuote) {
            return false
          }

          const normalizedContent = normalizeCitationText(content)
          return normalizedContent.includes(normalizedQuote)
        })

        const parsedFallback = parseAssistantPayload(finalResponseText || responseText)
        const fallbackAnswer = parsedFallback?.answer ?? stripCodeFences(finalResponseText || responseText)
        const inserts = payload?.inserts ?? []
        const insert = inserts.length === 1 ? inserts[0] : null
        const insertTargetDay = insert ? (insert.targetDay ?? getTodayId()) : null
        let insertStatus: 'applied' | 'failed' | undefined

        if (inserts.length > 1) {
          setChatError('The assistant returned multiple insert actions, so nothing was added.')
        } else if (insert && insertTargetDay) {
          try {
            await onInsertNote(insertTargetDay, insert.text.trim())
            insertStatus = 'applied'
          } catch (insertError) {
            insertStatus = 'failed'
            setChatError(insertError instanceof Error ? insertError.message : 'The note could not be updated.')
          }
        }

        setMessages((state) =>
          state.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: payload?.answer ?? fallbackAnswer ?? responseText,
                  meta: {
                    citations,
                    insertText: insert?.text ?? null,
                    insertTargetDay,
                    insertStatus,
                    isStreaming: false,
                  },
                }
              : message,
          ),
        )
      } catch (error) {
        cancelScheduledStreamUpdate()
        flushStreamUpdate()
        setMessages((state) =>
          state.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  meta: {
                    citations: message.meta?.citations ?? [],
                    insertText: message.meta?.insertText ?? null,
                    insertTargetDay: message.meta?.insertTargetDay ?? null,
                    isStreaming: false,
                  },
                }
              : message,
          ),
        )
        setChatError(error instanceof Error ? error.message : 'LLM request failed.')
      } finally {
        setSending(false)
      }
    },
    [
      aiLanguage,
      activeLlmConfig,
      allowWebSearch,
      chatPanelOpen,
      desktopChatPanelOpen,
      isNarrowViewport,
      onInsertNote,
      setDesktopChatPanelOpen,
      setChatPanelOpen,
      setMessages,
    ],
  )

  const handleChatInsert = useCallback(
    async (message: ChatUiMessage) => {
      const insertText = message.meta?.insertText
      if (!insertText || message.meta?.insertStatus !== 'failed') return

      const targetDay = message.meta?.insertTargetDay ?? getTodayId()
      setChatError(null)
      setMessages((state) =>
        state.map((item) =>
          item.id === message.id
            ? { ...item, meta: { ...item.meta!, insertStatus: 'applying' } }
            : item,
        ),
      )

      try {
        await onInsertNote(targetDay, insertText.trim())
        setMessages((state) =>
          state.map((item) =>
            item.id === message.id
              ? { ...item, meta: { ...item.meta!, insertStatus: 'applied' } }
              : item,
          ),
        )
      } catch (insertError) {
        setMessages((state) =>
          state.map((item) =>
            item.id === message.id
              ? { ...item, meta: { ...item.meta!, insertStatus: 'failed' } }
              : item,
          ),
        )
        setChatError(insertError instanceof Error ? insertError.message : 'The note could not be updated.')
      }
    },
    [onInsertNote, setMessages],
  )

  const handleNewChat = useCallback(() => {
    if (sending) return

    setMessages(() => [])
    messagesRef.current = []
    setChatError(null)

    if (isNarrowViewport) {
      setChatPanelOpen(false)
      document.getElementById('chat-input')?.blur()
    }
  }, [isNarrowViewport, sending, setChatPanelOpen, setMessages])

  return {
    sending,
    chatError,
    handleChatSend,
    handleChatInsert,
    handleNewChat,
  }
}
