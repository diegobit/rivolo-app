export const LLM_PROVIDER_IDS = ['gemini', 'anthropic', 'openai', 'openai-compatible'] as const

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number]

export const GEMINI_THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const
export type GeminiThinkingLevel = (typeof GEMINI_THINKING_LEVELS)[number]

export const ANTHROPIC_EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const
export type AnthropicEffort = (typeof ANTHROPIC_EFFORT_LEVELS)[number]

export const OPENAI_REASONING_EFFORTS = ['default', 'minimal', 'low', 'medium', 'high'] as const
export type OpenAIReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number]

export type GeminiReasoning = { thinkingLevel: GeminiThinkingLevel }
export type AnthropicReasoning =
  | { mode: 'default' }
  | { mode: 'adaptive'; effort: AnthropicEffort }
export type OpenAIReasoning = { effort: OpenAIReasoningEffort }

export type LlmProviderSettings = {
  gemini: {
    model: string
    reasoning: GeminiReasoning
    /** Kept in persisted settings for one release so older clients can still read the preference. */
    allowThinking: boolean
  }
  anthropic: { model: string; reasoning: AnthropicReasoning }
  openai: { model: string; reasoning: OpenAIReasoning }
  'openai-compatible': { model: string; baseUrl: string }
}

export type LlmSecrets = Partial<Record<LlmProviderId, { apiKey?: string }>>

export type ActiveLlmConfig =
  | {
      provider: 'gemini'
      model: string
      apiKey?: string
      reasoning: GeminiReasoning
    }
  | {
      provider: 'anthropic'
      model: string
      apiKey?: string
      reasoning: AnthropicReasoning
    }
  | {
      provider: 'openai'
      model: string
      apiKey?: string
      reasoning: OpenAIReasoning
    }
  | {
      provider: 'openai-compatible'
      model: string
      apiKey?: string
      baseUrl: string
    }

export type ProviderRegistryEntry = {
  label: string
  defaultModel: string | null
  requiresApiKey: boolean
  requiresBaseUrl: boolean
  webSearch: 'supported' | 'pending' | 'unsupported'
}

export const LLM_PROVIDER_REGISTRY: Record<LlmProviderId, ProviderRegistryEntry> = {
  gemini: {
    label: 'Gemini',
    defaultModel: 'gemini-3-flash-preview',
    requiresApiKey: true,
    requiresBaseUrl: false,
    webSearch: 'supported',
  },
  anthropic: {
    label: 'Claude',
    defaultModel: 'claude-sonnet-4-6',
    requiresApiKey: true,
    requiresBaseUrl: false,
    webSearch: 'supported',
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-5.4-mini',
    requiresApiKey: true,
    requiresBaseUrl: false,
    webSearch: 'supported',
  },
  'openai-compatible': {
    label: 'OpenAI-compatible',
    defaultModel: null,
    requiresApiKey: false,
    requiresBaseUrl: true,
    webSearch: 'unsupported',
  },
}

export const DEFAULT_LLM_PROVIDER_SETTINGS: LlmProviderSettings = {
  gemini: {
    model: 'gemini-3-flash-preview',
    reasoning: { thinkingLevel: 'minimal' },
    allowThinking: false,
  },
  anthropic: { model: 'claude-sonnet-4-6', reasoning: { mode: 'default' } },
  openai: { model: 'gpt-5.4-mini', reasoning: { effort: 'default' } },
  'openai-compatible': { model: '', baseUrl: '' },
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const isGeminiThinkingLevel = (value: unknown): value is GeminiThinkingLevel =>
  typeof value === 'string' && GEMINI_THINKING_LEVELS.includes(value as GeminiThinkingLevel)

const isAnthropicEffort = (value: unknown): value is AnthropicEffort =>
  typeof value === 'string' && ANTHROPIC_EFFORT_LEVELS.includes(value as AnthropicEffort)

const isOpenAIReasoningEffort = (value: unknown): value is OpenAIReasoningEffort =>
  typeof value === 'string' && OPENAI_REASONING_EFFORTS.includes(value as OpenAIReasoningEffort)

const normalizeAnthropicReasoning = (value: unknown): AnthropicReasoning => {
  if (!isRecord(value) || value.mode !== 'adaptive') return { mode: 'default' }
  return {
    mode: 'adaptive',
    effort: isAnthropicEffort(value.effort) ? value.effort : 'high',
  }
}

export const isLlmProviderId = (value: unknown): value is LlmProviderId =>
  typeof value === 'string' && LLM_PROVIDER_IDS.includes(value as LlmProviderId)

export const normalizeBaseUrl = (value: string) => {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Enter a valid endpoint URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Endpoint URL must use HTTP or HTTPS.')
  }
  if (url.username || url.password) {
    throw new Error('Endpoint URL must not contain credentials.')
  }

  return trimmed
}

