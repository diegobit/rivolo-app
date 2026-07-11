import { describe, expect, it } from 'vitest'
import { formatDayTitle } from './dates'
import { exportMarkdown, parseMarkdown } from './markdown'
import type { Day } from './notesCore'

const ESCAPE_PREFIX = '<!-- rivolo:escaped-content -->'

const makeDay = (contentMd: string): Day => ({
  dayId: '2026-07-11',
  humanTitle: 'Saturday notes',
  contentMd,
  createdAt: 1,
  updatedAt: 1,
})

describe('Markdown day markers', () => {
  it('round-trips literal marker examples without treating them as day boundaries', () => {
    const contentMd = [
      'Example:',
      '```md',
      '<!-- day:2026-01-01 -->',
      '```',
      'prefix <!-- day:2024-12-31 --> suffix',
    ].join('\n')

    const result = parseMarkdown(exportMarkdown([makeDay(contentMd)]))

    expect(result).toEqual({
      days: [
        expect.objectContaining({
          dayId: '2026-07-11',
          humanTitle: 'Saturday notes',
          contentMd,
        }),
      ],
      warnings: [],
    })
  })

  it.each([0, 1, 3])(
    'preserves literal marker lines preceded by %i escape prefixes across repeated cycles',
    (prefixCount) => {
      const contentMd = `${ESCAPE_PREFIX.repeat(prefixCount)}<!-- day:2025-02-03 -->`
      let day = makeDay(contentMd)

      for (let cycle = 0; cycle < 2; cycle += 1) {
        const result = parseMarkdown(exportMarkdown([day]))
        expect(result.days).toHaveLength(1)
        expect(result.days[0].contentMd).toBe(contentMd)
        day = { ...day, ...result.days[0] }
      }
    },
  )

  it('keeps genuine structural markers and duplicate warnings', () => {
    const source = `<!-- day:2026-07-11 -->
First
---

one

<!-- day:2026-07-10 -->
Second
---

two

<!-- day:2026-07-11 -->
First again
---

three`

    const result = parseMarkdown(source)

    expect(result.days).toEqual([
      { dayId: '2026-07-11', humanTitle: 'First again', contentMd: 'three' },
      { dayId: '2026-07-10', humanTitle: 'Second', contentMd: 'two' },
    ])
    expect(result.warnings).toEqual([
      'Duplicate day marker for 2026-07-11; using last block.',
    ])
  })

  it('does not recognize inline marker-shaped text as structure', () => {
    expect(parseMarkdown('prefix <!-- day:2026-07-11 --> suffix')).toEqual({
      days: [],
      warnings: ['No day markers found.'],
    })
  })

  it.each([
    '2026-02-30',
    '2026-00-10',
    '2026-13-10',
    '2026-99-10',
    '2026-01-00',
    '2027-02-29',
  ])('skips invalid calendar marker %s', (dayId) => {
    expect(parseMarkdown(`<!-- day:${dayId} -->\nInvalid`)).toEqual({
      days: [],
      warnings: [`Invalid day marker for ${dayId}; skipping block.`],
    })
  })

  it.each(['2026-01-01', '2026-12-31', '2028-02-29'])(
    'preserves valid calendar marker %s',
    (dayId) => {
      expect(parseMarkdown(`<!-- day:${dayId} -->\nTitle\n---\n\nBody`).days).toEqual([
        { dayId, humanTitle: 'Title', contentMd: 'Body' },
      ])
    },
  )

  it('preserves a leading thematic break verbatim instead of mispromoting it to the title', () => {
    const result = parseMarkdown('<!-- day:2026-07-11 -->\n---\nSome content')

    expect(result.days).toEqual([
      {
        dayId: '2026-07-11',
        humanTitle: formatDayTitle('2026-07-11'),
        contentMd: '---\nSome content',
      },
    ])
  })

  it('preserves a leading underscore thematic break verbatim', () => {
    const result = parseMarkdown('<!-- day:2026-07-11 -->\n___\nSome content')

    expect(result.days[0].contentMd).toBe('___\nSome content')
  })

  it('preserves a leading thematic break verbatim even with a blank line before it', () => {
    const result = parseMarkdown('<!-- day:2026-07-11 -->\n\n---\nSome content')

    expect(result.days[0].contentMd).toBe('---\nSome content')
  })

  it('still treats a real title followed by its setext underline as structure (no blank separator)', () => {
    const result = parseMarkdown('<!-- day:2026-07-11 -->\nTitle\n---\nBody')

    expect(result.days).toEqual([
      { dayId: '2026-07-11', humanTitle: 'Title', contentMd: 'Body' },
    ])
  })

  it("round-trips a day whose content starts with a thematic break byte-identically", () => {
    const contentMd = '---\nA note that opens with a thematic break.'
    const day = makeDay(contentMd)

    const result = parseMarkdown(exportMarkdown([day]))

    expect(result.days).toEqual([
      expect.objectContaining({
        dayId: day.dayId,
        humanTitle: day.humanTitle,
        contentMd,
      }),
    ])
  })
})
