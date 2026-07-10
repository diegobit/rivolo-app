import { useState } from 'react'
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
import { isProviderReady } from '../../lib/llm/readiness'
import {
  buttonDanger,
  buttonPill,
  buttonPillActive,
  buttonPrimary,
  buttonSecondary,
} from '../../lib/ui'
import AccordionRow from './AccordionRow'
import SettingsToggle from './SettingsToggle'

type LlmSectionProps = {
  provider: LlmProviderId
  providerSettings: LlmProviderSettings
  llmSecrets: LlmSecrets
  aiLanguage: string
  allowWebSearch: boolean
  settingsError: string | null
  advanced?: boolean
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

const fieldLabelClass = 'text-xs font-semibold uppercase tracking-wide text-slate-500'

const webSearchMessages: Record<LlmProviderId, string> = {
  gemini: 'Gemini can use its native Google Search tool when web search is enabled.',
  anthropic:
    'Claude can use Anthropic web search when enabled. Direct requests use Anthropic’s required browser opt-in header.',
  openai: 'OpenAI can use its Responses API web-search tool when web search is enabled.',
  'openai-compatible': 'Uses the configured OpenAI-compatible chat endpoint.',
}

const capitalize = (value: string) => value[0].toUpperCase() + value.slice(1)

type Status = { kind: 'ok' | 'error'; message: string } | null

export default function LlmSection({
  provider,
  providerSettings,
  llmSecrets,
  aiLanguage,
  allowWebSearch,
  settingsError,
  advanced = false,
  onSelectProvider,
  onSaveProviderSettings,
  onSaveProviderKey,
  onClearProviderKey,
  onFollowLanguage,
  onAiLanguageChange,
  onAllowWebSearchChange,
}: LlmSectionProps) {
  const [expanded, setExpanded] = useState<LlmProviderId | null>(null)
  const [customLanguageOpen, setCustomLanguageOpen] = useState(false)
  const [languageDraft, setLanguageDraft] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(null)

  const showLanguageInput = customLanguageOpen || aiLanguage !== 'follow'
  const languageValue = languageDraft ?? (aiLanguage === 'follow' ? '' : aiLanguage)

  const commitLanguage = () => {
    if (languageDraft === null) return
    onAiLanguageChange(languageDraft)
    setLanguageDraft(null)
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div>
        <h2 className="text-lg font-bold text-slate-700">AI assistant</h2>
        <p className="mt-1 text-xs text-slate-500">
          Requests go only to the active provider. Changes save automatically.
        </p>
      </div>

      <div className="mt-5 space-y-2">
        <span className={fieldLabelClass}>Providers</span>
        <div className="overflow-hidden rounded-xl border border-slate-200 divide-y divide-slate-200">
          {LLM_PROVIDER_IDS.map((id) => (
            <ProviderRow
              key={id}
              id={id}
              advanced={advanced}
              isActive={id === provider}
              isOpen={expanded === id}
              onToggle={() => {
                setExpanded((current) => (current === id ? null : id))
                setStatus(null)
              }}
              providerSettings={providerSettings}
              llmSecrets={llmSecrets}
              allowWebSearch={allowWebSearch}
              status={status}
              setStatus={setStatus}
              onSelectProvider={onSelectProvider}
              onSaveProviderSettings={onSaveProviderSettings}
              onSaveProviderKey={onSaveProviderKey}
              onClearProviderKey={onClearProviderKey}
              onAllowWebSearchChange={onAllowWebSearchChange}
            />
          ))}
        </div>
      </div>

      {advanced && (
        <div className="mt-5">
          <LanguageControls
            aiLanguage={aiLanguage}
            showLanguageInput={showLanguageInput}
            languageValue={languageValue}
            onOpenCustom={() => setCustomLanguageOpen(true)}
            onFollow={() => {
              setCustomLanguageOpen(false)
              setLanguageDraft(null)
              onFollowLanguage()
            }}
            onDraftChange={setLanguageDraft}
            onCommit={commitLanguage}
          />
        </div>
      )}

      {settingsError && (
        <p className="mt-3 break-words text-xs text-rose-600" role="status" aria-live="polite">
          {settingsError}
        </p>
      )}
    </section>
  )
}

type LanguageControlsProps = {
  aiLanguage: string
  showLanguageInput: boolean
  languageValue: string
  onOpenCustom: () => void
  onFollow: () => void
  onDraftChange: (value: string) => void
  onCommit: () => void
}

function LanguageControls({
  aiLanguage,
  showLanguageInput,
  languageValue,
  onOpenCustom,
  onFollow,
  onDraftChange,
  onCommit,
}: LanguageControlsProps) {
  return (
    <div className="space-y-2">
      <span className={fieldLabelClass}>Reply language</span>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          className={`${aiLanguage === 'follow' ? buttonPillActive : buttonPill} shrink-0`}
          type="button"
          aria-pressed={aiLanguage === 'follow'}
          onClick={onFollow}
        >
          Match my language
        </button>
        <button
          className={`${aiLanguage !== 'follow' ? buttonPillActive : buttonPill} shrink-0`}
          type="button"
          aria-pressed={aiLanguage !== 'follow'}
          aria-expanded={showLanguageInput}
          onClick={onOpenCustom}
        >
          Custom
        </button>
        {showLanguageInput && (
          <input
            autoComplete="off"
            type="text"
            inputMode="text"
            autoFocus
            className="min-h-7 w-full min-w-0 rounded-full border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-slate-400 sm:w-48"
            placeholder="e.g. Italian, English..."
            value={languageValue}
            onChange={(event) => onDraftChange(event.target.value)}
            onBlur={onCommit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onCommit()
              }
            }}
          />
        )}
      </div>
    </div>
  )
}

