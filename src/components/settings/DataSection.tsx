import { useEffect, useState } from 'react'
import {
  importMarkdownToDb,
  listRollbackBackups,
  type ImportRollbackBackup,
} from '../../lib/importExport'
import { claimPrimaryTabForSync } from '../../lib/tabSyncCoordinator'
import { buttonPrimary, buttonSecondary } from '../../lib/ui'
import type { SyncProviderId } from '../../lib/syncState'
import AccordionRow from './AccordionRow'

export type CloudVersionHistory = {
  provider: SyncProviderId
  fileName: string
  url: string
}

type DataSectionProps = {
  exportFileName: string
  importStatus: string | null
  onImport: (event: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>
  onExport: () => void | Promise<void>
  onRestored: () => Promise<void> | void
  cloudHistory?: CloudVersionHistory | null
}

const formatBackupTime = (timestamp: number) => {
  if (!timestamp) return 'Unknown time'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

export default function DataSection({
  exportFileName,
  importStatus,
  onImport,
  onExport,
  onRestored,
  cloudHistory,
}: DataSectionProps) {
  const [backups, setBackups] = useState<ImportRollbackBackup[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [backupsOpen, setBackupsOpen] = useState(false)

  const loadBackups = async () => {
    setBackups(await listRollbackBackups())
  }

  useEffect(() => {
    void loadBackups()
  }, [])

  const handleRestore = async (backup: ImportRollbackBackup) => {
    setStatus(null)
    const blockedReason = claimPrimaryTabForSync()
    if (blockedReason) {
      setStatus(blockedReason)
      return
    }

    const confirmed = window.confirm(
      `Replace current notes with the backup from ${formatBackupTime(backup.createdAt)} (${backup.dayCount} day(s))? A backup of the current notes is saved first.`,
    )
    if (!confirmed) return

    setRestoring(true)
    try {
      await importMarkdownToDb(backup.contentMd, {
        replace: true,
        markDirty: true,
        allowUnsafeImport: true,
      })
      await onRestored()
      await loadBackups()
      setStatus('Backup restored. Notes will upload on the next push.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Restore failed.')
    } finally {
      setRestoring(false)
    }
  }

  const showBackupTools = backups.length > 0 || Boolean(cloudHistory)

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <h2 className="text-lg font-bold text-slate-700">Data</h2>
      <p className="mt-1 text-xs text-slate-500">
        Import or export Rivolo Markdown (.md) files. Each entry/day must start with &lt;!-- day:YYYY-MM-DD --&gt;.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label
          className={`${buttonSecondary} flex cursor-pointer items-center justify-center text-center`}
        >
          <span>Import Markdown (.md)</span>
          <input
            className="sr-only"
            type="file"
            accept=".md,text/markdown,text/plain"
            onChange={onImport}
          />
        </label>
        <button
          className={`${buttonPrimary} flex min-w-0 items-center justify-center overflow-hidden`}
          type="button"
          onClick={onExport}
          title={`Export ${exportFileName}`}
        >
          <span className="truncate">Export {exportFileName}</span>
        </button>
      </div>
      {importStatus && <p className="mt-3 text-xs text-slate-500">{importStatus}</p>}

      {showBackupTools && (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
          <AccordionRow
            label="Local backups"
            isOpen={backupsOpen}
            onToggle={() => setBackupsOpen((current) => !current)}
            panelId="data-backups-panel"
            panelClassName="pt-4"
          >
            <p className="text-xs text-slate-500">
              Rivolo saves a local backup before every full replacement, such as a sync pull.
            </p>

            {cloudHistory && (
              <p className="text-xs text-slate-500">
                {cloudHistory.provider === 'dropbox' ? (
                  <>
                    Dropbox also keeps older versions of {cloudHistory.fileName} for at least 30
                    days:{' '}
                    <a
                      href={cloudHistory.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-slate-700"
                    >
                      dropbox.com
                    </a>
                    .
                  </>
                ) : (
                  <>
                    Google Drive also keeps older versions of {cloudHistory.fileName} for 30 days:{' '}
                    <a
                      href={cloudHistory.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-slate-700"
                    >
                      Drive folder
                    </a>
                    .
                  </>
                )}
              </p>
            )}

            {backups.length > 0 && (
              <ul className="space-y-2">
                {backups.map((backup, index) => (
                  <li
                    key={`${backup.createdAt}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="min-w-0 text-xs text-slate-600">
                      <div className="font-semibold">{formatBackupTime(backup.createdAt)}</div>
                      <div className="text-slate-500">{backup.dayCount} day(s)</div>
                    </div>
                    <button
                      className={`${buttonSecondary} min-h-11 shrink-0`}
                      type="button"
                      disabled={restoring}
                      onClick={() => void handleRestore(backup)}
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {status && <p className="text-xs text-slate-500" role="status">{status}</p>}
          </AccordionRow>
        </div>
      )}
    </section>
  )
}
