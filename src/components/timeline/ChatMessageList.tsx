import { useEffect, useRef, useState } from 'react'
import { renderAssistantMarkdown } from '../../lib/assistantMarkdown'
import { copyTextToClipboard } from '../../lib/clipboard'
import type { ChatUiMessage } from '../../store/useChatStore'

type ChatMessageListProps = {
  messages: ChatUiMessage[]
  mobile?: boolean
  onAssistantMarkdownClick: (message: ChatUiMessage, event: React.MouseEvent<HTMLElement>) => void
  onAssistantMarkdownKeyDown: (message: ChatUiMessage, event: React.KeyboardEvent<HTMLElement>) => void
  onChatInsert: (message: ChatUiMessage) => void
}

const copiedResetDelayMs = 2000

function AssistantCopyButton({ text, mobile }: { text: string; mobile: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const resetTimeoutRef = useRef<number | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      if (resetTimeoutRef.current !== null) window.clearTimeout(resetTimeoutRef.current)
    }
  }, [])

  return (
    <button
      type="button"
      className={`hover-reveal inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-xs font-semibold text-[var(--theme-text-soft)] shadow-sm transition hover:border-[var(--theme-border-strong)] hover:text-[var(--theme-text)] sm:h-8 sm:min-h-0 ${
        mobile ? '' : 'hover:-translate-y-[1px] hover:shadow-md'
      }`}
      aria-label="Copy message"
      onClick={() => {
        void copyTextToClipboard(text).then((didCopy) => {
          if (!isMountedRef.current) return
          setStatus(didCopy ? 'copied' : 'failed')
          if (resetTimeoutRef.current !== null) window.clearTimeout(resetTimeoutRef.current)
          resetTimeoutRef.current = window.setTimeout(() => setStatus('idle'), copiedResetDelayMs)
        })
      }}
    >
      {status === 'copied' ? (
        <svg viewBox="0 0 256 256" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
          <path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z" />
        </svg>
      ) : status === 'failed' ? (
        <svg viewBox="0 0 256 256" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
          <path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 256 256" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
          <path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z" />
        </svg>
      )}
      <span aria-live="polite">{status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy'}</span>
    </button>
  )
}

export default function ChatMessageList({
  messages,
  mobile = false,
  onAssistantMarkdownClick,
  onAssistantMarkdownKeyDown,
  onChatInsert,
}: ChatMessageListProps) {
  return (
    <>
      {messages.map((message) => (
        <div
          key={message.id}
          className={`${mobile ? 'flex px-1' : 'flex'} ${message.role === 'user' ? 'justify-end' : 'justify-center'}`}
        >
          <div
            className={`group space-y-2 text-m ${
              message.role === 'user'
                ? 'max-w-[85%] rounded-[20px] bg-[var(--theme-accent)] px-4 py-3 text-white shadow-[0_0_30px_-0_rgba(0,0,0,0.12)]'
                : 'w-full max-w-full rounded-none bg-transparent px-0 py-0 text-left text-slate-700 shadow-none'
            }`}
          >
            {message.role === 'assistant' ? (
              <div
                className="assistant-markdown"
                onClick={(event) => onAssistantMarkdownClick(message, event)}
                onKeyDown={(event) => onAssistantMarkdownKeyDown(message, event)}
                dangerouslySetInnerHTML={{ __html: renderAssistantMarkdown(message.content || '', message.meta?.citations ?? []) }}
              />
            ) : (
              <p className="whitespace-pre-wrap">{message.content || '...'}</p>
            )}

            {message.role === 'assistant' && message.meta?.isStreaming ? (
              <div className="assistant-stream-indicator" aria-label="Assistant is streaming" aria-live="polite">
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </div>
            ) : null}

            {message.role === 'assistant' && !message.meta?.isStreaming && message.content?.trim() ? (
              <AssistantCopyButton text={message.content} mobile={mobile} />
            ) : null}

            {message.role === 'assistant' &&
            message.meta?.insertText &&
            message.meta.insertStatus &&
            !message.meta.isStreaming ? (
              message.meta.insertStatus === 'applied' ? (
                <p className="text-xs font-semibold text-[var(--theme-accent-text)]" role="status" aria-live="polite">
                  {message.meta.insertTargetDay ? `Added to ${message.meta.insertTargetDay}` : 'Added to notes'}
                </p>
              ) : (
                <button
                  type="button"
                  className={`min-h-11 rounded-full border border-[rgb(var(--theme-accent-rgb)/0.42)] px-3 py-2 text-xs font-semibold text-[var(--theme-accent-text)] shadow-sm transition disabled:cursor-wait disabled:opacity-60 ${
                    mobile ? '' : 'hover:-translate-y-[1px] hover:shadow-md'
                  }`}
                  disabled={message.meta.insertStatus === 'applying'}
                  onClick={() => onChatInsert(message)}
                >
                  {message.meta.insertStatus === 'applying'
                    ? message.meta.insertTargetDay
                      ? `Adding to ${message.meta.insertTargetDay}`
                      : 'Adding to notes'
                    : message.meta.insertTargetDay
                      ? `Retry insert into ${message.meta.insertTargetDay}`
                      : 'Retry insert'}
                </button>
              )
            ) : null}
          </div>
        </div>
      ))}
    </>
  )
}
