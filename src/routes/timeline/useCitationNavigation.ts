import { useCallback } from 'react'
import { EditorView } from '@codemirror/view'
import { getCitationIndexFromTarget } from '../../lib/assistantMarkdown'
import { isNarrowViewport } from '../../lib/viewport'
import type { Day } from '../../lib/dayRepository'
import type { ChatCitation as Citation, ChatUiMessage } from '../../store/useChatStore'
import type { EditorPinReason } from './useEditorMountWindow'

type UseCitationNavigationParams = {
  days: Day[]
  editorRefs: React.MutableRefObject<Map<string, EditorView>>
  loadDay: (dayId: string) => Promise<unknown>
  pinDayForEditorMount: (dayId: string, reason: EditorPinReason, recompute?: boolean) => void
  revealDay: (
    dayId: string,
    focusPosition?: 'start' | 'end',
    scrollBlock?: ScrollLogicalPosition,
    focusScroll?: boolean,
    scrollBehavior?: ScrollBehavior,
  ) => void
  setHighlightedQuote: (citation: Citation | null) => void
  isNarrowViewportMode: boolean
  setChatPanelOpen: (open: boolean) => void
}

const normalizeCitationMatchText = (value: string) =>
  value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .toLowerCase()

const findQuoteOffset = (text: string, quote: string) => {
  const trimmedQuote = quote.trim()
  if (!trimmedQuote) return -1

  const exactIndex = text.indexOf(trimmedQuote)
  if (exactIndex >= 0) {
    return exactIndex
  }

  const lowerIndex = text.toLowerCase().indexOf(trimmedQuote.toLowerCase())
  if (lowerIndex >= 0) {
    return lowerIndex
  }

  return normalizeCitationMatchText(text).indexOf(normalizeCitationMatchText(trimmedQuote))
}

const getCitationScrollTopMargin = () => {
  if (typeof window === 'undefined') return 12
  if (isNarrowViewport()) return 12

  const header = document.querySelector<HTMLElement>('header.app-shell-fixed-right-aware')
  const headerHeight = header?.getBoundingClientRect().height ?? 64
  return Math.round(headerHeight + 16)
}

export const useCitationNavigation = ({
  days,
  editorRefs,
  loadDay,
  pinDayForEditorMount,
  revealDay,
  setHighlightedQuote,
  isNarrowViewportMode,
  setChatPanelOpen,
}: UseCitationNavigationParams) => {
  const scrollToCitationQuote = useCallback(
    async (citation: Citation) => {
      const maxAttempts = 20
      let attempts = 0

      return new Promise<boolean>((resolve) => {
        const run = () => {
          const view = editorRefs.current.get(citation.day)

          if (!view) {
            if (attempts >= maxAttempts) {
              resolve(false)
              return
            }

            attempts += 1
            requestAnimationFrame(run)
            return
          }

          const quoteOffset = findQuoteOffset(view.state.doc.toString(), citation.quote)
          if (quoteOffset < 0) {
            resolve(false)
            return
          }

          const topMargin = getCitationScrollTopMargin()

          view.dispatch({
            effects: EditorView.scrollIntoView(quoteOffset, {
              y: 'start',
              yMargin: topMargin,
            }),
          })

          resolve(true)
        }

        run()
      })
    },
    [editorRefs],
  )

  const handleCitationClick = useCallback(
    async (citation: Citation) => {
      const wasLoaded = days.some((day) => day.dayId === citation.day)
      if (!wasLoaded) {
        await loadDay(citation.day)
      }

      pinDayForEditorMount(citation.day, 'citation')
      setHighlightedQuote(citation)

      if (isNarrowViewportMode) {
        setChatPanelOpen(false)
        document.getElementById('chat-input')?.blur()
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve()
            })
          })
        })
      }

      revealDay(citation.day, undefined, 'start', false, 'auto')
      const jumpedToQuote = await scrollToCitationQuote(citation)

      if (!jumpedToQuote && !wasLoaded) {
        window.setTimeout(() => {
          revealDay(citation.day, undefined, 'start', false, 'auto')
          void scrollToCitationQuote(citation)
        }, 220)
      }
    },
    [
      days,
      isNarrowViewportMode,
      loadDay,
      pinDayForEditorMount,
      revealDay,
      scrollToCitationQuote,
      setChatPanelOpen,
      setHighlightedQuote,
    ],
  )

  const handleAssistantMarkdownClick = useCallback(
    (message: ChatUiMessage, event: React.MouseEvent<HTMLElement>) => {
      const index = getCitationIndexFromTarget(event.target)
      if (index === null) {
        return
      }

      const citation = message.meta?.citations[index]
      if (!citation) {
        return
      }

      event.preventDefault()
      void handleCitationClick(citation)
    },
    [handleCitationClick],
  )

  const handleAssistantMarkdownKeyDown = useCallback(
    (message: ChatUiMessage, event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return
      }

      const index = getCitationIndexFromTarget(event.target)
      if (index === null) {
        return
      }

      const citation = message.meta?.citations[index]
      if (!citation) {
        return
      }

      event.preventDefault()
      void handleCitationClick(citation)
    },
    [handleCitationClick],
  )

  return {
    handleCitationClick,
    handleAssistantMarkdownClick,
    handleAssistantMarkdownKeyDown,
  }
}
