import { parseTaggedAssistantResponse } from './llm/streamTagParser'

type Citation = {
  day: string
  quote: string
}

export type AssistantPayload = {
  answer: string
  citations: Citation[]
  inserts: { text: string; targetDay: string | null }[]
}

export const stripCodeFences = (value: string) => value.replace(/```json\s*/gi, '').replace(/```/g, '').trim()

export const hasAssistantPayloadContent = (payload: AssistantPayload | null) =>
  Boolean(payload && (payload.answer.trim() || payload.citations.length || payload.inserts.length))

export const parseAssistantPayload = (responseText: string): AssistantPayload | null => {
  const tagged = parseTaggedAssistantResponse(responseText)
  if (!tagged.answer && !tagged.citations.length && !tagged.inserts.length) {
    return null
  }

  return {
    answer: tagged.answer,
    citations: tagged.citations,
    inserts: tagged.inserts,
  }
}
