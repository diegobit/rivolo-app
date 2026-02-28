export type GeminiMessage = {
  role: 'user' | 'model'
  parts: { text: string }[]
}

export type GeminiChatOptions = {
  apiKey: string
  model: string
  messages: GeminiMessage[]
  allowThinking?: boolean
  allowWebSearch?: boolean
  temperature?: number
  maxTokens?: number
  responseMimeType?: string
  stream?: boolean
  onToken?: (chunk: string) => void
}

const extractText = (payload: unknown) => {
  const entries = Array.isArray(payload) ? payload : [payload]

  return entries
    .map((entry) => {
      const typed = entry as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
      }
      const parts = typed.candidates?.[0]?.content?.parts ?? []
      return parts
        .filter((part) => !part.thought)
        .map((part) => part.text ?? '')
        .join('')
    })
    .join('')
}

const supportsJsonResponseMimeType = (model: string) => {
  const normalized = model.replace(/^models\//, '')
  const match = normalized.match(/^gemini-(\d+)/i)
  if (!match) return false

  const major = Number.parseInt(match[1], 10)
  return Number.isFinite(major) && major >= 3
}

const readStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onToken?: (chunk: string) => void,
) => {
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let sawSse = false

  const handleSseFrame = (frame: string) => {
    if (!frame.trim()) {
      return
    }

    const payloadLines = frame
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s*/, ''))

    if (!payloadLines.length) {
      return
    }

    const payload = payloadLines.join('\n').trim()
    if (!payload || payload === '[DONE]') {
      return
    }

    try {
      const parsed = JSON.parse(payload)
      const chunk = extractText(parsed)
      if (chunk) {
        text += chunk
        onToken?.(chunk)
      }
    } catch {
      // Ignore malformed SSE frames and continue streaming.
    }
  }

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

    while (true) {
      const boundaryMatch = buffer.match(/\r?\n\r?\n/)
      if (!boundaryMatch || boundaryMatch.index == null) {
        break
      }

      const frame = buffer.slice(0, boundaryMatch.index)
      buffer = buffer.slice(boundaryMatch.index + boundaryMatch[0].length)
      handleSseFrame(frame)
    }
  }

  if (sawSse && buffer.trim()) {
    handleSseFrame(buffer)
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
  allowThinking = false,
  allowWebSearch = true,
  temperature = 0.2,
  maxTokens = 2048,
  responseMimeType,
  stream = false,
  onToken,
}: GeminiChatOptions) => {
  const endpoint = stream ? 'streamGenerateContent' : 'generateContent'
  const streamQuery = stream ? '&alt=sse' : ''
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${apiKey}${streamQuery}`
  const tools = allowWebSearch ? [{ googleSearch: {} }] : null
  const thinkingConfig = { thinkingBudget: 0, includeThoughts: false }
  const canUseJsonResponseMimeType = supportsJsonResponseMimeType(model)

  const toRequestBody = (includeThinkingConfig: boolean) => {
    const body = {
      contents: messages,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        ...(responseMimeType && canUseJsonResponseMimeType ? { responseMimeType } : {}),
        ...(includeThinkingConfig ? { thinkingConfig } : {}),
      },
    }

    if (tools) {
      return JSON.stringify({ ...body, tools })
    }

    return JSON.stringify(body)
  }

  const summarizeError = (errorText: string) => {
    const trimmed = errorText.trim()
    if (!trimmed) return ''
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed
  }

  const request = async (includeThinkingConfig: boolean) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: toRequestBody(includeThinkingConfig),
    })

    if (response.ok) {
      return { response, errorText: null as string | null }
    }

    const errorText = await response.text()
    return { response, errorText }
  }

  const disableThinking = !allowThinking
  let { response, errorText } = await request(disableThinking)

  if (!response.ok && disableThinking && errorText && /thinking/i.test(errorText)) {
    const retry = await request(false)
    response = retry.response
    errorText = retry.errorText
  }

  if (!response.ok) {
    const details = errorText ? ` - ${summarizeError(errorText)}` : ''
    throw new Error(`Gemini error: ${response.status}${details}`)
  }

  if (stream && response.body) {
    const reader = response.body.getReader()
    const text = await readStream(reader, onToken)
    return { text, raw: null }
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
  }

  const text = extractText(data)

  return { text, raw: data }
}
