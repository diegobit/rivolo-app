import { describe, expect, it } from 'vitest'
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
})
