import { useState } from 'react'
import {
  RIVOLO_MCP_ENDPOINT,
  agentAccessTargetLabel,
  type AgentAccessProfile,
  type AgentAccessViewState,
} from '../../lib/agentAccess'
import { SYNC_PROVIDER_LABELS, type SyncProviderId } from '../../lib/syncState'
import { buttonDanger, buttonPrimary, buttonSecondary } from '../../lib/ui'
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

const accountLabel = (profile: AgentAccessProfile) => {
  if (profile.providerName && profile.providerEmail) {
    return `${profile.providerName} (${profile.providerEmail})`
  }
  return profile.providerEmail ?? profile.providerName ?? profile.providerAccountId
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

  return (
    <section
      aria-labelledby={`agent-access-title-${provider}`}
      className="rounded-xl border border-slate-200 bg-slate-50 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`agent-access-title-${provider}`} className="text-sm font-semibold text-slate-700">
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
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Agents see only the latest cloud-synced notes.
      </p>

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
          <dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="font-semibold text-slate-500">Provider</dt>
              <dd>{SYNC_PROVIDER_LABELS[view.profile.provider]}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold text-slate-500">Account</dt>
              <dd className="break-words">{accountLabel(view.profile)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold text-slate-500">Target</dt>
              <dd className="break-words">{agentAccessTargetLabel(view.profile)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold text-slate-500">Notes timezone</dt>
              <dd className="break-words">{view.profile.timeZone}</dd>
            </div>
            {advanced && (
              <>
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
              </>
            )}
          </dl>

          <AgentAccessTokensPanel
            key={view.profile.profileId}
            profileId={view.profile.profileId}
            online={online}
          />

          <button
            className={`${buttonDanger} min-h-11`}
            type="button"
            disabled={busy || !online}
            onClick={() => void onDisable()}
          >
            {busy ? 'Disabling…' : 'Disable Agent access'}
          </button>
          {view.message && (
            <p className="text-xs text-slate-500" role="status">
              {view.message}
            </p>
          )}
        </div>
      )}

      <div className="mt-3">
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
        {copyStatus && (
          <p className="mt-1 text-xs text-slate-500" role="status">
            {copyStatus}
          </p>
        )}
      </div>
    </section>
  )
}
