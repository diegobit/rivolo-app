import { buttonDanger, buttonPrimary } from '../../lib/ui'

type DropboxSummary = {
  connected: boolean
  lastSync: string
  rev: string
  dirty: boolean
  account: string
}

type DropboxSyncSectionProps = {
  dropboxSummary: DropboxSummary
  filePath: string | null
  online: boolean
  dropboxPath: string
  isDropboxPathDirty: boolean
  syncBusy: boolean
  dropboxStatus: string | null
  placeholderPath: string
  onConnectDropbox: () => void | Promise<void>
  onDisconnectDropbox: () => void | Promise<void>
  onDropboxPathChange: (value: string) => void
  onSavePath: () => void | Promise<void>
  onPull: () => void | Promise<void>
  onPush: (force?: boolean) => void | Promise<void>
}

export default function DropboxSyncSection({
  dropboxSummary,
  filePath,
  online,
  dropboxPath,
  isDropboxPathDirty,
  syncBusy,
  dropboxStatus,
  placeholderPath,
  onConnectDropbox,
  onDisconnectDropbox,
  onDropboxPathChange,
  onSavePath,
  onPull,
  onPush,
}: DropboxSyncSectionProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-600">Dropbox Sync</h2>
        <span
          className={`rounded-full px-2 py-1 text-xs font-semibold ${
            dropboxSummary.connected ? 'bg-green-200 text-green-800' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {dropboxSummary.connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-slate-500">
        <div>File: {filePath || '—'}</div>
        <div>Account: {dropboxSummary.account}</div>
        <div>Last sync: {dropboxSummary.lastSync}</div>
        <div>Remote rev: {dropboxSummary.rev}</div>
        <div>Local dirty: {dropboxSummary.dirty ? 'Yes' : 'No'}</div>
        <div>Network: {online ? 'Online' : 'Offline'}</div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {dropboxSummary.connected ? (
            <button className={buttonDanger} type="button" onClick={onDisconnectDropbox}>
              Disconnect Dropbox
            </button>
          ) : (
            <button className={buttonPrimary} type="button" onClick={onConnectDropbox} disabled={!online}>
              Connect Dropbox
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            autoComplete="off"
            type="text"
            inputMode="text"
            className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
            placeholder={placeholderPath}
            value={dropboxPath}
            onChange={(event) => onDropboxPathChange(event.target.value)}
          />
          <button
            className={
              isDropboxPathDirty
                ? buttonPrimary
                : 'rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500'
            }
            type="button"
            disabled={!isDropboxPathDirty}
            onClick={onSavePath}
          >
            Save Path
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonPrimary}
            type="button"
            onClick={onPull}
            disabled={syncBusy || !online || !dropboxSummary.connected}
          >
            Pull from Dropbox
          </button>
          <button
            className={buttonPrimary}
            type="button"
            onClick={() => onPush(false)}
            disabled={syncBusy || !online || !dropboxSummary.connected}
          >
            Push to Dropbox
          </button>
          <button
            className={buttonDanger}
            type="button"
            onClick={() => onPush(true)}
            disabled={syncBusy || !online || !dropboxSummary.connected}
          >
            Force overwrite Dropbox from local copy
          </button>
        </div>
        {dropboxStatus && <p className="text-xs text-slate-500">{dropboxStatus}</p>}
      </div>
    </section>
  )
}
