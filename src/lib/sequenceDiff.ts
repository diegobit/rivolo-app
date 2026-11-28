// Longest common subsequence of lines, in linear auxiliary memory. Myers'
// middle snake keeps the cost proportional to the number of changed lines;
// heavily rewritten ranges fall back to a Hirschberg split, which is bounded
// by the range size. Every match and conflict remains a single line.
export const matchingLines = (baseLines: string[], nextLines: string[]): [number, number][] => {
  // Compare small integers instead of line text.
  const ids = new Map<string, number>()
  const intern = (lines: string[]) => Int32Array.from(lines, (line) => {
    let id = ids.get(line)
    if (id === undefined) ids.set(line, id = ids.size)
    return id
  })
  const base = intern(baseLines)
  const next = intern(nextLines)
  const anchors: [number, number][] = []

  // Returns the middle run of matches [a, b, length] on a shortest edit path,
  // or null when the range needs more edits than the search is worth.
  const middleSnake = (a0: number, a1: number, b0: number, b1: number): [number, number, number] | null => {
    const n = a1 - a0
    const m = b1 - b0
    const delta = n - m
    const odd = (delta & 1) === 1
    const limit = Math.min(Math.ceil((n + m) / 2), Math.ceil(Math.sqrt(n * m) / 2))
    const offset = limit + 1
    const forward = new Int32Array(2 * limit + 3)
    const backward = new Int32Array(2 * limit + 3)
    for (let d = 0; d <= limit; d++) {
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || k !== d && forward[offset + k - 1] < forward[offset + k + 1]
          ? forward[offset + k + 1] : forward[offset + k - 1] + 1
        let y = x - k
        const startX = x
        while (x < n && y < m && base[a0 + x] === next[b0 + y]) { x++; y++ }
        forward[offset + k] = x
        const other = delta - k
        if (odd && other >= 1 - d && other <= d - 1 && x + backward[offset + other] >= n) {
          return [a0 + startX, b0 + startX - k, x - startX]
        }
      }
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || k !== d && backward[offset + k - 1] < backward[offset + k + 1]
          ? backward[offset + k + 1] : backward[offset + k - 1] + 1
        let y = x - k
        const startX = x
        while (x < n && y < m && base[a1 - 1 - x] === next[b1 - 1 - y]) { x++; y++ }
        backward[offset + k] = x
        const other = delta - k
        if (!odd && other >= -d && other <= d && x + forward[offset + other] >= n) {
          return [a1 - x, b1 - y, x - startX]
        }
      }
    }
    return null
  }

  const scores = (a0: number, a1: number, b0: number, b1: number, reverse: boolean) => {
    const row = new Uint32Array(b1 - b0 + 1)
    for (let i = 0; i < a1 - a0; i++) {
      let previous = 0
      const line = base[reverse ? a1 - i - 1 : a0 + i]
      for (let j = 1; j < row.length; j++) {
        const saved = row[j]
        row[j] = line === next[reverse ? b1 - j : b0 + j - 1]
          ? previous + 1 : Math.max(row[j], row[j - 1])
        previous = saved
      }
    }
    return row
  }
  const splitPoint = (a0: number, middle: number, a1: number, b0: number, b1: number) => {
    const left = scores(a0, middle, b0, b1, false)
    const right = scores(middle, a1, b0, b1, true)
    let best = -1
    let split = 0
    for (let j = 0; j <= b1 - b0; j++) {
      const score = left[j] + right[b1 - b0 - j]
      if (score > best) { best = score; split = j }
    }
    return b0 + split
  }
  const visit = (a0: number, a1: number, b0: number, b1: number) => {
    while (a0 < a1 && b0 < b1 && base[a0] === next[b0]) anchors.push([a0++, b0++])
    let suffix = 0
    while (a0 < a1 && b0 < b1 && base[a1 - 1] === next[b1 - 1]) { a1--; b1--; suffix++ }
    if (a0 < a1 && b0 < b1) {
      if (a1 - a0 === 1) {
        for (let j = b0; j < b1; j++) {
          if (base[a0] === next[j]) { anchors.push([a0, j]); break }
        }
      } else {
        // A wholesale rewrite often has no shared lines at all: avoid LCS work.
        const candidates = new Set(next.subarray(b0, b1))
        let shared = false
        for (let i = a0; i < a1 && !shared; i++) shared = candidates.has(base[i])
        candidates.clear()
        const snake = shared ? middleSnake(a0, a1, b0, b1) : null
        if (snake) {
          const [a, b, length] = snake
          visit(a0, a, b0, b)
          for (let i = 0; i < length; i++) anchors.push([a + i, b + i])
          visit(a + length, a1, b + length, b1)
        } else if (shared) {
          const middle = a0 + Math.floor((a1 - a0) / 2)
          const split = splitPoint(a0, middle, a1, b0, b1)
          visit(a0, middle, b0, split)
          visit(middle, a1, split, b1)
        }
      }
    }
    for (let i = 0; i < suffix; i++) anchors.push([a1 + i, b1 + i])
  }
  visit(0, base.length, 0, next.length)
  return anchors
}

export const textLines = (text: string) => text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n')
