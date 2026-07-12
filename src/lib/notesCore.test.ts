import { describe, expect, it } from 'vitest'
import { searchDaysInMemory, type Day } from './notesCore'

const makeDay = (dayId: string, lines: string[]): Day => ({
  dayId,
  humanTitle: dayId,
  contentMd: lines.join('\n'),
  createdAt: 1,
  updatedAt: 1,
})

const day = makeDay('2026-07-12', [
  '# Morning',
  '- [ ] buy milk',
  '- [x] finished report',
  'Met @alice about the #project launch',
  'Plain line mentioning widgets',
  '## Afternoon',
  'Follow up on #project',
])

describe('searchDaysInMemory filters', () => {
  it('returns nothing without a query or filter', () => {
    expect(searchDaysInMemory([day], '')).toEqual([])
  })

  it("open-todos filter matches only unchecked todo lines", () => {
    const [result] = searchDaysInMemory([day], '', { filter: 'open-todos' })
    expect(result.blockKind).toBe('line')
    expect(result.matchedBlocks).toContain('- [ ] buy milk')
    expect(result.matchedBlocks).not.toContain('- [x] finished report')
  })

  it('tags filter matches lines containing a #tag', () => {
    const [result] = searchDaysInMemory([day], '', { filter: 'tags' })
    expect(result.blockKind).toBe('line')
    expect(result.matchedBlocks).toEqual([
      'Met @alice about the #project launch',
      'Follow up on #project',
    ])
  })

  it('mentions filter matches lines containing an @mention', () => {
    const [result] = searchDaysInMemory([day], '', { filter: 'mentions' })
    expect(result.blockKind).toBe('line')
    expect(result.matchedBlocks).toEqual(['Met @alice about the #project launch'])
  })

  it('headings filter returns section blocks, not lines', () => {
    const [result] = searchDaysInMemory([day], '', { filter: 'headings' })
    expect(result.blockKind).toBe('section')
    expect(result.matchedBlocks.length).toBeGreaterThan(0)
    expect(result.matchedBlocks[0]).toContain('# Morning')
  })

  it('headings filter honours the query on the heading text', () => {
    const [result] = searchDaysInMemory([day], 'afternoon', { filter: 'headings' })
    expect(result.blockKind).toBe('section')
    expect(result.matchedBlocks).toHaveLength(1)
    expect(result.matchedBlocks[0]).toContain('## Afternoon')
    expect(result.matchedBlocks[0]).toContain('Follow up on #project')
  })

  it('plain substring query matches on line content', () => {
    const [result] = searchDaysInMemory([day], 'widgets')
    expect(result.blockKind).toBe('line')
    expect(result.matchedBlocks).toEqual(['Plain line mentioning widgets'])
  })
})
