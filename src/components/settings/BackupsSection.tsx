import { useEffect, useState } from 'react'
import {
  importMarkdownToDb,
  listRollbackBackups,
  type ImportRollbackBackup,
} from '../../lib/importExport'
import { getTabSyncBlockReason } from '../../lib/tabSyncCoordinator'
import { buttonSecondary } from '../../lib/ui'

type BackupsSectionProps = {
  onRestored: () => Promise<void> | void
}

const formatBackupTime = (timestamp: number) => {
  if (!timestamp) return 'Unknown time'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

export default function BackupsSection({ onRestored }: BackupsSectionProps) {
  const [backups, setBackups] = useState<ImportRollbackBackup[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  const loadBackups = async () => {
    setBackups(await listRollbackBackups())
  }

  useEffect(() => {
    void loadBackups()
  }, [])

  const handleRestore = async (backup: ImportRollbackBackup) => {
    setStatus(null)
    const blockedReason = getTabSyncBlockReason()
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

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-slate-700">Local backups</h2>
      <p className="mt-1 text-xs text-slate-500">
        Rivolo saves a backup of your notes before every full replacement, such as a sync pull.
        Restoring replaces the current notes and marks them for upload.
      </p>

      {backups.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">No backups yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {backups.map((backup, index) => (
            <li
              key={`${backup.createdAt}-${index}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
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

      {status && <p className="mt-3 text-xs text-slate-500" role="status">{status}</p>}
    </section>
  )
}
