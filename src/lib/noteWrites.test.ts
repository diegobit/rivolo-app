import { describe, expect, it } from 'vitest'
import { formatDayTitle } from './dates'
import { exportMarkdown, parseMarkdown } from './markdown'
import { addToDay, MAX_NOTE_WRITE_CHARS } from './noteWrites'
import type { Day } from './notesCore'

const NOW = 200

const makeDay = (contentMd: string): Day => ({
  dayId: '2026-07-16',
  humanTitle: 'Existing title',
  contentMd,
  createdAt: 100,
  updatedAt: 100,
})

const makeInput = (overrides: Partial<Parameters<typeof addToDay>[1]> = {}) => ({
  day_id: '2026-07-16',
  content_md: 'New note',
  operation_id: 'operation-1',
  ...overrides,
})

describe('addToDay', () => {
  it('appends by default without mutating the input days', () => {
    const original = makeDay('Existing note')
    const days = [original]

    const result = addToDay(days, makeInput(), { now: NOW })

    expect(result).toEqual({
      days: [
        {
          ...original,
          contentMd: 'Existing note\n\nNew note',
          updatedAt: NOW,
        },
      ],
      day: {
        ...original,
        contentMd: 'Existing note\n\nNew note',
        updatedAt: NOW,
      },
      created: false,
      position: 'append',
      operation_id: 'operation-1',
    })
    expect(days).toEqual([original])
    expect(result.days).not.toBe(days)
  })

  it('prepends content while preserving the existing title and creation timestamp', () => {
    const original = makeDay('Existing note')

    const result = addToDay(
      [original],
      makeInput({ position: 'prepend' }),
      { now: NOW },
    )

    expect(result.day).toEqual({
      ...original,
      contentMd: 'New note\n\nExisting note',
      updatedAt: NOW,
    })
    expect(result.position).toBe('prepend')
  })

  it('creates a missing day with its normal human title', () => {
    const result = addToDay(
      [makeDay('Existing note')],
      makeInput({
        day_id: '2026-07-17',
        content_md: 'First note',
        operation_id: 'operation-2',
      }),
      { now: NOW },
    )

    expect(result.created).toBe(true)
    expect(result.day).toEqual({
      dayId: '2026-07-17',
      humanTitle: formatDayTitle('2026-07-17'),
      contentMd: 'First note',
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(result.days).toHaveLength(2)
  })

  it('normalizes outer blank lines and uses one blank line at the join boundary', () => {
    const result = addToDay(
      [makeDay('\nExisting line\n\n\n')],
      makeInput({ content_md: '\n\n  indented line  \nsecond line\n\n' }),
      { now: NOW },
    )

    expect(result.day.contentMd).toBe(
      'Existing line\n\n  indented line  \nsecond line',
    )
  })

  it('handles adding content to an existing empty day', () => {
    const result = addToDay(
      [makeDay(' \n\n')],
      makeInput({ position: 'prepend', content_md: '\nNew note\n' }),
      { now: NOW },
    )

    expect(result.day.contentMd).toBe('New note')
  })

  it('carries a trimmed operation ID without writing it into note content', () => {
    const result = addToDay(
      [makeDay('Existing note')],
      makeInput({ operation_id: '  operation-3  ' }),
      { now: NOW },
    )

    expect(result.operation_id).toBe('operation-3')
    expect(result.day.contentMd).toBe('Existing note\n\nNew note')
    expect(result.day.contentMd).not.toContain('operation-3')
  })

  it('round-trips marker-like added content through the shared markdown format', () => {
    const markerExample = [
      'Example:',
      '```md',
      '<!-- day:2026-01-01 -->',
      '```',
    ].join('\n')
    const result = addToDay(
      [makeDay('Existing note')],
      makeInput({ content_md: markerExample }),
      { now: NOW },
    )

    const parsed = parseMarkdown(exportMarkdown(result.days))

    expect(parsed.warnings).toEqual([])
    expect(parsed.days).toEqual([
      expect.objectContaining({
        dayId: '2026-07-16',
        humanTitle: 'Existing title',
        contentMd: `Existing note\n\n${markerExample}`,
      }),
    ])
  })

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-7-16',
    'not-a-date',
  ])('rejects invalid day ID %s', (day_id) => {
    expect(() => addToDay([], makeInput({ day_id }), { now: NOW })).toThrow(
      'day_id must be a valid calendar date in YYYY-MM-DD format.',
    )
  })

  it.each(['', '   ', '\n\t\n'])('rejects empty content', (content_md) => {
    expect(() => addToDay([], makeInput({ content_md }), { now: NOW })).toThrow(
      'content_md must not be empty.',
    )
  })

  it('rejects oversized content', () => {
    expect(() =>
      addToDay(
        [],
        makeInput({ content_md: 'a'.repeat(MAX_NOTE_WRITE_CHARS + 1) }),
        { now: NOW },
      ),
    ).toThrow(`content_md must be ${MAX_NOTE_WRITE_CHARS} characters or fewer.`)
  })

  it('allows content exactly at the size limit', () => {
    const content_md = 'a'.repeat(MAX_NOTE_WRITE_CHARS)

    expect(
      addToDay([], makeInput({ content_md }), { now: NOW }).day.contentMd,
    ).toHaveLength(MAX_NOTE_WRITE_CHARS)
  })

  it('rejects an empty operation ID', () => {
    expect(() =>
      addToDay([], makeInput({ operation_id: '  ' }), { now: NOW }),
    ).toThrow('operation_id must not be empty.')
  })

  it('rejects an unsupported position at the runtime boundary', () => {
    expect(() =>
      addToDay(
        [],
        makeInput({ position: 'replace' as 'append' }),
        { now: NOW },
      ),
    ).toThrow('position must be append or prepend.')
  })
})
