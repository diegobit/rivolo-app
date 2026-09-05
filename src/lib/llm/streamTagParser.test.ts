import { describe, expect, it } from 'vitest'
import { createStreamTagParser, parseTaggedAssistantResponse } from './streamTagParser'

describe('streamTagParser insert actions', () => {
  it('parses one insert action', () => {
    expect(
      parseTaggedAssistantResponse(
        'Done. <insert text="Buy milk" target_day="2026-07-02"/>',
      ),
    ).toMatchObject({
      answer: 'Done.',
      inserts: [{ text: 'Buy milk', targetDay: '2026-07-02' }],
    })
  })

  it('parses an insert action split across stream chunks', () => {
    const parser = createStreamTagParser()
    const events = [
      ...parser.push('Done. <ins').events,
      ...parser.push('ert text="Chunked" target_').events,
      ...parser.push('day="2026-07-02"/>').events,
      ...parser.flush().events,
    ]

    expect(events).toEqual([
      { type: 'insert', text: 'Chunked', targetDay: '2026-07-02' },
    ])
  })

  it('preserves every insert action so callers can enforce cardinality', () => {
    const parsed = parseTaggedAssistantResponse(
      '<insert text="One" target_day="2026-07-02"/> <insert text="Two" target_day="2026-07-03"/>',
    )

    expect(parsed.inserts).toEqual([
      { text: 'One', targetDay: '2026-07-02' },
      { text: 'Two', targetDay: '2026-07-03' },
    ])
  })

  it('does not turn a nested tag into an insert action', () => {
    const parsed = parseTaggedAssistantResponse(
      '<insert text="Buy milk <ref day="2026-07-01" quote="milk"/>" target_day="2026-07-02"/>',
    )

    expect(parsed.inserts).toEqual([])
  })
})

describe('streamTagParser calendar validation', () => {
  it.each([
    '2026-02-30',
    '2026-00-10',
    '2026-13-10',
    '2026-99-10',
    '2026-01-00',
    '2027-02-29',
  ])('rejects invalid ref and insert dates %s in whole responses', (dayId) => {
    const parsed = parseTaggedAssistantResponse(
      `<ref day="${dayId}" quote="Quote"/> <insert text="Note" target_day="${dayId}"/>`,
    )

    expect(parsed.citations).toEqual([])
    expect(parsed.inserts).toEqual([])
  })

  it('rejects invalid dates when tags are split across chunks', () => {
    const parser = createStreamTagParser()
    const events = [
      ...parser.push('<ref day="2026-02').events,
      ...parser.push('-30" quote="Quote"/> <insert text="Note" target_').events,
      ...parser.push('day="2026-99-99"/>').events,
      ...parser.flush().events,
    ]

    expect(events).toEqual([])
  })

  it.each(['2026-01-01', '2026-12-31', '2028-02-29'])(
    'preserves valid ref and insert date %s',
    (dayId) => {
      const parsed = parseTaggedAssistantResponse(
        `<ref day="${dayId}" quote="Quote"/> <insert text="Note" target_day="${dayId}"/>`,
      )

      expect(parsed.citations).toEqual([{ day: dayId, quote: 'Quote' }])
      expect(parsed.inserts).toEqual([{ text: 'Note', targetDay: dayId }])
    },
  )
})

const literalExamples = [
  'Example syntax:\n```xml\n<insert text="unrequested mutation"/>\n```',
  'Use `<insert text="example"/>` and `<ref day="2026-07-01" quote="example"/>`.',
  '```xml\n<insert text="unclosed fence"/>',
  '  ```xml\n<ref day="2026-07-01" quote="example"/>\n  ```',
  '``<insert text="example with ` inside"/>``',
  '````xml\n```\n<insert text="shorter fence is literal"/>\n````',
  '```xml\n<insert text="example"/>\n``` <insert text="closing line stays literal"/>',
  '`<insert text="unclosed inline"/>',
]

describe('streamTagParser literal code', () => {
  it.each(literalExamples)('preserves literal examples at every chunk boundary: %s', (input) => {
    expect(parseTaggedAssistantResponse(input)).toEqual({
      answer: input.trim(), citations: [], inserts: [],
    })
    for (let split = 0; split <= input.length; split += 1) {
      const parser = createStreamTagParser()
      const results = [parser.push(input.slice(0, split)), parser.push(input.slice(split)), parser.flush()]
      expect(results.flatMap((result) => result.events)).toEqual([])
      expect(results.map((result) => result.textDelta).join('')).toBe(input)
    }
    const parser = createStreamTagParser()
    const results = [...Array.from(input, (char) => parser.push(char)), parser.flush()]
    expect(results.flatMap((result) => result.events)).toEqual([])
    expect(results.map((result) => result.textDelta).join('')).toBe(input)
  })

  it('keeps event order and normal actions after closed code across all boundaries', () => {
    const example = '```xml\n<insert text="example"/>\n```\n'
    const input = `${example}<insert text="Requested &amp; valid"/> <ref day="2026-07-01" quote="Real"/>`
    for (let split = 0; split <= input.length; split += 1) {
      const parser = createStreamTagParser()
      const results = [parser.push(input.slice(0, split)), parser.push(input.slice(split)), parser.flush()]
      const pieces = results.flatMap((result) => result.pieces)
      const normalized = pieces.reduce<typeof pieces>((combined, piece) => {
        const last = combined.at(-1)
        if (last?.type === 'text' && piece.type === 'text') last.value += piece.value
        else combined.push({ ...piece })
        return combined
      }, [])
      expect(normalized).toEqual([
        { type: 'text', value: example },
        { type: 'insert', text: 'Requested & valid', targetDay: null },
        { type: 'text', value: ' ' },
        { type: 'ref', day: '2026-07-01', quote: 'Real' },
      ])
    }
  })

  it('allows top-level actions after inline code and keeps backticks in tag attributes', () => {
    expect(parseTaggedAssistantResponse('`<insert text="example"/>` <insert text="Use `npm`"/>'))
      .toEqual({ answer: '`<insert text="example"/>`', citations: [], inserts: [{ text: 'Use `npm`', targetDay: null }] })
  })
})
