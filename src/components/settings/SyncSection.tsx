import { useEffect, useRef, useState } from 'react'
import { SYNC_PROVIDER_IDS, SYNC_PROVIDER_LABELS, type SyncProviderId } from '../../lib/syncState'
import { buttonDanger, buttonPrimary, buttonSecondary } from '../../lib/ui'
import AccordionRow from './AccordionRow'
import AgentAccessPanel, { type AgentAccessPanelProps } from './AgentAccessPanel'

const OVERWRITE_ARM_TIMEOUT_MS = 4000

const buttonDangerFilled =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-xl px-4 text-sm font-semibold shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--theme-accent-rgb)/0.42)] focus-visible:ring-offset-2 bg-rose-600 text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none'

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
  summaries: Record<SyncProviderId, SyncProviderSummary>
  online: boolean
  syncPaused: boolean
  attention: string | null
  targetDraft: string
  targetDirty: boolean
  syncBusy: boolean
  status: string | null
  advanced?: boolean
  // Progressive disclosure: each force button renders only while its
  // operation is actually blocked, next to the message explaining why.
  showForcePull: boolean
  showForcePush: boolean
  onProviderChange: (provider: SyncProviderId) => void
  onConnect: () => void
  onDisconnect: () => void | Promise<void>
  onActivate: () => void | Promise<void>
  onTargetChange: (value: string) => void
  onSaveTarget: () => void | Promise<void>
  onPull: () => void | Promise<void>
  onForcePull: () => void | Promise<void>
  onPush: (force?: boolean) => void | Promise<void>
  agentAccess?: Omit<AgentAccessPanelProps, 'provider' | 'advanced'> & {
    statusKnown: boolean
    enabled: boolean
    boundToProvider: boolean
  }
}

// Destructive sync actions all share one two-click idiom: the first click arms
// the button (its label turns into an explicit confirmation), the second runs
// it. Only one button is armed at a time and arming decays after a timeout.
type ArmableAction = 'force-pull' | 'force-push' | 'alert-use-cloud' | 'alert-keep-local'

const inputClass =
  'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none transition focus:border-slate-400'

