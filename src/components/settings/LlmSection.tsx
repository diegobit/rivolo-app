import { buttonPill, buttonPillActive, buttonPrimary, buttonSecondary } from '../../lib/ui'

type LlmSectionProps = {
  geminiApiKey: string | null
  geminiModel: string
  aiLanguage: string
  allowThinking: boolean
  allowWebSearch: boolean
  apiKey: string
  status: string | null
  onSaveKey: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>
  onClearKey: () => void | Promise<void>
  onApiKeyChange: (value: string) => void
  onGeminiModelChange: (value: string) => void
  onFollowLanguage: () => void
  onAiLanguageChange: (value: string) => void
  onAllowThinkingChange: (enabled: boolean) => void
  onAllowWebSearchChange: (enabled: boolean) => void
}

export default function LlmSection({
  geminiApiKey,
  geminiModel,
  aiLanguage,
  allowThinking,
  allowWebSearch,
  apiKey,
  status,
  onSaveKey,
  onClearKey,
  onApiKeyChange,
  onGeminiModelChange,
  onFollowLanguage,
  onAiLanguageChange,
  onAllowThinkingChange,
  onAllowWebSearchChange,
}: LlmSectionProps) {
  const llmStatus = geminiApiKey ? 'Ready' : 'No key'
  const llmStatusClass = geminiApiKey ? 'bg-green-200 text-green-800' : 'bg-rose-100 text-rose-700'

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-600">LLM Access</h2>
          <p className="mt-1 text-xs text-slate-500">
            Add a Gemini API key to enable the Ask Anything assistant.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap ${llmStatusClass}`}
        >
          {llmStatus}
        </span>
      </div>

      <form className="mt-4" onSubmit={onSaveKey}>
        <div className="flex flex-wrap items-center gap-3">
          <input
            autoComplete="off"
            type="password"
            inputMode="text"
            className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
            placeholder="Gemini API key"
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
          />
          <button
            className={
              apiKey.trim()
                ? `${buttonPrimary} text-black`
                : 'rounded-xl bg-slate-300 px-4 py-2 text-sm font-semibold text-white shadow-sm'
            }
            type="submit"
            disabled={!apiKey.trim()}
          >
            {geminiApiKey ? 'Replace Gemini Key' : 'Save Gemini Key'}
          </button>
          {geminiApiKey && (
            <button className={buttonSecondary} type="button" onClick={onClearKey}>
              Remove Gemini Key
            </button>
          )}
        </div>
      </form>

      <div className="mt-5 space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Model</span>
        <input
          autoComplete="off"
          type="text"
          inputMode="text"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
          placeholder="gemini-3-flash-preview"
          value={geminiModel}
          onChange={(event) => onGeminiModelChange(event.target.value)}
        />
      </div>

      <div className="mt-5 space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reply Language</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={aiLanguage === 'follow' ? buttonPillActive : buttonPill}
            type="button"
            onClick={onFollowLanguage}
          >
            Follow User
          </button>
          <input
            autoComplete="off"
            type="text"
            inputMode="text"
            className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
            placeholder="or type: Italian, English..."
            value={aiLanguage === 'follow' ? '' : aiLanguage}
            onChange={(event) => onAiLanguageChange(event.target.value)}
          />
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Allow thinking for supported models
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className={allowThinking ? buttonPillActive : buttonPill}
            type="button"
            onClick={() => onAllowThinkingChange(true)}
          >
            YES
          </button>
          <button
            className={!allowThinking ? buttonPillActive : buttonPill}
            type="button"
            onClick={() => onAllowThinkingChange(false)}
          >
            NO
          </button>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Allow web search for supported models
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className={allowWebSearch ? buttonPillActive : buttonPill}
            type="button"
            onClick={() => onAllowWebSearchChange(true)}
          >
            YES
          </button>
          <button
            className={!allowWebSearch ? buttonPillActive : buttonPill}
            type="button"
            onClick={() => onAllowWebSearchChange(false)}
          >
            NO
          </button>
        </div>
      </div>

      {status && <p className="mt-3 text-xs text-slate-500">{status}</p>}
    </section>
  )
}
