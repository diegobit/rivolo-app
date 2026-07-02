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