export default function SyncSection({
  activeProvider,
  provider,
  summaries,
  online,
  syncPaused,
  attention,
  targetDraft,
  targetDirty,
  syncBusy,
  status,
  advanced = false,
  showForcePull,
  showForcePush,
  onProviderChange,
  onConnect,
  onDisconnect,
  onActivate,
  onTargetChange,
  onSaveTarget,
  onPull,
  onForcePull,
  onPush,
  agentAccess,
}: SyncSectionProps) {
  const summary = summaries[provider]
  const label = SYNC_PROVIDER_LABELS[provider]
  const isActive = activeProvider === provider
  const targetLabel = provider === 'dropbox' ? 'Dropbox path' : 'Managed file name'
  const targetHint =
    provider === 'dropbox'
      ? 'Rivolo reads and writes this Markdown path in Dropbox.'
      : 'Rivolo creates this visible Markdown file in the /rivolo folder in My Drive and tracks it by file ID.'
  const syncControlsDisabled = syncBusy || syncPaused
  const providerMutationDisabled =
    syncControlsDisabled || Boolean(agentAccess && !agentAccess.statusKnown)
  const syncTabStatus = syncPaused ? 'Paused in this tab' : 'Primary tab'

  const [collapsed, setCollapsed] = useState(true)
  const [armedAction, setArmedAction] = useState<ArmableAction | null>(null)

  const armTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disarm = () => {
    if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current)
    armTimeoutRef.current = null
    setArmedAction(null)
  }

  useEffect(() => {
    return () => {
      if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current)
    }
  }, [])

  // Reset local UI state whenever the expanded provider or its selected target changes (adjusting
  // state during render, per https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const selectionKey = `${provider}:${summary.target}`
  const [armedForKey, setArmedForKey] = useState(selectionKey)
  if (selectionKey !== armedForKey) {
    setArmedForKey(selectionKey)
    if (armedAction) setArmedAction(null)
  }

  const handleArmedClick = (action: ArmableAction, run: () => void) => {
    if (armedAction !== action) {
      if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current)
      setArmedAction(action)
      armTimeoutRef.current = setTimeout(disarm, OVERWRITE_ARM_TIMEOUT_MS)
      return
    }
    disarm()
    run()
  }

  const syncActionsDisabled = syncControlsDisabled || !online || !summary.connected || !isActive
  const disabledReason = !online
    ? "You're offline — sync actions are unavailable."
    : !summary.connected
      ? `Connect ${label} to enable sync actions.`
      : !isActive
        ? `Activate ${label} to pull or push.`
        : null

  const renderArmedButton = (
    action: ArmableAction,
    idleLabel: string,
    armedLabel: string,
    run: () => void,
  ) => (
    <button
      className={`${armedAction === action ? buttonDangerFilled : buttonDanger} min-h-11`}
      type="button"
      onClick={() => handleArmedClick(action, run)}
      disabled={syncActionsDisabled}
    >
      {armedAction === action ? armedLabel : idleLabel}
    </button>
  )

  const renderProviderRows = () => (
    <div className="overflow-hidden rounded-xl border border-slate-200 divide-y divide-slate-200">
      {SYNC_PROVIDER_IDS.map((id) => {
        const rowSummary = summaries[id]
        const isSelected = id === provider
        const rowLabel = SYNC_PROVIDER_LABELS[id]
        return (
          <AccordionRow
            key={id}
            label={rowLabel}
            badgeText={rowSummary.connected ? 'Connected' : 'Not connected'}
            badgeClass={
              rowSummary.connected ? 'bg-green-200 text-green-800' : 'bg-slate-200 text-slate-600'
            }
            isActive={activeProvider === id}
            isOpen={isSelected && !collapsed}
            onToggle={() => {
              if (id !== provider) {
                onProviderChange(id)
                setCollapsed(false)
              } else {
                setCollapsed((current) => !current)
              }
            }}
            panelId={`sync-panel-${id}`}
          >
            {isSelected && (
              <div className="space-y-4 pt-3">
                <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                  <div className="min-w-0 break-words">Account: {summary.account}</div>
                  <div>Last sync: {summary.lastSync}</div>
                  {advanced && (
                    <>
                      <div className="min-w-0 break-words">File: {summary.target || '—'}</div>
                      <div>Remote version: {summary.remoteVersion}</div>
                      <div>Local changes: {summary.dirty ? 'Not synced' : 'Synced'}</div>
                      <div>Network: {online ? 'Online' : 'Offline'}</div>
                      <div>Tab sync: {syncTabStatus}</div>
                    </>
                  )}
                </div>

                {syncPaused && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Auto-sync and sync settings are paused here because another Rivolo tab is
                    primary.
                  </div>
                )}

                {attention && (
                  <div
                    className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                    role="alert"
                  >
                    Automatic sync needs attention: {attention}
                    {/* Recovery actions live inside the alert so no mode is a
                        dead end: Basic shows them only while attention is up. */}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {renderArmedButton(
                        'alert-use-cloud',
                        'Use cloud version — replaces notes on this device',
                        'Confirm — replace notes on this device',
                        () => void onForcePull(),
                      )}
                      {renderArmedButton(
                        'alert-keep-local',
                        "Keep this device's notes — replaces the cloud copy",
                        'Confirm — replace the cloud copy',
                        () => void onPush(true),
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {summary.connected ? (
                    <button
                      className={`${buttonDanger} min-h-11`}
                      type="button"
                      onClick={onDisconnect}
                      disabled={providerMutationDisabled}
                    >
                      {agentAccess?.boundToProvider
                        ? `Disable Agent access & disconnect ${rowLabel}`
                        : `Disconnect ${rowLabel}`}
                    </button>
                  ) : (
                    <button
                      className={`${buttonPrimary} min-h-11`}
                      type="button"
                      onClick={onConnect}
                      disabled={syncControlsDisabled || !online}
                    >
                      Connect {rowLabel}
                    </button>
                  )}
                  {summary.connected && activeProvider !== id && (
                    <button
                      className={`${buttonPrimary} min-h-11`}
                      type="button"
                      onClick={onActivate}
                      disabled={providerMutationDisabled}
                    >
                      {agentAccess?.enabled
                        ? `Disable Agent access, then use ${rowLabel}`
                        : `Use ${rowLabel} for sync`}
                    </button>
                  )}
                </div>

                {advanced && (
                  <>
                    <p className="break-words text-xs text-slate-500">{targetHint}</p>

                    <div>
                      <label
                        htmlFor="sync-target"
                        className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {targetLabel}
                      </label>
                      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                        <input
                          id="sync-target"
                          autoComplete="off"
                          className={inputClass}
                          value={targetDraft}
                          disabled={syncPaused || Boolean(agentAccess && !agentAccess.statusKnown)}
                          onChange={(event) => onTargetChange(event.target.value)}
                        />
                        <button
                          className={`${buttonPrimary} min-h-11 shrink-0`}
                          type="button"
                          disabled={providerMutationDisabled || !targetDirty}
                          onClick={onSaveTarget}
                        >
                          {agentAccess?.boundToProvider
                            ? 'Disable Agent access & save'
                            : 'Save'}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        className={`${buttonSecondary} min-h-11`}
                        type="button"
                        onClick={onPull}
                        disabled={syncActionsDisabled}
                      >
                        Pull from {label}
                      </button>
                      <button
                        className={`${buttonPrimary} min-h-11`}
                        type="button"
                        onClick={() => onPush(false)}
                        disabled={syncActionsDisabled}
                      >
                        Push to {label}
                      </button>
                      {showForcePull &&
                        renderArmedButton(
                          'force-pull',
                          'Force pull (overwrite local)',
                          'Confirm force pull',
                          () => void onForcePull(),
                        )}
                      {showForcePush &&
                        renderArmedButton(
                          'force-push',
                          'Force push (overwrite remote)',
                          'Confirm force push',
                          () => void onPush(true),
                        )}
                    </div>
                    {syncActionsDisabled && disabledReason && (
                      <p className="text-xs text-slate-500">{disabledReason}</p>
                    )}
                  </>
                )}

                {agentAccess && summary.connected && isActive && (
                  <AgentAccessPanel {...agentAccess} provider={provider} advanced={advanced} />
                )}

                {status && (
                  <p className="text-xs text-slate-500" role="status">
                    {status}
                  </p>
                )}
              </div>
            )}
          </AccordionRow>
        )
      })}
    </div>
  )

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div>
        <h2 className="text-lg font-bold text-slate-700">Cloud sync</h2>
        <p className="mt-1 text-xs text-slate-500">
          Only the active provider auto-syncs. Connected providers remain available when you switch.
        </p>
      </div>

      <div className="mt-5">{renderProviderRows()}</div>
    </section>
  )
}
