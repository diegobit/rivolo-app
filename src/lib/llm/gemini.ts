export type GeminiMessage = {
  role: 'user' | 'model'
  parts: { text: string }[]
}

export type GeminiChatOptions = {
  apiKey: string
  model: string
  messages: GeminiMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
  onToken?: (chunk: string) => void
}

const extractText = (payload: unknown) => {
  const entries = Array.isArray(payload) ? payload : [payload]

  return entries
    .map((entry) => {
      const typed = entry as {
        candidates?: { content?: { parts?: { text?: string }[] } }[]
      }
      return typed.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''
    })
    .join('')
}

const readStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onToken?: (chunk: string) => void,
) => {
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let sawSse = false

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    if (!sawSse && buffer.includes('data:')) {
      sawSse = true
    }

    if (!sawSse) {
      continue
    }

    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const line = part
        .split('\n')
        .map((row) => row.trim())
        .find((row) => row.startsWith('data:'))

      if (!line) continue

      const payload = line.replace(/^data:\s*/, '')
      if (payload === '[DONE]') continue

      try {
        const parsed = JSON.parse(payload)
        const chunk = extractText(parsed)
        if (chunk) {
          text += chunk
          onToken?.(chunk)
        }
      } catch {
        continue
      }
    }
  }

  if (!sawSse && buffer.trim()) {
    try {
      text = extractText(JSON.parse(buffer))
    } catch {
      text = buffer
    }

    if (text) {
      onToken?.(text)
    }
  }

  return text
}

export const chatWithGemini = async ({
  apiKey,
  model,
  messages,
  temperature = 0.2,
  maxTokens = 2048,
  stream = false,
  onToken,
}: GeminiChatOptions) => {
  const endpoint = stream ? 'streamGenerateContent' : 'generateContent'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: messages,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Gemini error: ${response.status}`)
  }

  if (stream && response.body) {
    const reader = response.body.getReader()
    const text = await readStream(reader, onToken)
    return { text, raw: null }
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }

  const text =
    data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''

  return { text, raw: data }
}
