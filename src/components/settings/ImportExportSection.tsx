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
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className={`${buttonSecondary} flex cursor-pointer items-center justify-center text-center`}>
          <span>Import Markdown</span>
          <input className="sr-only" type="file" accept=".md,text/markdown,text/plain" onChange={onImport} />
        </label>
        <button
          className={`${buttonPrimary} flex min-w-0 items-center justify-center overflow-hidden`}
          type="button"
          onClick={onExport}
          title={`Export ${savedDropboxPath}`}
        >
          <span className="truncate">Export {savedDropboxPath}</span>
        </button>
      </div>
      {importStatus && <p className="mt-3 text-xs text-slate-500">{importStatus}</p>}
    </section>
  )
}
