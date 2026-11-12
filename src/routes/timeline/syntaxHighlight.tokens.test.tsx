import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderSyntaxLine } from './syntaxHighlight'

const TOKEN_SELECTOR = 'span.font-bold, span.font-semibold'

const highlightedTokens = (line: string, query = '') => {
  const { container } = render(<p>{renderSyntaxLine(line, query, 'line')}</p>)
  return {
    container,
    tokens: [...container.querySelectorAll(TOKEN_SELECTOR)].map((node) => node.textContent),
  }
}

describe('tags and mentions in search results', () => {
  it.each([
    ['call @anna about #work/q3', ['@anna', '#work/q3']],
    ['#città con @josé', ['#città', '@josé']],
    ['write to me@example.com today', []],
    ['see page#3 and C#sharp', []],
    ['(#idea) "@bob"', ['#idea', '@bob']],
  ])('highlights %j by the token rule the editor uses', (line, expected) => {
    const { container, tokens } = highlightedTokens(line)

    expect(tokens).toEqual(expected)
    expect(container.textContent).toBe(line)
  })

  it('keeps the search match marked inside and outside a token', () => {
    const { container, tokens } = highlightedTokens('plan #planning', 'plan')

    expect(tokens).toEqual(['#planning'])
    expect([...container.querySelectorAll('mark')].map((node) => node.textContent)).toEqual(['plan', 'plan'])
    expect(container.textContent).toBe('plan #planning')
  })
})
