import { describe, expect, it } from 'vitest'
import { renderAssistantMarkdown } from './assistantMarkdown'

type Citation = { day: string; quote: string }

const render = (value: string, citations: Citation[] = []) => renderAssistantMarkdown(value, citations)

describe('renderAssistantMarkdown links', () => {
  it('keeps * / ** / ~~ literal inside the href instead of injecting emphasis tags', () => {
    const star = render('see [docs](https://ex.com/a*b*c) now')
    expect(star).toContain('href="https://ex.com/a*b*c"')
    expect(star).not.toContain('<em>')
    expect(star).not.toContain('<strong>')

    const bold = render('[x](https://ex.com/a**b**c)')
    expect(bold).toContain('href="https://ex.com/a**b**c"')
    expect(bold).not.toContain('<strong>')

    const strike = render('[x](https://ex.com/a~~b~~c)')
    expect(strike).toContain('href="https://ex.com/a~~b~~c"')
    expect(strike).not.toContain('<del>')
  })

  it('renders a plain link with the expected attributes', () => {
    expect(render('[docs](https://ex.com/page)')).toContain(
      '<a href="https://ex.com/page" target="_blank" rel="noreferrer">docs</a>',
    )
  })

  it('protects multiple links with distinct URL fragments in one line', () => {
    const html = render('[a](https://ex.com/1*x*1) and [b](https://ex.com/2*y*2)')
    expect(html).toContain('href="https://ex.com/1*x*1"')
    expect(html).toContain('href="https://ex.com/2*y*2"')
    expect(html).not.toContain('<em>')
  })

  it('still applies emphasis inside a link label', () => {
    const html = render('[**bold** link](https://ex.com)')
    expect(html).toContain(
      '<a href="https://ex.com" target="_blank" rel="noreferrer"><strong>bold</strong> link</a>',
    )
  })

  it('applies label emphasis while protecting a * in the same URL', () => {
    const html = render('[**b**](https://ex.com/x*y*z)')
    expect(html).toContain('href="https://ex.com/x*y*z"')
    expect(html).toContain('<strong>b</strong>')
  })

  it('preserves emphasis that spans across a link', () => {
    const html = render('*text [a](https://ex.com) more*')
    expect(html).toContain(
      '<em>text <a href="https://ex.com" target="_blank" rel="noreferrer">a</a> more</em>',
    )
  })
})

describe('renderAssistantMarkdown formatting is otherwise unchanged', () => {
  it('renders inline code, bold, italic and strikethrough', () => {
    expect(render('use `npm run build` now')).toContain('<code>npm run build</code>')
    expect(render('**b** and *i* and ~~s~~')).toContain('<strong>b</strong>')
    expect(render('**b** and *i* and ~~s~~')).toContain('<em>i</em>')
    expect(render('**b** and *i* and ~~s~~')).toContain('<del>s</del>')
  })

  it('escapes raw HTML in the source text', () => {
    expect(render('<script>alert(1)</script>')).toContain('&lt;script&gt;')
  })

  it('renders headings, lists and blockquotes', () => {
    expect(render('# Title')).toBe('<h1>Title</h1>')
    expect(render('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>')
    expect(render('1. first')).toBe('<ol><li>first</li></ol>')
    expect(render('> quoted')).toBe('<blockquote>quoted</blockquote>')
  })

  it('renders a citation chip from a marker and keeps it working next to a link', () => {
    const citations: Citation[] = [{ day: '2026-07-12', quote: 'the source quote' }]
    const html = render('per the note @@CITATION_0@@ see [docs](https://ex.com/a*b)', citations)
    expect(html).toContain('data-citation-index="0"')
    expect(html).toContain('class="assistant-cite-inline"')
    expect(html).toContain('href="https://ex.com/a*b"')
  })
})
