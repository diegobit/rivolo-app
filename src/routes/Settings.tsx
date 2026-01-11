import { useEffect, useMemo, useState } from 'react'
import { exportMarkdownFromDb, importMarkdownToDb } from '../lib/importExport'
import { shareOrDownload } from '../lib/share'
import { pullFromDropbox, pushToDropbox, saveDropboxAuth } from '../lib/dropbox'
import { buttonDanger, buttonPrimary, buttonSecondary } from '../lib/ui'
import { useDaysStore } from '../store/useDaysStore'
import { useDropboxStore } from '../store/useDropboxStore'
import { useSettingsStore } from '../store/useSettingsStore'

const formatSyncTime = (timestamp: number | null) => {
  if (!timestamp) return 'Never'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

export default function Settings() {
  const { loadTimeline } = useDaysStore()
  const { loadSettings, saveGeminiKey, updatePasscode, locked, geminiApiKey, passcode } =
    useSettingsStore()
  const { filePath, lastRemoteRev, lastSyncAt, localDirty, hasAuth, loadState, updateFilePath } =
    useDropboxStore()

  const [passcodeInput, setPasscodeInput] = useState(passcode)
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)

  const [dropboxToken, setDropboxToken] = useState('')
  const [dropboxStatus, setDropboxStatus] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    void loadSettings()
    void loadState()
  }, [loadSettings, loadState])

  useEffect(() => {
    setPasscodeInput(passcode)
  }, [passcode])

  useEffect(() => {
    const handleStatus = () => setOnline(navigator.onLine)
    window.addEventListener('online', handleStatus)
    window.addEventListener('offline', handleStatus)
    return () => {
      window.removeEventListener('online', handleStatus)
      window.removeEventListener('offline', handleStatus)
    }
  }, [])

  const dropboxSummary = useMemo(
    () => ({
      connected: hasAuth && Boolean(filePath),
      lastSync: formatSyncTime(lastSyncAt),
      rev: lastRemoteRev ?? '—',
      dirty: localDirty,
    }),
    [filePath, hasAuth, lastRemoteRev, lastSyncAt, localDirty],
  )

  const llmStatus = locked ? 'Locked' : geminiApiKey ? 'Ready' : 'No key'

  const handleUpdatePasscode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus(null)

    if (!passcodeInput.trim()) {
      setStatus('Passcode required.')
      return
    }

    const success = await updatePasscode(passcodeInput)
    setStatus(success ? 'Passcode updated.' : 'Passcode updated. Re-save API key.')
  }

  const handleSaveKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus(null)

    if (!apiKey.trim()) {
      setStatus('API key required.')
      return
    }

    await saveGeminiKey(apiKey.trim())
    setStatus('Gemini key saved.')
    setApiKey('')
  }

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const content = await file.text()
    const result = await importMarkdownToDb(content)
    await loadTimeline()
    const warningText = result.warnings.length ? ` Warnings: ${result.warnings.join(' ')}` : ''
    setImportStatus(`Imported ${result.imported} day(s).${warningText}`)
    event.target.value = ''
  }

  const handleExport = async () => {
    const content = await exportMarkdownFromDb()
    await shareOrDownload('inbox.md', content)
  }

  const handleSaveDropbox = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setDropboxStatus(null)

    if (!passcode.trim()) {
      setDropboxStatus('Set a passcode in LLM settings first.')
      return
    }

    if (!dropboxToken || !filePath) {
      setDropboxStatus('Token and file path required.')
      return
    }

    await saveDropboxAuth(passcode, dropboxToken, filePath)
    await loadState()
    setDropboxStatus('Dropbox token saved.')
    setDropboxToken('')
  }

  const handlePull = async () => {
    setDropboxStatus(null)
    if (!passcode.trim()) {
      setDropboxStatus('Set a passcode in LLM settings first.')
      return
    }

    setSyncBusy(true)
    try {
      const result = await pullFromDropbox(passcode)
      await loadTimeline()
      await loadState()
      setDropboxStatus(
        result.status === 'noop' ? 'No changes on Dropbox.' : 'Pulled and imported.',
      )
    } catch (error) {
      console.warn('[Dropbox] pull:failed', { error })
      setDropboxStatus(error instanceof Error ? error.message : 'Dropbox pull failed.')
    } finally {
      setSyncBusy(false)
    }
  }

  const handlePush = async (force = false) => {
    setDropboxStatus(null)
    if (!passcode.trim()) {
      setDropboxStatus('Set a passcode in LLM settings first.')
      return
    }

    setSyncBusy(true)
    try {
      const result = await pushToDropbox(passcode, force)
      await loadState()
      if (result.status === 'clean') {
        setDropboxStatus('No local changes to push.')
      } else if (result.status === 'blocked') {
        setDropboxStatus('Remote changed. Pull first or force overwrite.')
      } else {
        setDropboxStatus('Uploaded to Dropbox.')
      }
    } catch (error) {
      setDropboxStatus(error instanceof Error ? error.message : 'Dropbox push failed.')
    } finally {
      setSyncBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="pt-2 text-center text-3xl font-semibold text-slate-900">Rivulet</div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-600">LLM Access</h2>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">
            {llmStatus}
          </span>
        </div>

        <form className="mt-4 space-y-2" onSubmit={handleUpdatePasscode}>
          <label className="text-xs text-slate-500">
            Passcode (default is 0000)
            <input
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
              placeholder="0000"
              type="password"
              value={passcodeInput}
              onChange={(event) => setPasscodeInput(event.target.value)}
            />
          </label>
          <button className={buttonSecondary} type="submit">
            Update Passcode
          </button>
        </form>

        <form className="mt-4 space-y-3" onSubmit={handleSaveKey}>
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
            placeholder="Gemini API key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <button className={buttonPrimary} type="submit">
            Save Gemini Key
          </button>
        </form>

        {geminiApiKey && !locked && (
          <p className="mt-3 text-xs text-emerald-600">Gemini key ready for use.</p>
        )}
        {locked && (
          <p className="mt-3 text-xs text-rose-600">
            Stored key is locked. Update passcode or re-save the API key.
          </p>
        )}
        {status && <p className="mt-3 text-xs text-slate-500">{status}</p>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-600">Import / Export</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className={buttonSecondary}>
            <input type="file" accept=".md,text/markdown,text/plain" onChange={handleImport} />
          </label>
          <button className={buttonPrimary} type="button" onClick={handleExport}>
            Export inbox.md
          </button>
        </div>
        {importStatus && <p className="mt-3 text-xs text-slate-500">{importStatus}</p>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-600">Dropbox Sync</h2>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">
            {dropboxSummary.connected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        <div className="mt-3 grid gap-2 text-xs text-slate-500">
          <div>File: {filePath || '—'}</div>
          <div>Last sync: {dropboxSummary.lastSync}</div>
          <div>Remote rev: {dropboxSummary.rev}</div>
          <div>Local dirty: {dropboxSummary.dirty ? 'Yes' : 'No'}</div>
          <div>Network: {online ? 'Online' : 'Offline'}</div>
        </div>

        <form className="mt-4 space-y-3" onSubmit={handleSaveDropbox}>
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
            placeholder="/Apps/SingleNote/inbox.md"
            value={filePath}
            onChange={(event) => updateFilePath(event.target.value)}
          />
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
            placeholder="Dropbox access token"
            value={dropboxToken}
            onChange={(event) => setDropboxToken(event.target.value)}
          />
          <p className="text-xs text-slate-400">Uses the LLM passcode for encryption.</p>
          <button className={buttonSecondary} type="submit">
            Save Dropbox Token
          </button>
        </form>

        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              className={buttonPrimary}
              type="button"
              onClick={handlePull}
              disabled={syncBusy || !online}
            >
              Pull from Dropbox
            </button>
            <button
              className={buttonSecondary}
              type="button"
              onClick={() => handlePush(false)}
              disabled={syncBusy || !online}
            >
              Push to Dropbox
            </button>
            <button
              className={buttonDanger}
              type="button"
              onClick={() => handlePush(true)}
              disabled={syncBusy || !online}
            >
              Force overwrite
            </button>
          </div>
          {dropboxStatus && <p className="text-xs text-slate-500">{dropboxStatus}</p>}
        </div>
      </section>
    </div>
  )
}
