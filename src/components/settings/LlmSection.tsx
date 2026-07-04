import { useMemo, useState } from 'react'
import {
  ANTHROPIC_EFFORT_LEVELS,
  GEMINI_THINKING_LEVELS,
  LLM_PROVIDER_IDS,
  LLM_PROVIDER_REGISTRY,
  OPENAI_REASONING_EFFORTS,
  normalizeBaseUrl,
  type AnthropicEffort,
  type GeminiThinkingLevel,
  type LlmProviderId,
  type LlmProviderSettings,
  type LlmSecrets,
  type OpenAIReasoningEffort,
} from '../../lib/llm/types'
import {
  buttonDanger,
  buttonPill,
  buttonPillActive,
  buttonPrimary,
  buttonSecondary,
} from '../../lib/ui'
import SettingsToggle from './SettingsToggle'

type LlmSectionProps = {
  provider: LlmProviderId
  providerSettings: LlmProviderSettings
  llmSecrets: LlmSecrets
  aiLanguage: string
  allowWebSearch: boolean
  settingsError: string | null
  onSelectProvider: (provider: LlmProviderId) => void | Promise<void>
  onSaveProviderSettings: (
    provider: LlmProviderId,
    settings: LlmProviderSettings[LlmProviderId],
  ) => void | Promise<void>
  onSaveProviderKey: (provider: LlmProviderId, apiKey: string) => void | Promise<void>
  onClearProviderKey: (provider: LlmProviderId) => void | Promise<void>
  onFollowLanguage: () => void
  onAiLanguageChange: (value: string) => void
  onAllowWebSearchChange: (enabled: boolean) => void | Promise<void>
}

const inputClass =
  'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none transition focus:border-slate-400'

