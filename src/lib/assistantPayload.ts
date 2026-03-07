import { parseTaggedAssistantResponse } from './llm/streamTagParser'

type Citation = {
  day: string
  quote: string
}

export type AssistantPayload = {
  answer: string
  citations: Citation[]
  insertText: string | null
  insertTargetDay: string | null
}

export const stripCodeFences = (value: string) => value.replace(/```json\s*/gi, '').replace(/```/g, '').trim()

export const hasAssistantPayloadContent = (payload: AssistantPayload | null) =>
  Boolean(payload && (payload.answer.trim() || payload.citations.length || payload.insertText))

export const parseAssistantPayload = (responseText: string): AssistantPayload | null => {
  const tagged = parseTaggedAssistantResponse(responseText)
  if (!tagged.answer && !tagged.citations.length && !tagged.insertText) {
    return null
  }

  return {
    answer: tagged.answer,
    citations: tagged.citations,
    insertText: tagged.insertText,
    insertTargetDay: tagged.insertTargetDay,
  }
}