export const normalizeProviderSettings = (
  value: unknown,
  legacyGeminiModel?: string | null,
  legacyAllowThinking?: string | null,
  readLegacyThinking = true,
): LlmProviderSettings => {
  const root = isRecord(value) ? value : {}
  const gemini = isRecord(root.gemini) ? root.gemini : {}
  const anthropic = isRecord(root.anthropic) ? root.anthropic : {}
  const openai = isRecord(root.openai) ? root.openai : {}
  const compatible = isRecord(root['openai-compatible']) ? root['openai-compatible'] : {}
  const geminiReasoning = isRecord(gemini.reasoning) ? gemini.reasoning : {}
  const openaiReasoning = isRecord(openai.reasoning) ? openai.reasoning : {}
  const legacyThinkingEnabled =
    readLegacyThinking &&
    (typeof gemini.allowThinking === 'boolean'
      ? gemini.allowThinking
      : legacyAllowThinking === 'true')
  const thinkingLevel = isGeminiThinkingLevel(geminiReasoning.thinkingLevel)
    ? geminiReasoning.thinkingLevel
    : legacyThinkingEnabled
      ? 'high'
      : 'minimal'

  return {
    gemini: {
      model:
        readString(gemini.model) ||
        readString(legacyGeminiModel) ||
        DEFAULT_LLM_PROVIDER_SETTINGS.gemini.model,
      reasoning: { thinkingLevel },
      allowThinking: thinkingLevel !== 'minimal',
    },
    anthropic: {
      model: readString(anthropic.model) || DEFAULT_LLM_PROVIDER_SETTINGS.anthropic.model,
      reasoning: normalizeAnthropicReasoning(anthropic.reasoning),
    },
    openai: {
      model: readString(openai.model) || DEFAULT_LLM_PROVIDER_SETTINGS.openai.model,
      reasoning: {
        effort: isOpenAIReasoningEffort(openaiReasoning.effort)
          ? openaiReasoning.effort
          : 'default',
      },
    },
    'openai-compatible': {
      model: readString(compatible.model),
      baseUrl: readString(compatible.baseUrl).replace(/\/+$/, ''),
    },
  }
}

export const mergePersistedProviderSettings = (
  value: unknown,
  settings: LlmProviderSettings,
): Record<string, unknown> => {
  const root = isRecord(value) ? value : {}
  const mergeProvider = (id: LlmProviderId, next: Record<string, unknown>) => ({
    ...(isRecord(root[id]) ? root[id] : {}),
    ...next,
  })

  return {
    ...root,
    gemini: mergeProvider('gemini', settings.gemini),
    anthropic: mergeProvider('anthropic', settings.anthropic),
    openai: mergeProvider('openai', settings.openai),
    'openai-compatible': mergeProvider('openai-compatible', settings['openai-compatible']),
  }
}

export const normalizeSecrets = (value: unknown): LlmSecrets => {
  const root = isRecord(value) ? value : {}
  const secrets: LlmSecrets = {}

  for (const provider of LLM_PROVIDER_IDS) {
    const entry = isRecord(root[provider]) ? root[provider] : null
    const apiKey = readString(entry?.apiKey)
    if (apiKey) secrets[provider] = { apiKey }
  }

  const legacyGeminiApiKey = readString(root.geminiApiKey)
  if (!secrets.gemini?.apiKey && legacyGeminiApiKey) {
    secrets.gemini = { apiKey: legacyGeminiApiKey }
  }

  return secrets
}

export const resolveActiveLlmConfig = (
  provider: LlmProviderId,
  providerSettings: LlmProviderSettings,
  secrets: LlmSecrets,
): ActiveLlmConfig => {
  const apiKey = secrets[provider]?.apiKey

  if (provider === 'gemini') {
    return {
      provider,
      apiKey,
      model: providerSettings.gemini.model,
      reasoning: providerSettings.gemini.reasoning,
    }
  }
  if (provider === 'openai-compatible') {
    return { provider, apiKey, ...providerSettings[provider] }
  }
  if (provider === 'anthropic') {
    return { provider, apiKey, ...providerSettings.anthropic }
  }
  return { provider, apiKey, ...providerSettings.openai }
}

export const validateActiveLlmConfig = (config: ActiveLlmConfig): string | null => {
  const registry = LLM_PROVIDER_REGISTRY[config.provider]
  if (!config.model.trim()) {
    return `${registry.label} requires a model ID.`
  }
  if (registry.requiresApiKey && !config.apiKey?.trim()) {
    return `Add a ${registry.label} API key in Settings first.`
  }
  if (config.provider === 'openai-compatible') {
    if (!config.baseUrl.trim()) return 'Configure the OpenAI-compatible endpoint URL in Settings first.'
    try {
      normalizeBaseUrl(config.baseUrl)
    } catch (error) {
      return error instanceof Error ? error.message : 'The endpoint URL is invalid.'
    }
  }
  return null
}
