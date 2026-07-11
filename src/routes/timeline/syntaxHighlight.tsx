import { TODO_LINE_REGEX } from './todoToggle'

export type RenderSyntaxLineOptions = {
  onToggleTodo?: () => void
}

export const getMatchedBlockLineIndexes = (contentMd: string, matchedBlocks: string[]) => {
  const normalizedLines = contentMd.split('\n').map((line) => line.trimEnd())
  const usedIndexes = new Set<number>()

  return matchedBlocks.map((block) => {
    const normalizedBlock = block.trimEnd()

    for (let index = 0; index < normalizedLines.length; index += 1) {
      if (usedIndexes.has(index)) {
        continue
      }

      if (normalizedLines[index] === normalizedBlock) {
        usedIndexes.add(index)
        return index
      }
    }

    return -1
  })
}

export const highlightQueryText = (text: string, query: string, keyPrefix: string) => {
  const trimmed = query.trim()
  if (!trimmed) {
    return [text]
  }

  const normalizedText = text.toLocaleLowerCase()
  const normalizedQuery = trimmed.toLocaleLowerCase()
  const parts: React.ReactNode[] = []
  let cursor = 0

  while (cursor < text.length) {
    const nextIndex = normalizedText.indexOf(normalizedQuery, cursor)
    if (nextIndex === -1) {
      parts.push(text.slice(cursor))
      break
    }

    if (nextIndex > cursor) {
      parts.push(text.slice(cursor, nextIndex))
    }

    const endIndex = nextIndex + trimmed.length
    parts.push(
      <mark key={`${keyPrefix}-${nextIndex}-${endIndex}`} className="rounded bg-[var(--theme-search-match)] text-inherit">
        {text.slice(nextIndex, endIndex)}
      </mark>,
    )
    cursor = endIndex
  }

  return parts
}

const renderInlineTokenHighlights = (text: string, query: string, keyPrefix: string) => {
  const tokenRegex = /[#@][A-Za-z0-9_/-]+/g
  const nodes: React.ReactNode[] = []
  let cursor = 0
  let tokenMatch = tokenRegex.exec(text)

  while (tokenMatch) {
    const token = tokenMatch[0]
    const start = tokenMatch.index
    const end = start + token.length

    if (start > cursor) {
      nodes.push(...highlightQueryText(text.slice(cursor, start), query, `${keyPrefix}-plain-${cursor}`))
    }

    nodes.push(
      <span
        key={`${keyPrefix}-token-${start}`}
        className={token.startsWith('#') ? 'font-bold text-[var(--theme-tag)]' : 'font-semibold text-[var(--theme-mention)]'}
      >
        {highlightQueryText(token, query, `${keyPrefix}-token-inner-${start}`)}
      </span>,
    )

    cursor = end
    tokenMatch = tokenRegex.exec(text)
  }

  if (cursor < text.length) {
    nodes.push(...highlightQueryText(text.slice(cursor), query, `${keyPrefix}-plain-tail`))
  }

  return nodes.length ? nodes : [text]
}

export const renderSyntaxLine = (line: string, query: string, keyPrefix: string, options?: RenderSyntaxLineOptions) => {
  const headingMatch = line.match(/^(\s{0,3}#{1,6}\s+)(.*)$/)
  if (headingMatch) {
    return (
      <>
        <span className="font-black text-[#368b1c]">
          {highlightQueryText(headingMatch[1], query, `${keyPrefix}-heading-marker`)}
        </span>
        {renderInlineTokenHighlights(headingMatch[2], query, `${keyPrefix}-heading-text`)}
      </>
    )
  }

  const todoMatch = line.match(TODO_LINE_REGEX)
  if (todoMatch) {
    const todoMarker = highlightQueryText(todoMatch[2], query, `${keyPrefix}-todo-marker`)

    return (
      <>
        <span className="font-semibold text-[#b45309]">
          {highlightQueryText(todoMatch[1], query, `${keyPrefix}-todo-list`)}
        </span>
        {options?.onToggleTodo ? (
          <button
            className="-mx-0.5 inline-flex items-center rounded-[4px] px-1 py-0.5 font-semibold text-[#ed9b38] transition hover:bg-[#ed9b38]/15 active:bg-[#ed9b38]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--theme-accent-rgb)/0.42)]"
            type="button"
            aria-label="Toggle todo"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              options.onToggleTodo?.()
            }}
          >
            {todoMarker}
          </button>
        ) : (
          <span className="font-semibold text-[#ed9b38]">{todoMarker}</span>
        )}
        {renderInlineTokenHighlights(todoMatch[3], query, `${keyPrefix}-todo-text`)}
      </>
    )
  }

  const listMarkerMatch = line.match(/^(\s*(?:[-+*]|\d+[.)]))(\s+)(.*)$/)
  if (listMarkerMatch) {
    return (
      <>
        <span className="font-semibold text-[#b45309]">
          {highlightQueryText(listMarkerMatch[1], query, `${keyPrefix}-list-marker`)}
        </span>
        {highlightQueryText(listMarkerMatch[2], query, `${keyPrefix}-list-space`)}
        {renderInlineTokenHighlights(listMarkerMatch[3], query, `${keyPrefix}-list-text`)}
      </>
    )
  }

  return renderInlineTokenHighlights(line, query, `${keyPrefix}-plain`)
}
