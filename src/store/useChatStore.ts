import { create } from 'zustand'

export type ChatCitation = {
  day: string
  quote: string
}

export type ChatUiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  meta?: {
    citations: ChatCitation[]
    insertText?: string | null
    insertTargetDay?: string | null
  }
}

type MessagesUpdater = ChatUiMessage[] | ((messages: ChatUiMessage[]) => ChatUiMessage[])

type ChatState = {
  messages: ChatUiMessage[]
  setMessages: (nextMessages: MessagesUpdater) => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  setMessages: (nextMessages) =>
    set((state) => ({
      messages:
        typeof nextMessages === 'function'
          ? nextMessages(state.messages)
          : nextMessages,
    })),
}))
