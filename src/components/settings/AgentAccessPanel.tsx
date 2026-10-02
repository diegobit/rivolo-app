import { useState } from 'react'
import {
  RIVOLO_MCP_ENDPOINT,
  type AgentAccessViewState,
} from '../../lib/agentAccess'
import { SYNC_PROVIDER_LABELS, type SyncProviderId } from '../../lib/syncState'
import { buttonDangerQuiet, buttonPrimary, buttonSecondary } from '../../lib/ui'
import { buildAgentSetupPrompt } from '../../lib/agentSetupPrompt'
import AgentAccessTokensPanel from './AgentAccessTokensPanel'

export type AgentAccessPanelProps = {
  provider: SyncProviderId
  view: AgentAccessViewState
  busy: boolean
  online: boolean
  targetReady: boolean
  advanced?: boolean
  onEnable: () => void | Promise<void>
  onDisable: () => void | Promise<void>
  onRetry: () => void | Promise<void>
}

export default function AgentAccessPanel({
  provider,
  view,
  busy,
  online,
  targetReady,
  advanced = false,
  onEnable,
  onDisable,
  onRetry,
}: AgentAccessPanelProps) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const enabled = view.state === 'enabled'
  const canEnable = online && targetReady && !busy
  const badgeLabel =
    view.state === 'enabled'
      ? 'Enabled'
      : view.state === 'disabled'
        ? 'Disabled'
        : view.state === 'loading'
          ? 'Checking'
          : 'Unavailable'

  const copyEndpoint = async () => {
    try {
      await navigator.clipboard.writeText(RIVOLO_MCP_ENDPOINT)
      setCopyStatus('Copied.')
    } catch {
      setCopyStatus('Copy failed. Select the endpoint and copy it manually.')
    }
  }

  const copySetupPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildAgentSetupPrompt())
      setCopyStatus('Setup prompt copied. Replace the token placeholder before connecting.')
    } catch {
      setCopyStatus('Could not copy the setup prompt. Try again.')
    }
  }

  return (
    <details
      aria-labelledby={`agent-access-title-${provider}`}
      className="group rounded-xl border border-slate-200 px-3 open:pb-4 sm:px-4"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-sky-500 [&::-webkit-details-marker]:hidden">
        <h3 id={`agent-access-title-${provider}`} className="flex-1 text-sm font-semibold text-slate-700">
          Agent access
        </h3>
        <span
          className={`rounded-full px-2 py-1 text-xs font-semibold ${
            enabled
              ? 'bg-green-200 text-green-800'
              : view.state === 'error'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-200 text-slate-600'
          }`}
        >
          {badgeLabel}
        </span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180">
          <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>

      {view.state === 'loading' && (
        <p className="mt-3 text-xs text-slate-500" role="status">
          Checking Agent access…
        </p>
      )}

      {view.state === 'error' && (
        <div className="mt-3 space-y-2" role="alert">
          <p className="text-xs text-rose-700">{view.message}</p>
          <button
            className={`${buttonSecondary} min-h-11`}
            type="button"
            disabled={busy || !online}
            onClick={() => void onRetry()}
          >
            Retry
          </button>
        </div>
      )}

      {view.state === 'disabled' && (
        <div className="mt-3 space-y-2">
          <button
            className={`${buttonPrimary} min-h-11`}
            type="button"
            disabled={!canEnable}
            onClick={() => void onEnable()}
          >
            {busy ? 'Enabling…' : `Enable for ${SYNC_PROVIDER_LABELS[provider]}`}
          </button>
          {!targetReady && (
            <p className="text-xs text-amber-700">
              Sync this provider once before enabling Agent access.
            </p>
          )}
          {view.message && (
            <p className="text-xs text-slate-500" role="status">
              {view.message}
            </p>
          )}
        </div>
      )}

      {view.state === 'enabled' && (
        <div className="mt-3 space-y-3">
          {advanced && (
            <dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
              {view.profile.provider === 'google-drive' && (
                <div className="min-w-0">
                  <dt className="font-semibold text-slate-500">Google file ID</dt>
                  <dd className="break-all">{view.profile.target.fileId}</dd>
                </div>
              )}
              <div className="min-w-0">
                <dt className="font-semibold text-slate-500">Profile ID</dt>
                <dd className="break-all">{view.profile.profileId}</dd>
              </div>
              <div className="min-w-0">
                <dt className="font-semibold text-slate-500">Updated</dt>
                <dd>{new Date(view.profile.updatedAt).toLocaleString()}</dd>
              </div>
            </dl>
          )}

          <AgentAccessTokensPanel
            key={view.profile.profileId}
            profileId={view.profile.profileId}
            online={online}
            advanced={advanced}
          />

          {view.message && (
            <p className="text-xs text-slate-500" role="status">
              {view.message}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 space-y-3">
        {advanced && (
          <>
            <div className="text-xs font-semibold text-slate-500">MCP endpoint</div>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <code className="min-h-11 min-w-0 flex-1 break-all rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                {RIVOLO_MCP_ENDPOINT}
              </code>
              <button
                className={`${buttonSecondary} min-h-11 shrink-0`}
                type="button"
                onClick={() => void copyEndpoint()}
              >
                Copy endpoint
              </button>
            </div>
          </>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            className={`${enabled ? buttonPrimary : buttonSecondary} min-h-11 w-full sm:w-auto`}
            type="button"
            onClick={() => void copySetupPrompt()}
          >
            Copy setup prompt
          </button>
          {enabled && (
            <button
              className={`${buttonDangerQuiet} min-h-11`}
              type="button"
              disabled={busy || !online}
              onClick={() => void onDisable()}
            >
              {busy ? 'Disabling…' : 'Disable Agent access'}
            </button>
          )}
        </div>
        {copyStatus && (
          <p className="mt-1 text-xs text-slate-500" role="status">
            {copyStatus}
          </p>
        )}
      </div>
    </details>
  )
}
