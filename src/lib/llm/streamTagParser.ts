type ParsedTag = {
  name: string
  attributes: Record<string, string>
}

export const CITATION_MARKER_REGEX = /@@CITATION_(\d+)@@/g

export const toCitationMarker = (index: number) => `@@CITATION_${index}@@`

export type StreamTagEvent =
  | {
      type: 'ref'
      day: string
      quote: string
    }
  | {
      type: 'insert'
      text: string
      targetDay: string | null
    }

export type StreamTagPiece =
  | {
      type: 'text'
      value: string
    }
  | {
      type: 'ref'
      day: string
      quote: string
    }
  | {
      type: 'insert'
      text: string
      targetDay: string | null
    }

export type StreamTagParseResult = {
  pieces: StreamTagPiece[]
  textDelta: string
  events: StreamTagEvent[]
}

export type ParsedTaggedAssistantResponse = {
  answer: string
  citations: { day: string; quote: string }[]
  insertText: string | null
  insertTargetDay: string | null
}

const MAX_TAG_LENGTH = 1024
const DAY_ID_REGEX = /^\d{4}-\d{2}-\d{2}$/
const ENTITY_MAP: Record<string, string> = {
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
}

const decodeEntities = (value: string) =>
  value.replace(/&(quot|apos|amp|lt|gt);/g, (entity) => ENTITY_MAP[entity] ?? entity)

const isValidDayId = (value: string) => DAY_ID_REGEX.test(value)

const parseTag = (rawTag: string): ParsedTag | null => {
  const trimmed = rawTag.trim()
  if (!trimmed.startsWith('<') || !trimmed.endsWith('/>')) {
    return null
  }

  const body = trimmed.slice(1, -2).trim()
  if (!body) {
    return null
  }

  const nameMatch = body.match(/^([A-Za-z][A-Za-z0-9_-]*)/)
  if (!nameMatch) {
    return null
  }

  const name = nameMatch[1].toLowerCase()
  let rest = body.slice(nameMatch[0].length)
  const attributes: Record<string, string> = {}

  while (rest.trim().length > 0) {
    const attrMatch = rest.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*"([^"]*)"/)
    if (!attrMatch) {
      return null
    }

    const key = attrMatch[1].toLowerCase()
    if (Object.prototype.hasOwnProperty.call(attributes, key)) {
      return null
    }

    attributes[key] = decodeEntities(attrMatch[2])
    rest = rest.slice(attrMatch[0].length)
  }

  return {
    name,
    attributes,
  }
}

const toEvent = (parsedTag: ParsedTag): StreamTagEvent | null => {
  if (parsedTag.name === 'ref') {
    const day = parsedTag.attributes.day?.trim()
    const quote = parsedTag.attributes.quote?.trim()

    if (!day || !quote || !isValidDayId(day)) {
      return null
    }

    return {
      type: 'ref',
      day,
      quote,
    }
  }

  if (parsedTag.name === 'insert') {
    const text = parsedTag.attributes.text?.trim()
    if (!text) {
      return null
    }

    const targetDayRaw = parsedTag.attributes.target_day?.trim()
    if (!targetDayRaw) {
      return {
        type: 'insert',
        text,
        targetDay: null,
      }
    }

    if (!isValidDayId(targetDayRaw)) {
      return null
    }

    return {
      type: 'insert',
      text,
      targetDay: targetDayRaw,
    }
  }

  return null
}

const emptyResult = (): StreamTagParseResult => ({
  pieces: [],
  textDelta: '',
  events: [],
})

const toPiece = (event: StreamTagEvent): StreamTagPiece => {
  if (event.type === 'ref') {
    return {
      type: 'ref',
      day: event.day,
      quote: event.quote,
    }
  }

  return {
    type: 'insert',
    text: event.text,
    targetDay: event.targetDay,
  }
}

const toResult = (pieces: StreamTagPiece[]): StreamTagParseResult => {
  const textDelta = pieces
    .filter((piece): piece is Extract<StreamTagPiece, { type: 'text' }> => piece.type === 'text')
    .map((piece) => piece.value)
    .join('')

  const events: StreamTagEvent[] = []
  for (const piece of pieces) {
    if (piece.type === 'text') {
      continue
    }

    if (piece.type === 'ref') {
      events.push({
        type: 'ref',
        day: piece.day,
        quote: piece.quote,
      })
      continue
    }

    events.push({
      type: 'insert',
      text: piece.text,
      targetDay: piece.targetDay,
    })
  }

  return {
    pieces,
    textDelta,
    events,
  }
}

export const createStreamTagParser = () => {
  let pendingTag: string | null = null

  const push = (chunk: string): StreamTagParseResult => {
    if (!chunk) {
      return emptyResult()
    }

    const pieces: StreamTagPiece[] = []
    let textBuffer = ''

    const appendText = (value: string) => {
      if (!value) {
        return
      }

      textBuffer += value
    }

    const flushTextBuffer = () => {
      if (!textBuffer) {
        return
      }

      pieces.push({ type: 'text', value: textBuffer })
      textBuffer = ''
    }

    for (const char of chunk) {
      if (pendingTag === null) {
        if (char === '<') {
          pendingTag = '<'
        } else {
          appendText(char)
        }
        continue
      }

      if (char === '<' && pendingTag.length > 1) {
        appendText(pendingTag)
        pendingTag = '<'
        continue
      }

      pendingTag += char

      if (pendingTag.length === 2 && !/[A-Za-z]/.test(char)) {
        appendText(pendingTag)
        pendingTag = null
        continue
      }

      if (char === '\n' || char === '\r') {
        appendText(pendingTag)
        pendingTag = null
        continue
      }

      if (pendingTag.length > MAX_TAG_LENGTH) {
        appendText(pendingTag)
        pendingTag = null
        continue
      }

      if (char !== '>') {
        continue
      }

      const parsedTag = parseTag(pendingTag)
      const event = parsedTag ? toEvent(parsedTag) : null
      if (event) {
        flushTextBuffer()
        pieces.push(toPiece(event))
      } else {
        appendText(pendingTag)
      }
      pendingTag = null
    }

    flushTextBuffer()

    return toResult(pieces)
  }

  const flush = (): StreamTagParseResult => {
    if (!pendingTag) {
      return emptyResult()
    }

    const textDelta = pendingTag
    pendingTag = null

    return toResult([{ type: 'text', value: textDelta }])
  }

  return {
    push,
    flush,
  }
}

export const parseTaggedAssistantResponse = (value: string): ParsedTaggedAssistantResponse => {
  const parser = createStreamTagParser()
  const start = parser.push(value)
  const end = parser.flush()
  const pieces = [...start.pieces, ...end.pieces]
  const answerParts: string[] = []
  const citations: { day: string; quote: string }[] = []
  const citationIndexes = new Map<string, number>()
  let insertText: string | null = null
  let insertTargetDay: string | null = null

  for (const piece of pieces) {
    if (piece.type === 'text') {
      answerParts.push(piece.value)
      continue
    }

    if (piece.type === 'ref') {
      const key = `${piece.day}\u0000${piece.quote}`
      let index = citationIndexes.get(key)
      if (index === undefined) {
        index = citations.length
        citationIndexes.set(key, index)
        citations.push({ day: piece.day, quote: piece.quote })
      }

      answerParts.push(toCitationMarker(index))
      continue
    }

    insertText = piece.text
    insertTargetDay = piece.targetDay
  }

  return {
    answer: answerParts.join('').trim(),
    citations,
    insertText,
    insertTargetDay,
  }
}