export default function LlmSection({
  provider,
  providerSettings,
  llmSecrets,
  aiLanguage,
  allowWebSearch,
  settingsError,
  onSelectProvider,
  onSaveProviderSettings,
  onSaveProviderKey,
  onClearProviderKey,
  onFollowLanguage,
  onAiLanguageChange,
  onAllowWebSearchChange,
}: LlmSectionProps) {
  const [providerDraft, setProviderDraft] = useState<LlmProviderId>(provider)
  const selectedSettings = providerSettings[providerDraft]
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const [baseUrlDraft, setBaseUrlDraft] = useState<string | null>(null)
  const [geminiThinkingDraft, setGeminiThinkingDraft] = useState<GeminiThinkingLevel | null>(null)
  const [anthropicModeDraft, setAnthropicModeDraft] = useState<'default' | 'adaptive' | null>(null)
  const [anthropicEffortDraft, setAnthropicEffortDraft] = useState<AnthropicEffort | null>(null)
  const [openaiEffortDraft, setOpenaiEffortDraft] = useState<OpenAIReasoningEffort | null>(null)
  const [allowWebSearchDraft, setAllowWebSearchDraft] = useState<boolean | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const modelValue = modelDraft ?? selectedSettings.model
  const baseUrlValue =
    baseUrlDraft ?? (providerDraft === 'openai-compatible' ? providerSettings['openai-compatible'].baseUrl : '')
  const geminiThinkingValue = geminiThinkingDraft ?? providerSettings.gemini.reasoning.thinkingLevel
  const anthropicModeValue = anthropicModeDraft ?? providerSettings.anthropic.reasoning.mode
  const anthropicEffortValue =
    anthropicEffortDraft ??
    (providerSettings.anthropic.reasoning.mode === 'adaptive'
      ? providerSettings.anthropic.reasoning.effort
      : 'high')
  const openaiEffortValue = openaiEffortDraft ?? providerSettings.openai.reasoning.effort
  const allowWebSearchValue = allowWebSearchDraft ?? allowWebSearch
  const webSearchUnavailable = LLM_PROVIDER_REGISTRY[providerDraft].webSearch === 'unsupported'

  const isConfigDirty = useMemo(() => {
    if (modelValue.trim() !== selectedSettings.model) return true
    if (!webSearchUnavailable && allowWebSearchValue !== allowWebSearch) return true
    if (providerDraft === 'openai-compatible') {
      return baseUrlValue.trim().replace(/\/+$/, '') !== providerSettings['openai-compatible'].baseUrl
    }
    if (providerDraft === 'gemini') {
      return geminiThinkingValue !== providerSettings.gemini.reasoning.thinkingLevel
    }
    if (providerDraft === 'anthropic') {
      if (anthropicModeValue !== providerSettings.anthropic.reasoning.mode) return true
      return (
        anthropicModeValue === 'adaptive' &&
        (providerSettings.anthropic.reasoning.mode !== 'adaptive' ||
          anthropicEffortValue !== providerSettings.anthropic.reasoning.effort)
      )
    }
    return openaiEffortValue !== providerSettings.openai.reasoning.effort
  }, [
    anthropicEffortValue,
    anthropicModeValue,
    allowWebSearch,
    allowWebSearchValue,
    baseUrlValue,
    geminiThinkingValue,
    modelValue,
    openaiEffortValue,
    providerDraft,
    providerSettings,
    selectedSettings.model,
    webSearchUnavailable,
  ])

  const hasPendingConfigurationChanges = providerDraft !== provider || isConfigDirty
  const hasUnsavedChanges = hasPendingConfigurationChanges || Boolean(apiKeyDraft.trim())

  const hasSavedKey = Boolean(llmSecrets[providerDraft]?.apiKey)
  const activeRegistry = LLM_PROVIDER_REGISTRY[provider]
  const registry = LLM_PROVIDER_REGISTRY[providerDraft]
  const isCustomReady =
    providerDraft === 'openai-compatible' &&
    Boolean(providerSettings['openai-compatible'].model && providerSettings['openai-compatible'].baseUrl)
  const providerStatus = hasSavedKey
    ? 'Ready'
    : providerDraft === 'openai-compatible' && isCustomReady
      ? 'Ready without key'
      : registry.requiresApiKey
        ? 'No key'
        : 'Needs configuration'
  const providerStatusClass =
    hasSavedKey || (providerDraft === 'openai-compatible' && isCustomReady)
      ? 'bg-green-200 text-green-800'
      : 'bg-rose-100 text-rose-700'

  const handleProviderChange = (nextProvider: LlmProviderId) => {
    if (
      (isConfigDirty || apiKeyDraft.trim()) &&
      !window.confirm('Discard unsaved AI provider changes and switch provider?')
    ) {
      return
    }
    setProviderDraft(nextProvider)
    setModelDraft(null)
    setBaseUrlDraft(null)
    setGeminiThinkingDraft(null)
    setAnthropicModeDraft(null)
    setAnthropicEffortDraft(null)
    setOpenaiEffortDraft(null)
    setAllowWebSearchDraft(null)
    setApiKeyDraft('')
    setStatus(null)
  }

  const handleDiscardChanges = () => {
    setProviderDraft(provider)
    setModelDraft(null)
    setBaseUrlDraft(null)
    setGeminiThinkingDraft(null)
    setAnthropicModeDraft(null)
    setAnthropicEffortDraft(null)
    setOpenaiEffortDraft(null)
    setAllowWebSearchDraft(null)
    setApiKeyDraft('')
    setStatus(null)
  }

  const handleSaveConfig = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus(null)
    const model = modelValue.trim()
    if (!model) {
      setStatus('Model ID is required.')
      return
    }

    try {
      if (providerDraft === 'gemini') {
        await onSaveProviderSettings(providerDraft, {
          model,
          reasoning: { thinkingLevel: geminiThinkingValue },
          allowThinking: geminiThinkingValue !== 'minimal',
        })
      } else if (providerDraft === 'anthropic') {
        await onSaveProviderSettings(providerDraft, {
          model,
          reasoning:
            anthropicModeValue === 'adaptive'
              ? { mode: 'adaptive', effort: anthropicEffortValue }
              : { mode: 'default' },
        })
      } else if (providerDraft === 'openai') {
        await onSaveProviderSettings(providerDraft, {
          model,
          reasoning: { effort: openaiEffortValue },
        })
      } else if (providerDraft === 'openai-compatible') {
        const baseUrl = normalizeBaseUrl(baseUrlValue)
        if (!baseUrl) {
          setStatus('Endpoint URL is required.')
          return
        }
        await onSaveProviderSettings(providerDraft, { model, baseUrl })
        setBaseUrlDraft(null)
      }
      if (!webSearchUnavailable && allowWebSearchValue !== allowWebSearch) {
        await onAllowWebSearchChange(allowWebSearchValue)
      }
      if (providerDraft !== provider) {
        await onSelectProvider(providerDraft)
      }
      setModelDraft(null)
      setGeminiThinkingDraft(null)
      setAnthropicModeDraft(null)
      setAnthropicEffortDraft(null)
      setOpenaiEffortDraft(null)
      setAllowWebSearchDraft(null)
      setStatus(`${registry.label} configuration applied.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not apply provider configuration.')
    }
  }

  const handleSaveKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const apiKey = apiKeyDraft.trim()
    if (!apiKey) {
      setStatus('Enter an API key to save it.')
      return
    }
    try {
      await onSaveProviderKey(providerDraft, apiKey)
      setApiKeyDraft('')
      setStatus(`${registry.label} key saved.`)
    } catch {
      setStatus('Could not save the API key.')
    }
  }

  const handleClearKey = async () => {
    try {
      await onClearProviderKey(providerDraft)
      setApiKeyDraft('')
      setStatus(`${registry.label} key removed.`)
    } catch {
      setStatus('Could not remove the API key.')
    }
  }

  const webSearchMessage =
    providerDraft === 'gemini'
      ? 'Gemini can use its native Google Search tool when web search is enabled.'
      : providerDraft === 'anthropic'
        ? 'Claude can use Anthropic web search when enabled. Direct requests use Anthropic’s required browser opt-in header.'
        : providerDraft === 'openai'
          ? 'OpenAI can use its Responses API web-search tool when web search is enabled.'
          : 'Uses the configured OpenAI-compatible chat endpoint.'
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-700">AI assistant</h2>
        <p className="mt-1 text-xs text-slate-500">
          Requests go only to the active provider. Choose another provider and apply its configuration to activate it.
        </p>
      </div>

      <div className="mt-5 space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reply language</span>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            className={`${aiLanguage === 'follow' ? buttonPillActive : buttonPill} shrink-0`}
            type="button"
            aria-pressed={aiLanguage === 'follow'}
            onClick={onFollowLanguage}
          >
            Follow User
          </button>
          <input
            autoComplete="off"
            type="text"
            inputMode="text"
            className={inputClass}
            placeholder="or type: Italian, English..."
            value={aiLanguage === 'follow' ? '' : aiLanguage}
            onChange={(event) => onAiLanguageChange(event.target.value)}
          />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <div className="shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Active provider
          </span>
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span className="h-2 w-2 rounded-full bg-[#22B3FF]" aria-hidden="true" />
            {activeRegistry.label}
          </div>
        </div>
        <label htmlFor="llm-provider" className="sr-only">Provider to configure</label>
        <select
          id="llm-provider"
          className={`${inputClass} flex-1`}
          value={providerDraft}
          onChange={(event) => handleProviderChange(event.target.value as LlmProviderId)}
        >
          {LLM_PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {LLM_PROVIDER_REGISTRY[id].label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-700">{registry.label}</h3>
            <p className="mt-1 break-words text-xs text-slate-500">{webSearchMessage}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${providerStatusClass}`}>
            {providerStatus}
          </span>
        </div>

        {!webSearchUnavailable && (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <SettingsToggle
              checked={allowWebSearchValue}
              label="Web search"
              onChange={setAllowWebSearchDraft}
            />
          </div>
        )}

        <form id="llm-provider-config" className="mt-4 space-y-4" onSubmit={handleSaveConfig}>
          {providerDraft === 'openai-compatible' && (
            <div className="space-y-2">
              <label htmlFor="llm-base-url" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Base URL
              </label>
              <input
                id="llm-base-url"
                autoComplete="url"
                type="url"
                className={inputClass}
                placeholder="https://example.com/v1"
                value={baseUrlValue}
                onChange={(event) => setBaseUrlDraft(event.target.value)}
              />
              <p className="break-words text-xs text-slate-500">
                Direct browser requests require endpoint CORS support and a trusted HTTPS connection outside local development.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="llm-model" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Model
            </label>
            <input
              id="llm-model"
              autoComplete="off"
              type="text"
              inputMode="text"
              className={inputClass}
              placeholder={registry.defaultModel ?? 'Required model ID'}
              value={modelValue}
              onChange={(event) => setModelDraft(event.target.value)}
            />
          </div>

          {providerDraft === 'gemini' && (
            <div className="space-y-2">
              <label htmlFor="gemini-thinking-level" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Thinking level
              </label>
              <select
                id="gemini-thinking-level"
                className={inputClass}
                value={geminiThinkingValue}
                onChange={(event) => setGeminiThinkingDraft(event.target.value as GeminiThinkingLevel)}
              >
                {GEMINI_THINKING_LEVELS.map((level) => (
                  <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500">Sent as Gemini 3’s native thinking level.</p>
            </div>
          )}

          {providerDraft === 'anthropic' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="anthropic-reasoning-mode" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Reasoning
                </label>
                <select
                  id="anthropic-reasoning-mode"
                  className={inputClass}
                  value={anthropicModeValue}
                  onChange={(event) => setAnthropicModeDraft(event.target.value as 'default' | 'adaptive')}
                >
                  <option value="default">Model default</option>
                  <option value="adaptive">Adaptive</option>
                </select>
              </div>
              {anthropicModeValue === 'adaptive' && (
                <div className="space-y-2">
                  <label htmlFor="anthropic-effort" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Adaptive effort
                  </label>
                  <select
                    id="anthropic-effort"
                    className={inputClass}
                    value={anthropicEffortValue}
                    onChange={(event) => setAnthropicEffortDraft(event.target.value as AnthropicEffort)}
                  >
                    {ANTHROPIC_EFFORT_LEVELS.map((effort) => (
                      <option key={effort} value={effort}>{effort[0].toUpperCase() + effort.slice(1)}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {providerDraft === 'openai' && (
            <div className="space-y-2">
              <label htmlFor="openai-reasoning-effort" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Reasoning effort
              </label>
              <select
                id="openai-reasoning-effort"
                className={inputClass}
                value={openaiEffortValue}
                onChange={(event) => setOpenaiEffortDraft(event.target.value as OpenAIReasoningEffort)}
              >
                {OPENAI_REASONING_EFFORTS.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort === 'default' ? 'Model default' : effort[0].toUpperCase() + effort.slice(1)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">Model default sends no reasoning-effort override.</p>
            </div>
          )}

        </form>

        <form className="mt-5 border-t border-slate-200 pt-4" onSubmit={handleSaveKey}>
          <label htmlFor="llm-api-key" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            API key{providerDraft === 'openai-compatible' ? ' (optional)' : ''}
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="llm-api-key"
              autoComplete="off"
              type="password"
              inputMode="text"
              className={inputClass}
              placeholder={hasSavedKey ? 'Saved key is hidden; enter a replacement' : 'Enter API key'}
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
            />
            <button
              className={`${buttonPrimary} shrink-0`}
              type="submit"
              disabled={!apiKeyDraft.trim()}
            >
              {hasSavedKey ? 'Replace key' : 'Save key'}
            </button>
            {hasSavedKey && (
              <button className={`${buttonDanger} shrink-0`} type="button" onClick={handleClearKey}>
                Remove key
              </button>
            )}
          </div>
        </form>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            className={`${buttonPrimary} w-full min-w-48 sm:w-auto`}
            type="submit"
            form="llm-provider-config"
            disabled={!hasPendingConfigurationChanges}
          >
            Apply provider configuration
          </button>
          {hasUnsavedChanges && (
            <button
              className={`${buttonSecondary} w-full sm:w-auto`}
              type="button"
              onClick={handleDiscardChanges}
            >
              Discard changes
            </button>
          )}
        </div>
      </div>

      {(status || settingsError) && (
        <p className="mt-3 break-words text-xs text-slate-600" role="status" aria-live="polite">
          {status ?? settingsError}
        </p>
      )}
    </section>
  )
}
