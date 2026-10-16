import { describe, expect, it } from 'vitest'
import { getMatchedBlockLineIndexes } from './syntaxHighlight'

describe('getMatchedBlockLineIndexes', () => {
  it('maps repeated lines to successive occurrences, in order', () => {
    const note = ['apple', 'filler', 'apple', 'pear', 'apple'].join('\n')

    expect(getMatchedBlockLineIndexes(note, ['apple', 'apple', 'pear', 'apple'])).toEqual([0, 2, 3, 4])
  })

  it('ignores trailing whitespace and reports blocks it cannot find', () => {
    const note = 'first line   \nsecond'

    expect(getMatchedBlockLineIndexes(note, ['first line', 'missing', 'second  '])).toEqual([0, -1, 1])
  })

  it('does not reuse a line once every occurrence has been taken', () => {
    expect(getMatchedBlockLineIndexes('only once', ['only once', 'only once'])).toEqual([0, -1])
  })

  it('maps many identical lines to consecutive occurrences', () => {
    const note = Array.from({ length: 1000 }, () => 'same line').join('\n')
    const blocks = Array.from({ length: 1000 }, () => 'same line')

    expect(getMatchedBlockLineIndexes(note, blocks)).toEqual(Array.from({ length: 1000 }, (_, index) => index))
  })
})
