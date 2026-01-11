import { chatWithGemini } from './gemini'
import type { GeminiMessage } from './gemini'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatOptions = {
  provider: 'gemini'
  apiKey: string
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
  onToken?: (chunk: string) => void
}

const toGeminiMessages = (messages: ChatMessage[]): GeminiMessage[] => {
  const systemText = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n')

  const chatMessages = messages.filter((message) => message.role !== 'system')
  const geminiMessages: GeminiMessage[] = []

  if (systemText) {
    geminiMessages.push({ role: 'user', parts: [{ text: systemText }] })
  }

  chatMessages.forEach((message) => {
    geminiMessages.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    })
  })

  return geminiMessages
}

export const chat = async ({ provider, apiKey, model, messages, ...rest }: ChatOptions) => {
  if (provider === 'gemini') {
    return chatWithGemini({
      apiKey,
      model,
      messages: toGeminiMessages(messages),
      ...rest,
    })
  }

  throw new Error(`Unsupported provider: ${provider}`)
}
