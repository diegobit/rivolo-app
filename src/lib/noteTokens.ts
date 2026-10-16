// Shared by highlighting, search/MCP summaries and the SQLite hashtag index.
export const createNoteTokenRegex = (marker: '#' | '@' | '#@') =>
  new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}_#@])([${marker}][\\p{L}\\p{M}\\p{N}_/-]+)`, 'gu')

export const normalizeNoteToken = (token: string) => token.normalize('NFC').toLowerCase()

export const countHashtags = (text: string) => {
  const counts = new Map<string, number>()
  for (const match of text.matchAll(createNoteTokenRegex('#'))) {
    const token = normalizeNoteToken(match[2])
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}
