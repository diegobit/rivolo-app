import { describe, expect, it } from 'vitest'
import { mergeNotebooks, mergeNotebookLines } from './notebookMerge'
import { parseMarkdown } from './markdown'

describe('Notebook additions across blank lines', () => {
  it('keeps both users’ new paragraphs together, remote first', () => {
    expect(mergeNotebookLines('Existing', 'Existing\n\nAlice 1\n\nAlice 2', 'Existing\n\nBob 1\n\nBob 2'))
      .toBe('Existing\n\nBob 1\n\nBob 2\n\nAlice 1\n\nAlice 2')
  })
  it('uses the last push for edits to the same existing paragraph and keeps both additions', () => {
    expect(mergeNotebookLines('Existing', 'Alice edit\n\nAlice new', 'Bob edit\n\nBob new'))
      .toBe('Alice edit\n\nBob new\n\nAlice new')
  })
  it('preserves independent edits and insertions in different places', () => {
    expect(mergeNotebookLines('A\n\nB\n\nC', 'A edited\n\nB\n\nL\n\nC', 'A\n\nR\n\nB\n\nC edited'))
      .toBe('A edited\n\nR\n\nB\n\nL\n\nC edited')
  })
  it('does not duplicate additions on retry, while preserving intentional repeated paragraphs', () => {
    expect(mergeNotebookLines('A', 'A\n\nL\n\nL', 'A\n\nR\n\nL\n\nL'))
      .toBe('A\n\nR\n\nL\n\nL')
  })
  it('keeps fenced code with internal blank lines intact', () => {
    const code = '```js\nconst a = 1\n\nconst b = 2\n```'
    expect(mergeNotebookLines(code, `${code}\n\nL`, `${code}\n\nR`)).toBe(`${code}\n\nR\n\nL`)
  })
  it('applies deletion of an unchanged blank line and lets the last conflicting text edit win', () => {
    expect(mergeNotebookLines('A\n\nB', 'A\n\nB', 'A')).toBe('A')
    expect(mergeNotebookLines('A\n\nB', 'A\n\nB edited', 'A')).toBe('A\nB edited')
  })
})

const day = (id: string, text: string) => `<!-- day:${id} -->\n${id}\n---\n\n${text}`
describe('Whole notebook merge', () => {
  it('merges new days and additions to the same new day without duplicate markers', () => {
    const base = day('2026-09-28', 'Old')
    const local = `${base}\n\n${day('2026-09-30', 'Alice')}`
    const remote = `${base}\n\n${day('2026-09-29', 'Bob yesterday')}\n\n${day('2026-09-30', 'Bob')}`
    const result = parseMarkdown(mergeNotebooks(base, local, remote))
    expect(result.warnings).toEqual([])
    expect(result.days.map((entry) => [entry.dayId, entry.contentMd])).toEqual([
      ['2026-09-30', 'Bob\nAlice'], ['2026-09-29', 'Bob yesterday'], ['2026-09-28', 'Old'],
    ])
  })
  it('applies a remote day deletion while retaining a different local addition', () => {
    const base = `${day('2026-09-28', 'Old')}\n\n${day('2026-09-29', 'Keep')}`
    const local = `${base}\n\n${day('2026-09-30', 'New')}`
    const result = parseMarkdown(mergeNotebooks(base, local, day('2026-09-29', 'Keep')))
    expect(result.days.map((entry) => entry.dayId)).toEqual(['2026-09-30', '2026-09-29'])
  })
  it('rejects malformed remote content instead of silently discarding it', () => {
    const base = day('2026-09-30', 'Old')
    expect(() => mergeNotebooks(base, base, 'broken')).toThrow('day markers')
    expect(() => mergeNotebooks(base, base, `${base}\n\n${base}`)).toThrow('day markers')
  })
})

describe('Line merge', () => {
  it('combines edits on different lines of the same paragraph', () => {
    expect(mergeNotebookLines('First\nSecond\nThird', 'First edited\nSecond\nThird', 'First\nSecond edited\nThird'))
      .toBe('First edited\nSecond edited\nThird')
  })
  it('keeps added lines from both writers without requiring blank lines', () => {
    expect(mergeNotebookLines('First', 'First\nAlice', 'First\nBob')).toBe('First\nBob\nAlice')
  })
  it('uses the last push only for the overlapping line', () => {
    expect(mergeNotebookLines('A\nB\nC', 'A\nAlice B\nC', 'Bob A\nBob B\nC'))
      .toBe('Bob A\nAlice B\nC')
  })
  it('preserves whitespace and merges separate edits within a code fence', () => {
    expect(mergeNotebookLines('```\n  a\n  b\n```', '```\n  a1\n  b\n```', '```\n  a\n  b1\n```'))
      .toBe('```\n  a1\n  b1\n```')
  })
  it('handles small edits in a 20000-line day without quadratic allocation', () => {
    const base = Array.from({ length: 20000 }, (_, i) => `Line ${i}`)
    const local = [...base]; local[10000] = 'Alice'
    const remote = [...base]; remote[10001] = 'Bob'
    const merged = mergeNotebookLines(base.join('\n'), local.join('\n'), remote.join('\n'))
    expect(merged.split('\n').slice(10000, 10002)).toEqual(['Alice', 'Bob'])
  })
  it('merges an extensive rewrite entirely by line without a size limit', () => {
    const base = Array.from({ length: 2100 }, (_, i) => `Old ${i}`).join('\n')
    const local = base.replaceAll('Old', 'Alice')
    const remote = base.replaceAll('Old', 'Bob')
    expect(mergeNotebookLines(base, local, remote)).toBe(local)
  })

  it('preserves independent line edits even beyond the former matrix limit', () => {
    const base = Array.from({ length: 2100 }, (_, i) => `Old ${i}`)
    const local = base.map((line, i) => i === 1049 ? line : `Alice ${i}`)
    const remote = base.map((line, i) => i === 1050 ? line : `Bob ${i}`)
    const merged = mergeNotebookLines(base.join('\n'), local.join('\n'), remote.join('\n')).split('\n')
    expect(merged).toHaveLength(2100)
    expect(merged[1049]).toBe('Bob 1049')
    expect(merged[1050]).toBe('Alice 1050')
    expect(merged[0]).toBe('Alice 0')
  })
})
