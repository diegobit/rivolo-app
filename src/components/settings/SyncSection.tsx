import { useEffect, useRef, useState } from 'react'
import { SYNC_PROVIDER_IDS, SYNC_PROVIDER_LABELS, type SyncProviderId } from '../../lib/syncState'
import { buttonDanger, buttonPrimary, buttonSecondary } from '../../lib/ui'

const OVERWRITE_ARM_TIMEOUT_MS = 4000

const buttonDangerFilled =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-xl px-4 text-sm font-semibold shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#22B3FF]/40 focus-visible:ring-offset-2 bg-rose-600 text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none'

export type SyncProviderSummary = {
  connected: boolean
  lastSync: string
  remoteVersion: string
  dirty: boolean
  account: string
  target: string
}

type SyncSectionProps = {
  activeProvider: SyncProviderId | null
  provider: SyncProviderId
  summary: SyncProviderSummary
  online: boolean
  syncPaused: boolean
  attention: string | null
  targetDraft: string
  targetDirty: boolean
  syncBusy: boolean
  status: string | null
  onProviderChange: (provider: SyncProviderId) => void
  onConnect: () => void
  onDisconnect: () => void | Promise<void>
  onActivate: () => void | Promise<void>
  onTargetChange: (value: string) => void
  onSaveTarget: () => void | Promise<void>
  onPull: () => void | Promise<void>
  onPush: (force?: boolean) => void | Promise<void>
}

const inputClass =
  'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none transition focus:border-slate-400'

export default function SyncSection({
  activeProvider,
  provider,
  summary,
  online,
  syncPaused,
  attention,
  targetDraft,
  targetDirty,
  syncBusy,
  status,
  onProviderChange,
  onConnect,
  onDisconnect,
  onActivate,
  onTargetChange,
  onSaveTarget,
  onPull,
  onPush,
}: SyncSectionProps) {
  const label = SYNC_PROVIDER_LABELS[provider]
  const activeLabel = activeProvider ? SYNC_PROVIDER_LABELS[activeProvider] : 'None'
  const isActive = activeProvider === provider
  const targetLabel = provider === 'dropbox' ? 'Dropbox path' : 'Managed file name'
  const targetHint =
    provider === 'dropbox'
      ? 'Rivolo reads and writes this Markdown path in Dropbox.'
      : 'Rivolo creates this visible Markdown file in the /rivolo folder in My Drive and tracks it by file ID.'
  const syncControlsDisabled = syncBusy || syncPaused
  const syncTabStatus = syncPaused ? 'Paused in this tab' : 'Primary tab'

  const [overwriteArmed, setOverwriteArmed] = useState(false)
  const overwriteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disarmOverwrite = () => {
    if (overwriteTimeoutRef.current) clearTimeout(overwriteTimeoutRef.current)
    overwriteTimeoutRef.current = null
    setOverwriteArmed(false)
  }

  useEffect(() => {
    return () => {
      if (overwriteTimeoutRef.current) clearTimeout(overwriteTimeoutRef.current)
    }
  }, [])

  // Disarm whenever the provider or its selected target changes (adjusting state during
  // render, per https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const selectionKey = `${provider}:${summary.target}`
  const [armedForKey, setArmedForKey] = useState(selectionKey)
  if (selectionKey !== armedForKey) {
    setArmedForKey(selectionKey)
    if (overwriteArmed) setOverwriteArmed(false)
  }

  const handleOverwriteClick = () => {
    if (!overwriteArmed) {
      setOverwriteArmed(true)
      overwriteTimeoutRef.current = setTimeout(disarmOverwrite, OVERWRITE_ARM_TIMEOUT_MS)
      return
    }
    disarmOverwrite()
    void onPush(true)
  }

  const syncActionsDisabled = syncControlsDisabled || !online || !summary.connected || !isActive
  const disabledReason = !online
    ? "You're offline — sync actions are unavailable."
    : !summary.connected
      ? `Connect ${label} to enable sync actions.`
      : !isActive
        ? `Activate ${label} to pull or push.`
        : null

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-700">Cloud sync</h2>
        <p className="mt-1 text-xs text-slate-500">
          Only the active provider auto-syncs. Connected providers remain available when you switch.
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active provider</span>
          <div className="mt-1 flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700">
            <span className={`h-2 w-2 rounded-full ${activeProvider ? 'bg-[#22B3FF]' : 'bg-slate-300'}`} />
            {activeLabel}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <label
            htmlFor="sync-provider"
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Configure
          </label>
          <select
            id="sync-provider"
            className={`${inputClass} mt-1`}
            value={provider}
            onChange={(event) => onProviderChange(event.target.value as SyncProviderId)}
          >
            {SYNC_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>{SYNC_PROVIDER_LABELS[id]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-700">{label}</h3>
            <p className="mt-1 break-words text-xs text-slate-500">{targetHint}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${summary.connected ? 'bg-green-200 text-green-800' : 'bg-slate-200 text-slate-600'}`}>
            {summary.connected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        <div className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
          <div className="min-w-0 break-words">File: {summary.target || '—'}</div>
          <div className="min-w-0 break-words">Account: {summary.account}</div>
          <div>Last sync: {summary.lastSync}</div>
          <div>Remote version: {summary.remoteVersion}</div>
          <div>Local changes: {summary.dirty ? 'Not synced' : 'Synced'}</div>
          <div>Network: {online ? 'Online' : 'Offline'}</div>
          <div>Tab sync: {syncTabStatus}</div>
        </div>

        {syncPaused && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Auto-sync and sync settings are paused here because another Rivolo tab is primary.
          </div>
        )}

        {attention && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="alert">
            Automatic sync needs attention: {attention}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {summary.connected ? (
            <button className={`${buttonDanger} min-h-11`} type="button" onClick={onDisconnect} disabled={syncControlsDisabled}>
              Disconnect {label}
            </button>
          ) : (
            <button className={`${buttonPrimary} min-h-11`} type="button" onClick={onConnect} disabled={syncControlsDisabled || !online}>
              Connect {label}
            </button>
          )}
          {summary.connected && !isActive && (
            <button className={`${buttonPrimary} min-h-11`} type="button" onClick={onActivate} disabled={syncControlsDisabled}>
              Use {label} for sync
            </button>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor="sync-target" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {targetLabel}
          </label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              id="sync-target"
              autoComplete="off"
              className={inputClass}
              value={targetDraft}
              disabled={syncPaused}
              onChange={(event) => onTargetChange(event.target.value)}
            />
            <button className={`${buttonPrimary} min-h-11 shrink-0`} type="button" disabled={syncControlsDisabled || !targetDirty} onClick={onSaveTarget}>
              Save
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className={`${buttonSecondary} min-h-11`} type="button" onClick={onPull} disabled={syncActionsDisabled}>
            Pull from {label}
          </button>
          <button className={`${buttonPrimary} min-h-11`} type="button" onClick={() => onPush(false)} disabled={syncActionsDisabled}>
            Push to {label}
          </button>
          <button
            className={`${overwriteArmed ? buttonDangerFilled : buttonDanger} min-h-11`}
            type="button"
            onClick={handleOverwriteClick}
            disabled={syncActionsDisabled}
          >
            {overwriteArmed ? 'Confirm overwrite' : 'Restore from local copy'}
          </button>
        </div>
        {syncActionsDisabled && disabledReason && (
          <p className="mt-3 text-xs text-slate-500">{disabledReason}</p>
        )}
        {status && <p className="mt-3 text-xs text-slate-500" role="status">{status}</p>}
      </div>
    </section>
  )
}
