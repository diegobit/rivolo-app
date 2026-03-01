import { renderAssistantMarkdown } from '../../lib/assistantMarkdown'
import type { ChatUiMessage } from '../../store/useChatStore'

type ChatMessageListProps = {
  messages: ChatUiMessage[]
  mobile?: boolean
  onAssistantMarkdownClick: (message: ChatUiMessage, event: React.MouseEvent<HTMLElement>) => void
  onAssistantMarkdownKeyDown: (message: ChatUiMessage, event: React.KeyboardEvent<HTMLElement>) => void
  onChatInsert: (message: ChatUiMessage) => void
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
            className={`space-y-2 text-m ${
              message.role === 'user'
                ? 'max-w-[85%] rounded-2xl bg-[#22B3FF] px-4 py-3 text-white shadow-[0_0_30px_-0_rgba(0,0,0,0.12)]'
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

            {message.role === 'assistant' && message.meta?.insertText && !message.meta?.isStreaming ? (
              <button
                className={
                  mobile
                    ? 'rounded-full border border-[#22B3FF]/40 px-3 py-1 text-xs font-semibold text-[#22B3FF] shadow-sm transition'
                    : 'rounded-full border border-[#22B3FF]/40 px-3 py-1 text-xs font-semibold text-[#22B3FF] shadow-sm transition hover:-translate-y-[1px] hover:shadow-md'
                }
                onClick={() => onChatInsert(message)}
              >
                {message.meta.insertTargetDay ? `Insert into ${message.meta.insertTargetDay}` : 'Insert summary'}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </>
  )
}
