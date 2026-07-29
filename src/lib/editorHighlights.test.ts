import { describe, expect, it } from 'vitest'
import { findTagHighlightRanges } from './editorHighlights'

describe('findTagHighlightRanges', () => {
  it('includes accented characters in hashtags', () => {
    expect(findTagHighlightRanges('Una #novità oggi')).toEqual([
      { from: 4, to: 11, className: 'cm-hashtag' },
    ])
  })

  it('includes decomposed accents and non-Latin letters', () => {
    const text = '#novita\u0300 #東京'

    expect(findTagHighlightRanges(text)).toEqual([
      { from: 0, to: 8, className: 'cm-hashtag' },
      { from: 9, to: 12, className: 'cm-hashtag' },
    ])
  })

  it('does not start a tag in the middle of a Unicode word', () => {
    expect(findTagHighlightRanges('città#novità')).toEqual([])
  })
})