type ProviderRowProps = {
  id: LlmProviderId
  advanced: boolean
  isActive: boolean
  isOpen: boolean
  onToggle: () => void
  providerSettings: LlmProviderSettings
  llmSecrets: LlmSecrets
  allowWebSearch: boolean
  status: Status
  setStatus: (status: Status) => void
  onSelectProvider: (provider: LlmProviderId) => void | Promise<void>
  onSaveProviderSettings: (
    provider: LlmProviderId,
    settings: LlmProviderSettings[LlmProviderId],
  ) => void | Promise<void>
  onSaveProviderKey: (provider: LlmProviderId, apiKey: string) => void | Promise<void>
  onClearProviderKey: (provider: LlmProviderId) => void | Promise<void>
  onAllowWebSearchChange: (enabled: boolean) => void | Promise<void>
}

function ProviderRow({
  id,
  advanced,
  isActive,
  isOpen,
  onToggle,
  providerSettings,
  llmSecrets,
  allowWebSearch,
  status,
  setStatus,
  onSelectProvider,
  onSaveProviderSettings,
  onSaveProviderKey,
  onClearProviderKey,
  onAllowWebSearchChange,
}: ProviderRowProps) {
  const registry = LLM_PROVIDER_REGISTRY[id]
  const settings = providerSettings[id]
  const hasSavedKey = Boolean(llmSecrets[id]?.apiKey)
  const ready = isProviderReady(id, providerSettings, llmSecrets)
  const webSearchSupported = registry.webSearch !== 'unsupported'

  // Drafts are null until the user types, so displayed values follow async-loaded settings.
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const [baseUrlDraft, setBaseUrlDraft] = useState<string | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [replacingKey, setReplacingKey] = useState(false)

  const modelValue = modelDraft ?? settings.model
  const baseUrlValue =
    baseUrlDraft ??
    (id === 'openai-compatible' ? providerSettings['openai-compatible'].baseUrl : '')

  const badge = hasSavedKey
    ? 'Ready'
    : id === 'openai-compatible' && ready
      ? 'Ready without key'
      : 'No key'
  const badgeClass =
    hasSavedKey || (id === 'openai-compatible' && ready)
      ? 'bg-green-200 text-green-800'
      : 'bg-rose-100 text-rose-700'

  // Build the merged settings object for the provider, applying one changed field.
  const buildSettings = (
    overrides: Partial<{
      model: string
      baseUrl: string
      geminiThinking: GeminiThinkingLevel
      anthropicMode: 'default' | 'adaptive'
      anthropicEffort: AnthropicEffort
      openaiEffort: OpenAIReasoningEffort
    }>,
  ): LlmProviderSettings[LlmProviderId] => {
    const model = overrides.model ?? settings.model
    if (id === 'gemini') {
      const thinkingLevel =
        overrides.geminiThinking ?? providerSettings.gemini.reasoning.thinkingLevel
      return {
        model,
        reasoning: { thinkingLevel },
        allowThinking: thinkingLevel !== 'minimal',
      }
    }
    if (id === 'anthropic') {
      const current = providerSettings.anthropic.reasoning
      const mode = overrides.anthropicMode ?? current.mode
      if (mode === 'adaptive') {
        const effort =
          overrides.anthropicEffort ?? (current.mode === 'adaptive' ? current.effort : 'high')
        return { model, reasoning: { mode: 'adaptive', effort } }
      }
      return { model, reasoning: { mode: 'default' } }
    }
    if (id === 'openai') {
      const effort = overrides.openaiEffort ?? providerSettings.openai.reasoning.effort
      return { model, reasoning: { effort } }
    }
    const baseUrl = overrides.baseUrl ?? providerSettings['openai-compatible'].baseUrl
    return { model, baseUrl }
  }

  const save = async (
    settingsToSave: LlmProviderSettings[LlmProviderId],
    successMessage?: string,
  ) => {
    try {
      await onSaveProviderSettings(id, settingsToSave)
      if (successMessage) setStatus({ kind: 'ok', message: successMessage })
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not save settings.',
      })
    }
  }

  const commitModel = () => {
    if (modelDraft === null) return
    const model = modelDraft.trim()
    setModelDraft(null)
    if (!model) {
      setStatus({ kind: 'error', message: 'Model ID is required.' })
      return
    }
    if (model === settings.model) return
    void save(buildSettings({ model }))
  }

  const commitBaseUrl = () => {
    if (baseUrlDraft === null) return
    try {
      const baseUrl = normalizeBaseUrl(baseUrlDraft)
      setBaseUrlDraft(null)
      if (!baseUrl) {
        setStatus({ kind: 'error', message: 'Endpoint URL is required.' })
        return
      }
      if (baseUrl === providerSettings['openai-compatible'].baseUrl) return
      void save(buildSettings({ baseUrl }))
    } catch (error) {
      setBaseUrlDraft(null)
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Enter a valid endpoint URL.',
      })
    }
  }

  const handleWebSearch = (enabled: boolean) => {
    setStatus(null)
    void (async () => {
      try {
        await onAllowWebSearchChange(enabled)
      } catch {
        setStatus({ kind: 'error', message: 'Could not update web search.' })
      }
    })()
  }

  const handleSaveKey = async () => {
    const apiKey = apiKeyDraft.trim()
    if (!apiKey) return
    try {
      await onSaveProviderKey(id, apiKey)
      setApiKeyDraft('')
      setReplacingKey(false)
      setStatus({ kind: 'ok', message: `${registry.label} key saved.` })
    } catch {
      setStatus({ kind: 'error', message: 'Could not save the API key.' })
    }
  }

  const handleRemoveKey = async () => {
    try {
      await onClearProviderKey(id)
      setApiKeyDraft('')
      setReplacingKey(false)
      setStatus({ kind: 'ok', message: `${registry.label} key removed.` })
    } catch {
      setStatus({ kind: 'error', message: 'Could not remove the API key.' })
    }
  }

  const handleActivate = async () => {
    setStatus(null)
    try {
      await onSelectProvider(id)
      setStatus({
        kind: 'ok',
        message: `${registry.label} is now the active provider.`,
      })
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not activate provider.',
      })
    }
  }

  const panelId = `llm-panel-${id}`
  const activationHint =
    id === 'openai-compatible'
      ? 'Set a model and base URL to activate.'
      : 'Add an API key to activate.'
  const showCompatibleSetup = id === 'openai-compatible'
  const showModelControl = advanced || id === 'openai-compatible'
  const showReasoningControls = advanced

  return (
    <AccordionRow
      label={registry.label}
      badgeText={badge}
      badgeClass={badgeClass}
      isActive={isActive}
      isOpen={isOpen}
      onToggle={onToggle}
      panelId={panelId}
    >
      {advanced && (
        <p className="break-words pt-3 text-xs text-slate-500">{webSearchMessages[id]}</p>
      )}

      {advanced && webSearchSupported && (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <SettingsToggle checked={allowWebSearch} label="Web search" onChange={handleWebSearch} />
        </div>
      )}

      {showCompatibleSetup && (
        <div className="space-y-2">
          <label htmlFor={`${id}-base-url`} className={fieldLabelClass}>
            Base URL
          </label>
          <input
            id={`${id}-base-url`}
            autoComplete="url"
            type="url"
            className={inputClass}
            placeholder="https://example.com/v1"
            value={baseUrlValue}
            onChange={(event) => setBaseUrlDraft(event.target.value)}
            onBlur={commitBaseUrl}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitBaseUrl()
              }
            }}
          />
          <p className="break-words text-xs text-slate-500">
            Direct browser requests require endpoint CORS support and a trusted HTTPS connection
            outside local development.
          </p>
        </div>
      )}

      {showModelControl && (
        <div className="space-y-2">
          <label htmlFor={`${id}-model`} className={fieldLabelClass}>
            Model
          </label>
          <input
            id={`${id}-model`}
            autoComplete="off"
            type="text"
            inputMode="text"
            className={inputClass}
            placeholder={registry.defaultModel ?? 'Required model ID'}
            value={modelValue}
            onChange={(event) => setModelDraft(event.target.value)}
            onBlur={commitModel}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitModel()
              }
            }}
          />
        </div>
      )}

      {showReasoningControls && id === 'gemini' && (
        <div className="space-y-2">
          <label htmlFor="gemini-thinking-level" className={fieldLabelClass}>
            Thinking level
          </label>
          <select
            id="gemini-thinking-level"
            className={inputClass}
            value={providerSettings.gemini.reasoning.thinkingLevel}
            onChange={(event) =>
              void save(
                buildSettings({
                  geminiThinking: event.target.value as GeminiThinkingLevel,
                }),
              )
            }
          >
            {GEMINI_THINKING_LEVELS.map((level) => (
              <option key={level} value={level}>
                {capitalize(level)}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500">Sent as Gemini 3’s native thinking level.</p>
        </div>
      )}

      {showReasoningControls && id === 'anthropic' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="anthropic-reasoning-mode" className={fieldLabelClass}>
              Reasoning
            </label>
            <select
              id="anthropic-reasoning-mode"
              className={inputClass}
              value={providerSettings.anthropic.reasoning.mode}
              onChange={(event) =>
                void save(
                  buildSettings({
                    anthropicMode: event.target.value as 'default' | 'adaptive',
                  }),
                )
              }
            >
              <option value="default">Model default</option>
              <option value="adaptive">Adaptive</option>
            </select>
          </div>
          {providerSettings.anthropic.reasoning.mode === 'adaptive' && (
            <div className="space-y-2">
              <label htmlFor="anthropic-effort" className={fieldLabelClass}>
                Adaptive effort
              </label>
              <select
                id="anthropic-effort"
                className={inputClass}
                value={providerSettings.anthropic.reasoning.effort}
                onChange={(event) =>
                  void save(
                    buildSettings({
                      anthropicEffort: event.target.value as AnthropicEffort,
                    }),
                  )
                }
              >
                {ANTHROPIC_EFFORT_LEVELS.map((effort) => (
                  <option key={effort} value={effort}>
                    {capitalize(effort)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {showReasoningControls && id === 'openai' && (
        <div className="space-y-2">
          <label htmlFor="openai-reasoning-effort" className={fieldLabelClass}>
            Reasoning effort
          </label>
          <select
            id="openai-reasoning-effort"
            className={inputClass}
            value={providerSettings.openai.reasoning.effort}
            onChange={(event) =>
              void save(
                buildSettings({
                  openaiEffort: event.target.value as OpenAIReasoningEffort,
                }),
              )
            }
          >
            {OPENAI_REASONING_EFFORTS.map((effort) => (
              <option key={effort} value={effort}>
                {effort === 'default' ? 'Model default' : capitalize(effort)}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500">
            Model default sends no reasoning-effort override.
          </p>
        </div>
      )}

      <div className="space-y-2 border-t border-slate-200 pt-4">
        <span className={fieldLabelClass}>
          API key{id === 'openai-compatible' ? ' (optional)' : ''}
        </span>
        {hasSavedKey && !replacingKey ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="flex items-center gap-1.5 text-xs text-green-700">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.29 6.8-6.79a1 1 0 0 1 1.4 0Z"
                  clipRule="evenodd"
                />
              </svg>
              API key saved
            </span>
            <div className="flex gap-2">
              <button
                className={`${buttonSecondary} shrink-0`}
                type="button"
                onClick={() => setReplacingKey(true)}
              >
                Replace key…
              </button>
              <button
                className={`${buttonDanger} shrink-0`}
                type="button"
                onClick={handleRemoveKey}
              >
                Remove key
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id={`${id}-api-key`}
              autoComplete="off"
              type="password"
              inputMode="text"
              className={inputClass}
              placeholder="Enter API key"
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
            />
            <button
              className={`${buttonPrimary} shrink-0`}
              type="button"
              disabled={!apiKeyDraft.trim()}
              onClick={handleSaveKey}
            >
              Save key
            </button>
            {replacingKey && (
              <button
                className={`${buttonSecondary} shrink-0`}
                type="button"
                onClick={() => {
                  setReplacingKey(false)
                  setApiKeyDraft('')
                }}
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      {!isActive && (
        <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center">
          <button
            className={`${buttonPrimary} w-full sm:w-auto`}
            type="button"
            disabled={!ready}
            onClick={handleActivate}
          >
            Use {registry.label}
          </button>
          {!ready && <span className="text-xs text-slate-500">{activationHint}</span>}
        </div>
      )}

      {status && (
        <p
          className={`break-words text-xs ${status.kind === 'ok' ? 'text-green-700' : 'text-rose-600'}`}
          role="status"
          aria-live="polite"
        >
          {status.message}
        </p>
      )}
    </AccordionRow>
  )
}
