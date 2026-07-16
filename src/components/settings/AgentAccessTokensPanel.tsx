import { useState, type FormEvent } from 'react'
import { buttonDanger, buttonPrimary, buttonSecondary } from '../../lib/ui'
import { useAgentAccessTokens } from '../../routes/settings/useAgentAccessTokens'

type AgentAccessTokensPanelProps = {
  profileId: string
  online: boolean
}

const formatTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : 'Never'

export default function AgentAccessTokensPanel({
  profileId,
  online,
}: AgentAccessTokensPanelProps) {
  const tokens = useAgentAccessTokens(profileId, online)
  const [name, setName] = useState('')
  const [copyResult, setCopyResult] = useState<{
    tokenKey: string
    message: string
  } | null>(null)
  const tokenKey = `${profileId}:${tokens.createdToken ?? ''}`
  const copyStatus = copyResult?.tokenKey === tokenKey ? copyResult.message : null

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (await tokens.create(name)) setName('')
  }

  const copyCreatedToken = async () => {
    if (!tokens.createdToken) return
    try {
      await navigator.clipboard.writeText(tokens.createdToken)
      setCopyResult({ tokenKey, message: 'Copied.' })
    } catch {
      setCopyResult({
        tokenKey,
        message: 'Copy failed. Select the token and copy it manually.',
      })
    }
  }

  const dismissCreatedToken = () => {
    setCopyResult(null)
    tokens.dismissCreatedToken()
  }

  const revoke = async (tokenId: string, tokenName: string) => {
    const confirmed = window.confirm(
      `Revoke “${tokenName}”? Any connected agent using this token will lose access.`,
    )
    if (confirmed) await tokens.revoke(tokenId)
  }

  return (
    <section
      aria-labelledby={`agent-token-title-${profileId}`}
      className="rounded-xl border border-slate-200 bg-white p-3"
    >
      <div>
        <h4
          id={`agent-token-title-${profileId}`}
          className="text-sm font-semibold text-slate-700"
        >
          Personal access tokens
        </h4>
        <p className="mt-1 text-xs text-slate-500">
          Use a token to connect an MCP client that accepts bearer authentication. Tokens can
          read and write your cloud-synced notes.
        </p>
      </div>

      {tokens.createdToken ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">Copy this token now</p>
          <p className="mt-1 text-xs text-amber-800">
            It cannot be recovered after you dismiss it.
          </p>
          <label
            htmlFor={`created-agent-token-${profileId}`}
            className="mt-3 block text-xs font-semibold text-amber-900"
          >
            New access token
          </label>
          <input
            id={`created-agent-token-${profileId}`}
            className="mt-1 min-h-11 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 font-mono text-sm text-slate-800"
            value={tokens.createdToken}
            readOnly
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <button
              className={`${buttonPrimary} min-h-11`}
              type="button"
              onClick={() => void copyCreatedToken()}
            >
              Copy token
            </button>
            <button
              className={`${buttonSecondary} min-h-11`}
              type="button"
              onClick={dismissCreatedToken}
            >
              I saved it — dismiss
            </button>
          </div>
          {copyStatus && (
            <p className="mt-1 text-xs text-amber-800" role="status">
              {copyStatus}
            </p>
          )}
        </div>
      ) : (
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={handleCreate}>
          <div className="min-w-0 flex-1">
            <label
              htmlFor={`agent-token-name-${profileId}`}
              className="text-xs font-semibold text-slate-600"
            >
              Token name
            </label>
            <input
              id={`agent-token-name-${profileId}`}
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none transition focus:border-slate-400"
              value={name}
              maxLength={80}
              required
              autoComplete="off"
              placeholder="Claude Desktop"
              disabled={tokens.busy || !online}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <button
            className={`${buttonPrimary} min-h-11 self-stretch sm:mt-6 sm:self-auto`}
            type="submit"
            disabled={tokens.busy || !online || !name.trim()}
          >
            {tokens.busy ? 'Creating…' : 'Create token'}
          </button>
        </form>
      )}

      {tokens.actionError && (
        <p className="mt-2 text-xs text-rose-700" role="alert">
          {tokens.actionError}
        </p>
      )}

      {tokens.view.state === 'loading' && (
        <p className="mt-3 text-xs text-slate-500" role="status">
          Loading access tokens…
        </p>
      )}

      {tokens.view.state === 'error' && (
        <div className="mt-3 space-y-2" role="alert">
          <p className="text-xs text-rose-700">{tokens.view.message}</p>
          <button
            className={`${buttonSecondary} min-h-11`}
            type="button"
            disabled={!online || tokens.busy}
            onClick={() => void tokens.load()}
          >
            Retry tokens
          </button>
        </div>
      )}

      {tokens.view.state === 'ready' && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Existing tokens
          </div>
          {tokens.view.tokens.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">No access tokens yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {tokens.view.tokens.map((token) => (
                <li
                  key={token.tokenId}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 text-xs text-slate-600">
                      <div className="break-words text-sm font-semibold text-slate-700">
                        {token.name}
                      </div>
                      <div className="mt-1 font-mono text-slate-500">{token.prefix}…</div>
                      <div className="mt-1">Created: {formatTimestamp(token.createdAt)}</div>
                      <div>Last used: {formatTimestamp(token.lastUsedAt)}</div>
                      {token.revokedAt && (
                        <div className="font-semibold text-slate-500">
                          Revoked: {formatTimestamp(token.revokedAt)}
                        </div>
                      )}
                    </div>
                    {!token.revokedAt && (
                      <button
                        className={`${buttonDanger} min-h-11 shrink-0`}
                        type="button"
                        disabled={tokens.busy || !online}
                        onClick={() => void revoke(token.tokenId, token.name)}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
