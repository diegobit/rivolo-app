import { parseTaggedAssistantResponse, toCitationMarker } from './llm/streamTagParser'

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

const withLegacyCitationMarkers = (answer: string, citations: Citation[]) => {
  if (!citations.length || /@@CITATION_\d+@@/.test(answer)) {
    return answer
  }

  const markers = citations.map((_, index) => toCitationMarker(index)).join(' ')
  return `${answer.trim()} ${markers}`.trim()
}

const extractFirstJsonObject = (value: string) => {
  let start = -1
  let depth = 0
  let inString = false
  let escaping = false

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]

    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }
      if (char === '\\') {
        escaping = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      if (depth === 0) {
        start = index
      }
      depth += 1
      continue
    }

    if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start !== -1) {
        return value.slice(start, index + 1)
      }
    }
  }

  return null
}

const parseLegacyAssistantPayload = (responseText: string): AssistantPayload | null => {
  const trimmed = responseText.trim()
  const sanitized = stripCodeFences(trimmed)
  const candidates = [trimmed, sanitized]
  const extracted = extractFirstJsonObject(sanitized)

  if (extracted) {
    candidates.push(extracted)
  }

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate) as {
        answer?: unknown
        citations?: unknown
        insert_text?: unknown
        insert_target_day?: unknown
      }

      if (typeof parsed.answer !== 'string') {
        continue
      }

      const citations = Array.isArray(parsed.citations)
        ? parsed.citations.flatMap((citation) => {
            if (!citation || typeof citation !== 'object') {
              return []
            }

            const typedCitation = citation as { day?: unknown; quote?: unknown }
            if (typeof typedCitation.day !== 'string' || typeof typedCitation.quote !== 'string') {
              return []
            }

            return [{ day: typedCitation.day, quote: typedCitation.quote }]
          })
        : undefined

      const insertText =
        typeof parsed.insert_text === 'string' || parsed.insert_text === null ? parsed.insert_text : null

      const insertTargetDay =
        typeof parsed.insert_target_day === 'string' || parsed.insert_target_day === null
          ? parsed.insert_target_day
          : null

      return {
        answer: withLegacyCitationMarkers(parsed.answer, citations ?? []),
        citations: citations ?? [],
        insertText,
        insertTargetDay,
      }
    } catch {
      continue
    }
  }

  return null
}

export const parseAssistantPayload = (responseText: string): AssistantPayload | null => {
  const legacyPayload = parseLegacyAssistantPayload(responseText)
  if (legacyPayload) {
    return legacyPayload
  }

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
