import { parseDayId } from './dates'
import { escapeHtml } from './html'
import { CITATION_MARKER_REGEX } from './llm/streamTagParser'

type Citation = {
  day: string
  quote: string
}

const citationChipDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})

const toCitationChipLabel = (dayId: string) => {
  try {
    return citationChipDateFormatter.format(parseDayId(dayId))
  } catch {
    return dayId
  }
}

const toCitationTooltip = (citation: Citation) => {
  const compactQuote = citation.quote.replace(/\s+/g, ' ').trim()
  const preview = compactQuote.length > 120 ? `${compactQuote.slice(0, 120).trimEnd()}...` : compactQuote
  return preview ? `${citation.day}\n${preview}` : citation.day
}

const renderInlineMarkdown = (value: string, citations: Citation[]) => {
  const codeTokens: string[] = []
  const withCodeTokens = value.replace(/`([^`\n]+)`/g, (_match, code) => {
    const token = `@@INLINE_CODE_${codeTokens.length}@@`
    codeTokens.push(`<code>${escapeHtml(code)}</code>`)
    return token
  })

  const escaped = escapeHtml(withCodeTokens)

  const withLinks = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
    const safeUrl = url.replace(/&quot;/g, '')
    return `<a href="${safeUrl}" target="_blank" rel="noreferrer">${label}</a>`
  })

  const withFormatting = withLinks
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')

  const withCitations = withFormatting.replace(CITATION_MARKER_REGEX, (_match, indexText) => {
    const index = Number.parseInt(indexText, 10)
    if (!Number.isInteger(index) || index < 0) {
      return ''
    }

    const citation = citations[index]
    if (!citation) {
      return ''
    }

    const label = escapeHtml(toCitationChipLabel(citation.day))
    const tooltip = escapeHtml(toCitationTooltip(citation)).replace(/\n/g, '&#10;')
    const ariaLabel = escapeHtml(`Open citation from ${citation.day}`)

    return `<span class="assistant-cite-inline" data-citation-index="${index}" role="button" tabindex="0" title="${tooltip}" aria-label="${ariaLabel}">${label}</span>`
  })

  return withCitations.replace(/@@INLINE_CODE_(\d+)@@/g, (_match, indexText) => {
    const index = Number(indexText)
    return codeTokens[index] ?? ''
  })
}

export const renderAssistantMarkdown = (value: string, citations: Citation[]) => {
  const lines = value.split('\n')
  const htmlLines: string[] = []
  const codeLines: string[] = []
  let inCodeBlock = false
  let listType: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (!listType) return
    htmlLines.push(`</${listType}>`)
    listType = null
  }

  const openList = (nextType: 'ul' | 'ol') => {
    if (listType === nextType) return
    closeList()
    htmlLines.push(`<${nextType}>`)
    listType = nextType
  }

  const flushCodeBlock = () => {
    if (!codeLines.length) {
      htmlLines.push('<pre><code></code></pre>')
      return
    }
    htmlLines.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    codeLines.length = 0
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      closeList()
      if (inCodeBlock) {
        flushCodeBlock()
        inCodeBlock = false
      } else {
        inCodeBlock = true
        codeLines.length = 0
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    if (!trimmed) {
      closeList()
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      closeList()
      const level = headingMatch[1].length
      htmlLines.push(`<h${level}>${renderInlineMarkdown(headingMatch[2], citations)}</h${level}>`)
      continue
    }

    const unorderedListMatch = line.match(/^\s*[-*]\s+(.+)$/)
    if (unorderedListMatch) {
      openList('ul')
      htmlLines.push(`<li>${renderInlineMarkdown(unorderedListMatch[1], citations)}</li>`)
      continue
    }

    const orderedListMatch = line.match(/^\s*\d+\.\s+(.+)$/)
    if (orderedListMatch) {
      openList('ol')
      htmlLines.push(`<li>${renderInlineMarkdown(orderedListMatch[1], citations)}</li>`)
      continue
    }

    const quoteMatch = line.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      closeList()
      htmlLines.push(`<blockquote>${renderInlineMarkdown(quoteMatch[1], citations)}</blockquote>`)
      continue
    }

    closeList()
    htmlLines.push(`<p>${renderInlineMarkdown(line, citations)}</p>`)
  }

  closeList()

  if (inCodeBlock) {
    flushCodeBlock()
  }

  return htmlLines.join('')
}

export const getCitationIndexFromTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return null
  }

  const citationNode = target.closest<HTMLElement>('[data-citation-index]')
  if (!citationNode) {
    return null
  }

  const indexValue = citationNode.dataset.citationIndex
  if (!indexValue) {
    return null
  }

  const index = Number.parseInt(indexValue, 10)
  if (!Number.isInteger(index) || index < 0) {
    return null
  }

  return index
}
