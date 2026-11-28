import { describe, expect, it } from 'vitest'
import { matchingLines } from './sequenceDiff'

describe('linear-memory line alignment', () => {
  const expectOptimal = (base: string[], next: string[]) => {
    const reference = Array.from({ length: base.length + 1 }, () => new Array<number>(next.length + 1).fill(0))
    for (let i = 1; i <= base.length; i++) for (let j = 1; j <= next.length; j++) {
      reference[i][j] = base[i - 1] === next[j - 1]
        ? reference[i - 1][j - 1] + 1 : Math.max(reference[i - 1][j], reference[i][j - 1])
    }
    const matches = matchingLines(base, next)
    expect(matches.length).toBe(reference[base.length][next.length])
    matches.forEach(([i, j], index) => {
      expect(base[i]).toBe(next[j])
      if (index) {
        expect(i).toBeGreaterThan(matches[index - 1][0])
        expect(j).toBeGreaterThan(matches[index - 1][1])
      }
    })
  }
  it('finds an optimal ordered alignment with repeated, inserted and deleted lines', () => {
    const sequences: string[][] = [[]]
    for (let size = 1; size <= 4; size++) {
      for (let mask = 0; mask < 2 ** size; mask++) {
        sequences.push(Array.from({ length: size }, (_, i) => mask & (1 << i) ? 'A' : 'B'))
      }
    }
    for (const base of sequences) for (const next of sequences) expectOptimal(base, next)
  })
  it('stays optimal from light edits to heavy rewrites of longer notes', () => {
    let seed = 7
    const random = (limit: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % limit }
    for (let round = 0; round < 400; round++) {
      // A small alphabet repeats lines; a large one keeps most lines unique.
      const alphabet = [2, 4, 40][round % 3]
      const base = Array.from({ length: random(60) }, () => `line ${random(alphabet)}`)
      const next = base.slice()
      for (let edits = random([3, 12, 80][random(3)]); edits > 0; edits--) {
        const at = random(next.length + 1)
        if (random(2)) next.splice(at, random(3))
        else next.splice(at, 0, `line ${random(alphabet)}`)
      }
      expectOptimal(base, next)
    }
  })
  it('aligns scattered edits in a very long note quickly', () => {
    const base = Array.from({ length: 10_000 }, (_, i) => `line ${i}`)
    const next = base.slice()
    for (let i = 5; i < next.length; i += 97) next[i] += ' edited'
    const started = performance.now()
    expect(matchingLines(base, next)).toHaveLength(10_000 - Math.ceil((10_000 - 5) / 97))
    expect(performance.now() - started).toBeLessThan(250)
  })
})
