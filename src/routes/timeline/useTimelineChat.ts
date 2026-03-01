import { useCallback, useEffect, useRef, useState } from 'react'
import { appendToDay } from '../../lib/dayRepository'
import { getTodayId } from '../../lib/dates'
import { chat, type ChatMessage as LlmMessage } from '../../lib/llm'
import { hasAssistantPayloadContent, parseAssistantPayload, stripCodeFences, type AssistantPayload } from '../../lib/assistantPayload'
import { createStreamTagParser, toCitationMarker, type StreamTagPiece } from '../../lib/llm/streamTagParser'
import { buildContextDays, formatContext } from '../../lib/llmContext'
import type { ChatCitation as Citation, ChatUiMessage } from '../../store/useChatStore'

const SYSTEM_PROMPT = `You are the Daily Notes Analyst, an expert in parsing, retrieving, and synthesizing information from the user's chronological daily notes. Your data source is a collection of daily entries organized by date.

### Core Responsibilities
1. **Chronological Navigation**: Accurately interpret relative dates (e.g., 'yesterday', 'last Tuesday', 'three days ago') based on the current date. Locate specific entries based on day IDs.
2. **Content Extraction**: Retrieve specific details such as meeting notes, decisions made, thoughts recorded, or tasks logged on specific days.
3. **Task Management**: Identify and list user tasks, distinguishing between completed (\`[x]\`) and incomplete (\`[ ]\`) items across days.
4. **Pattern Recognition**: Connect related information across different dates to provide comprehensive answers (e.g., tracking a topic or project over time).

### Operational Guidelines
- **Entry Structure**: Each entry is identified by a day ID in \`YYYY-MM-DD\` format.
- **Citation Required**: When providing answers, always reference the specific day(s) where information was found using exact quotes.
- **Context Awareness**: Pay attention to the current date provided in the context to correctly interpret relative date references.
- **Search Strategy**: For topic-specific queries, aggregate findings chronologically across all relevant days.

### Interaction Style
- Be concise and organized.
- Use bullet points to list items like todos or highlights.
- If a requested date has no entry, explicitly state that no notes were found for that day.

### Response Format
Reply in plain Markdown text.

When citing notes, include self-closing reference tags anywhere in the response:
<ref day="YYYY-MM-DD" quote="exact substring"/>

When the user asks to append content into notes, optionally include one self-closing insert tag:
<insert text="text to append" target_day="YYYY-MM-DD"/>

Rules:
- Only use these tags: <ref .../> and <insert .../>.
- Keep tags self-closing; do not use closing tags or nesting.
- Keep normal prose outside tags.
- Escape literal < and > in prose as &lt; and &gt;.
- Quotes in attributes must be exact substrings from the cited day. If unsure, omit the citation tag.`

type SetMessages = (updater: (state: ChatUiMessage[]) => ChatUiMessage[]) => void

type UseTimelineChatParams = {
  messages: ChatUiMessage[]
  setMessages: SetMessages
  aiLanguage: string
  allowThinking: boolean
  allowWebSearch: boolean
  geminiApiKey: string | null
  geminiModel: string
  isNarrowViewport: boolean
  chatPanelOpen: boolean
  desktopChatPanelOpen: boolean
  setChatPanelOpen: (open: boolean) => void
  setDesktopChatPanelOpen: (open: boolean) => void
  loadTimeline: () => Promise<void>
  handleAutoPush: () => Promise<void>
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
  allowThinking,
  allowWebSearch,
  geminiApiKey,
  geminiModel,
  isNarrowViewport,
  chatPanelOpen,
  desktopChatPanelOpen,
  setChatPanelOpen,
  setDesktopChatPanelOpen,
  loadTimeline,
  handleAutoPush,
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

      if (!geminiApiKey) {
        setChatError('Add a Gemini API key in Settings first.')
        return
      }

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

      try {
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
            content: `${SYSTEM_PROMPT}\n\n<user_notes>\n${contextText}\n</user_notes>\n\nToday is ${date}.\nGiven the user's notes above, answer their question accurately and concisely. ${languageInstruction}`,
          },
          ...currentMessages,
        ]

        console.info('[LLM Request]', {
          messageCount: llmMessages.length,
          contextDays: contextDays.length,
          contextChars: contextText.length,
          userChars: trimmed.length,
        })

        const streamTagParser = createStreamTagParser()
        const streamedCitations: Citation[] = []
        const streamedCitationIndexes = new Map<string, number>()
        let streamedInsertText: string | null = null
        let streamedInsertTargetDay: string | null = null
        let streamedAnswer = ''

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

            const changedInsert =
              streamedInsertText !== piece.text || streamedInsertTargetDay !== piece.targetDay
            streamedInsertText = piece.text
            streamedInsertTargetDay = piece.targetDay
            if (changedInsert) {
              metaChanged = true
            }
          }

          if (textDelta) {
            streamedAnswer += textDelta
          }

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
                      insertText: streamedInsertText,
                      insertTargetDay: streamedInsertTargetDay,
                      isStreaming: true,
                    },
                  }
                : message,
            ),
          )
        }

        const { text: responseText } = await chat({
          provider: 'gemini',
          apiKey: geminiApiKey,
          model: geminiModel,
          messages: llmMessages,
          allowThinking,
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

        let finalResponseText = responseText
        let payload: AssistantPayload | null = null

        if (streamedAnswer.trim() || streamedCitations.length || streamedInsertText) {
          payload = {
            answer: streamedAnswer.trim(),
            citations: streamedCitations,
            insertText: streamedInsertText,
            insertTargetDay: streamedInsertTargetDay,
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
          console.error('[LLM Parse Error]', { preview: sanitized.slice(0, 200) })

          try {
            const { text: retryText } = await chat({
              provider: 'gemini',
              apiKey: geminiApiKey,
              model: geminiModel,
              messages: llmMessages,
              allowThinking,
              allowWebSearch,
              temperature: 0,
              stream: false,
            })

            finalResponseText = retryText
            payload = parseAssistantPayload(retryText)

            if (hasAssistantPayloadContent(payload)) {
              console.info('[LLM Retry Parsed]', { hasCitations: Boolean(payload?.citations.length) })
            } else {
              console.error('[LLM Retry Parse Error]', { preview: stripCodeFences(retryText).slice(0, 200) })
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

        setMessages((state) =>
          state.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: payload?.answer || fallbackAnswer || responseText,
                  meta: {
                    citations,
                    insertText: payload?.insertText ?? null,
                    insertTargetDay: payload?.insertTargetDay ?? null,
                    isStreaming: false,
                  },
                }
              : message,
          ),
        )
      } catch (error) {
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
      allowThinking,
      allowWebSearch,
      chatPanelOpen,
      desktopChatPanelOpen,
      geminiApiKey,
      geminiModel,
      isNarrowViewport,
      setDesktopChatPanelOpen,
      setChatPanelOpen,
      setMessages,
    ],
  )

  const handleChatInsert = useCallback(
    async (message: ChatUiMessage) => {
      const insertText = message.meta?.insertText
      if (!insertText) return

      const targetDay = message.meta?.insertTargetDay ?? getTodayId()
      const payload = `${insertText.trim()}`
      await appendToDay(targetDay, payload)
      await loadTimeline()
      await handleAutoPush()
    },
    [handleAutoPush, loadTimeline],
  )

  return {
    sending,
    chatError,
    handleChatSend,
    handleChatInsert,
  }
}
