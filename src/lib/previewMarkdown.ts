import { escapeHtml } from './html'

type HighlightCore = typeof import('highlight.js/lib/core')['default']

const applyInlineHighlight = (value: string) =>
  value
    .replace(/\*\*([^*]+)\*\*/g, '<span class="hljs-strong">$1</span>')
    .replace(/\*([^*]+)\*/g, '<span class="hljs-emphasis">$1</span>')
    .replace(/`([^`]+)`/g, '<span class="hljs-attr">$1</span>')
    .replace(/(^|[^A-Za-z0-9_])(#[-A-Za-z0-9_/-]+)/g, '$1<span class="hljs-hashtag">$2</span>')
    .replace(/(^|[^A-Za-z0-9_])(@[-A-Za-z0-9_/-]+)/g, '$1<span class="hljs-mention">$2</span>')

export const buildPreviewHtml = (text: string, hljs: HighlightCore) => {
  const lines = text.split('\n')
  const htmlLines: string[] = []
  let inFence = false
  let fenceLang = ''
  let fenceLines: string[] = []

  const flushFence = () => {
    const code = fenceLines.join('\n')
    if (!code) return
    try {
      htmlLines.push(hljs.highlight(code, { language: fenceLang || 'python', ignoreIllegals: true }).value)
    } catch {
      htmlLines.push(escapeHtml(code))
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      if (inFence) {
        flushFence()
        htmlLines.push('<span class="hljs-meta">```</span>')
        inFence = false
        fenceLang = ''
        fenceLines = []
      } else {
        inFence = true
        fenceLang = trimmed.slice(3).trim()
        htmlLines.push('<span class="hljs-meta">```' + escapeHtml(fenceLang) + '</span>')
      }
      continue
    }

    if (inFence) {
      fenceLines.push(line)
      continue
    }

    const headingMatch = line.match(/^(\s*)(#{1,3})\s+(.*)$/)
    if (headingMatch) {
      const [, indent, hashes, content] = headingMatch
      const highlighted = applyInlineHighlight(escapeHtml(`${hashes} ${content}`))
      htmlLines.push(`${escapeHtml(indent)}<span class="hljs-section">${highlighted}</span>`)
      continue
    }

    const bulletMatch = line.match(/^(\s*)-\s+(.*)$/)
    if (bulletMatch) {
      const [, indent, content] = bulletMatch
      const todoMatch = content.match(/^\[([ xX])\]\s+(.*)$/)
      if (todoMatch) {
        const marker = todoMatch[1]
        const highlighted = applyInlineHighlight(escapeHtml(todoMatch[2]))
        htmlLines.push(
          `${escapeHtml(indent)}<span class="hljs-todo-marker">- [${escapeHtml(marker)}]</span> ${highlighted}`,
        )
      } else {
        const highlighted = applyInlineHighlight(escapeHtml(content))
        htmlLines.push(`${escapeHtml(indent)}<span class="hljs-bullet">-</span> ${highlighted}`)
      }
      continue
    }

    htmlLines.push(applyInlineHighlight(escapeHtml(line)))
  }

  if (inFence) {
    flushFence()
  }

  return htmlLines.join('\n')
}
