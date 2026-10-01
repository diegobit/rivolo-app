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

function MessageCopyButton({ text, align }: { text: string; align: 'start' | 'end' }) {
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
      className={`hover-reveal inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-[var(--theme-text)] sm:h-9 sm:w-9 ${
        align === 'end' ? '-mr-1 sm:-mr-1.5' : '-ml-2 sm:-ml-2.5'
      } ${
        status === 'copied'
          ? 'text-[var(--theme-accent-text)]'
          : status === 'failed'
            ? 'text-[var(--theme-danger-text)]'
            : ''
      }`}
      aria-label="Copy message"
      title="Copy message"
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
        <svg viewBox="0 0 256 256" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z" />
        </svg>
      ) : status === 'failed' ? (
        <svg viewBox="0 0 256 256" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 256 256" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M184,64H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H184a8,8,0,0,0,8-8V72A8,8,0,0,0,184,64Zm-8,144H48V80H176ZM224,40V184a8,8,0,0,1-16,0V48H72a8,8,0,0,1,0-16H216A8,8,0,0,1,224,40Z" />
        </svg>
      )}
      <span className="sr-only" aria-live="polite">
        {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy'}
      </span>
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
            className={`group text-m ${
              message.role === 'user'
                ? 'flex max-w-[85%] flex-col items-end space-y-1'
                : 'w-full max-w-full space-y-2 text-left'
            }`}
          >
            {message.role === 'assistant' ? (
              <div
                className="assistant-markdown w-full rounded-none bg-transparent px-0 py-0 text-slate-700 shadow-none"
                onClick={(event) => onAssistantMarkdownClick(message, event)}
                onKeyDown={(event) => onAssistantMarkdownKeyDown(message, event)}
                dangerouslySetInnerHTML={{ __html: renderAssistantMarkdown(message.content || '', message.meta?.citations ?? []) }}
              />
            ) : (
              <div className="rounded-[20px] bg-[var(--theme-accent)] px-4 py-3 text-white shadow-[0_0_30px_-0_rgba(0,0,0,0.12)]">
                <p className="whitespace-pre-wrap">{message.content || '...'}</p>
              </div>
            )}

            {message.role === 'assistant' && message.meta?.isStreaming ? (
              <div className="assistant-stream-indicator" aria-label="Assistant is streaming" aria-live="polite">
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </div>
            ) : null}

            {!message.meta?.isStreaming && message.content?.trim() ? (
              <MessageCopyButton text={message.content} align={message.role === 'user' ? 'end' : 'start'} />
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
