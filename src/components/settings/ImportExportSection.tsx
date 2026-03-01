import { buttonPrimary, buttonSecondary } from '../../lib/ui'

type ImportExportSectionProps = {
  savedDropboxPath: string
  importStatus: string | null
  onImport: (event: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>
  onExport: () => void | Promise<void>
}

export default function ImportExportSection({
  savedDropboxPath,
  importStatus,
  onImport,
  onExport,
}: ImportExportSectionProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-600">Import / Export</h2>
      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Import</h3>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className={buttonSecondary}>
            <input type="file" accept=".md,text/markdown,text/plain" onChange={onImport} />
          </label>
        </div>
        {importStatus && <p className="mt-3 text-xs text-slate-500">{importStatus}</p>}
      </div>
      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Export</h3>
        <div className="mt-3 flex flex-wrap gap-3">
          <button className={buttonPrimary} type="button" onClick={onExport}>
            Export {savedDropboxPath}
          </button>
        </div>
      </div>
    </section>
  )
}
