import { createAnthropic, type AnthropicLanguageModelOptions } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI, type GoogleLanguageModelOptions } from '@ai-sdk/google'
import { createOpenAI, type OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError, RetryError, generateText, streamText } from 'ai'
import { LLM_PROVIDER_REGISTRY, type ActiveLlmConfig } from './types'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatOptions = {
  config: ActiveLlmConfig
  messages: ChatMessage[]
  allowWebSearch?: boolean
  temperature?: number
  maxTokens?: number
  stream?: boolean
  onToken?: (chunk: string) => void
}

type ProviderRequest = Pick<
  Parameters<typeof streamText>[0],
  'model' | 'providerOptions' | 'tools'
>

const createProviderRequest = (
  config: ActiveLlmConfig,
  allowWebSearch: boolean,
): ProviderRequest => {
  if (config.provider === 'gemini') {
    const google = createGoogleGenerativeAI({ apiKey: config.apiKey })
    const googleOptions = {
      thinkingConfig: { thinkingLevel: config.reasoning.thinkingLevel },
    } satisfies GoogleLanguageModelOptions
    return {
      model: google(config.model),
      tools: allowWebSearch ? { google_search: google.tools.googleSearch({}) } : undefined,
      providerOptions: { google: googleOptions },
    }
  }

  if (config.provider === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: config.apiKey,
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
    })
    const anthropicOptions =
      config.reasoning.mode === 'adaptive'
        ? ({
            thinking: { type: 'adaptive' },
            effort: config.reasoning.effort,
          } satisfies AnthropicLanguageModelOptions)
        : undefined
    return {
      model: anthropic(config.model),
      tools: allowWebSearch
        ? { web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }) }
        : undefined,
      providerOptions: anthropicOptions ? { anthropic: anthropicOptions } : undefined,
    }
  }

  if (config.provider === 'openai') {
    const openai = createOpenAI({ apiKey: config.apiKey })
    const openaiOptions =
      config.reasoning.effort === 'default'
        ? undefined
        : ({ reasoningEffort: config.reasoning.effort } satisfies OpenAIResponsesProviderOptions)
    return {
      model: openai.responses(config.model),
      tools: allowWebSearch ? { web_search: openai.tools.webSearch() } : undefined,
      providerOptions: openaiOptions ? { openai: openaiOptions } : undefined,
    }
  }

  const compatible = createOpenAICompatible({
    name: 'user-configured',
    apiKey: config.apiKey || undefined,
    baseURL: config.baseUrl,
  })
  return { model: compatible(config.model) }
}

const unwrapProviderError = (error: unknown): unknown => {
  if (RetryError.isInstance(error)) return unwrapProviderError(error.lastError)
  return error
}

const findApiCallError = (error: unknown): APICallError | null => {
  const unwrapped = unwrapProviderError(error)
  if (APICallError.isInstance(unwrapped)) return unwrapped
  if (unwrapped instanceof Error && unwrapped.cause) return findApiCallError(unwrapped.cause)
  return null
}

const isAbortFailure = (error: unknown): boolean => {
  const unwrapped = unwrapProviderError(error)
  if (unwrapped instanceof DOMException && unwrapped.name === 'AbortError') return true
  if (unwrapped instanceof Error) {
    if (unwrapped.name === 'AbortError') return true
    if (unwrapped.cause) return isAbortFailure(unwrapped.cause)
  }
  return false
}

const safeModelLabel = (model: string) => model.trim().slice(0, 100).replace(/[\r\n]/g, ' ')

export const normalizeProviderError = (
  config: ActiveLlmConfig,
  error: unknown,
  allowWebSearch: boolean,
) => {
  const providerLabel = LLM_PROVIDER_REGISTRY[config.provider].label
  if (isAbortFailure(error)) return 'The AI request was cancelled.'

  const unwrapped = unwrapProviderError(error)
  const apiError = findApiCallError(unwrapped)
  const status = apiError?.statusCode
  const diagnosticText = `${
    unwrapped instanceof Error ? unwrapped.message : ''
  } ${apiError?.message ?? ''} ${apiError?.responseBody ?? ''}`.toLowerCase()

  if (
    unwrapped instanceof TypeError ||
    (!status && apiError?.cause instanceof TypeError) ||
    /failed to fetch|networkerror|network error|cors|certificate|ssl|tls/.test(diagnosticText)
  ) {
    return config.provider === 'openai-compatible'
      ? 'The browser could not reach the configured endpoint. Check the base URL, HTTPS certificate, network, and CORS policy.'
      : `The browser could not reach ${providerLabel}. Check the network, HTTPS, and browser CORS policy.`
  }

  if (status === 401 || status === 403) {
    if (allowWebSearch && /web.?search|search tool|organization|permission|not enabled/.test(diagnosticText)) {
      return `Web search is not enabled for this ${providerLabel} account or organization.`
    }
    return `${providerLabel} rejected this API key or account access.`
  }

  if (status === 404 || /model.+not found|unknown model|model_not_found/.test(diagnosticText)) {
    return `${providerLabel} model “${safeModelLabel(config.model)}” was not found or is unavailable.`
  }

  if (status === 429) {
    return `${providerLabel} rate limit or quota reached. Try again later.`
  }

  if (status === 408 || /timed? ?out|timeout/.test(diagnosticText)) {
    return `${providerLabel} did not respond in time. Try again.`
  }

  if (allowWebSearch && /web.?search|search tool/.test(diagnosticText)) {
    return `${providerLabel} rejected the web-search request. Check that the selected model and account support web search.`
  }

  if (/thinking|reasoning|effort|unsupported.+capabil|not support/.test(diagnosticText)) {
    return `${providerLabel} rejected the selected reasoning setting. Check that the selected model supports it.`
  }

  if (status != null && status >= 500) {
    return `${providerLabel} is temporarily unavailable. Try again later.`
  }

  return `${providerLabel} request failed. Check the selected model and provider settings.`
}

const execute = async (
  request: ProviderRequest,
  options: Omit<ChatOptions, 'config' | 'allowWebSearch'>,
  onChunk: (chunk: string) => void,
) => {
  const requestOptions = {
    ...request,
    messages: options.messages,
    temperature: options.temperature ?? 0.2,
    maxOutputTokens: options.maxTokens ?? 2048,
  }

  if (options.stream) {
    const result = streamText(requestOptions)
    let text = ''
    for await (const chunk of result.textStream) {
      text += chunk
      onChunk(chunk)
    }
    return { text, raw: null }
  }

  const result = await generateText(requestOptions)
  return { text: result.text, raw: result }
}

export const chat = async ({
  config,
  allowWebSearch = true,
  onToken,
  ...options
}: ChatOptions) => {
  const onChunk = (chunk: string) => {
    onToken?.(chunk)
  }

  try {
    return await execute(createProviderRequest(config, allowWebSearch), options, onChunk)
  } catch (error) {
    throw new Error(normalizeProviderError(config, error, allowWebSearch))
  }
}
