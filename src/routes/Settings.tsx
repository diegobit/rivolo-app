import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { exportMarkdownFromDb, importMarkdownToDb } from '../lib/importExport'
import { shareOrDownload } from '../lib/share'
import { DEFAULT_DROPBOX_PATH, startDropboxAuth } from '../lib/dropbox'
import { disconnectActiveProvider, pullFromSync, pushToSync } from '../lib/sync'
import {
  buttonDanger,
  buttonPill,
  buttonPillActive,
  buttonPrimary,
  buttonSecondary,
} from '../lib/ui'
import { useDaysStore } from '../store/useDaysStore'
import { useDropboxStore } from '../store/useDropboxStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useSyncStore } from '../store/useSyncStore'

const formatSyncTime = (timestamp: number | null) => {
  if (!timestamp) return 'Never'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

export default function Settings() {
  const navigate = useNavigate()
  const { loadTimeline } = useDaysStore()
  const {
    loadSettings,
    saveGeminiKey,
    updateGeminiModel,
    updateAiLanguage,
    updateWallpaper,
    updateFontPreference,
    geminiApiKey,
    geminiModel,
    aiLanguage,
    wallpaper,
    fontPreference,
  } = useSettingsStore()
  const {
    filePath,
    lastRemoteRev,
    lastSyncAt,
    localDirty,
    hasAuth,
    accountEmail,
    accountName,
    loadState: loadDropboxState,
    updateFilePath,
  } = useDropboxStore()
  const { activeProvider, loadState: loadSyncState } = useSyncStore()

  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)

  const [dropboxStatus, setDropboxStatus] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [dropboxPath, setDropboxPath] = useState('')

  const savedDropboxPath = filePath || DEFAULT_DROPBOX_PATH
  const isDropboxPathDirty = dropboxPath.trim() !== savedDropboxPath

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    void loadSettings()
    void loadDropboxState()
    void loadSyncState()
  }, [loadDropboxState, loadSettings, loadSyncState])

  useEffect(() => {
    setDropboxPath(filePath || DEFAULT_DROPBOX_PATH)
  }, [filePath])

  useEffect(() => {
    const handleStatus = () => setOnline(navigator.onLine)
    window.addEventListener('online', handleStatus)
    window.addEventListener('offline', handleStatus)
    return () => {
      window.removeEventListener('online', handleStatus)
      window.removeEventListener('offline', handleStatus)
    }
  }, [])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key !== 'Escape') return
      event.preventDefault()
      navigate('/')
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [navigate])

  const dropboxConnected = hasAuth && activeProvider === 'dropbox'
  const dropboxAccount = useMemo(() => {
    if (accountName && accountEmail) {
      return `${accountName} (${accountEmail})`
    }
    return accountEmail ?? accountName ?? '—'
  }, [accountEmail, accountName])

  const dropboxSummary = useMemo(
    () => ({
      connected: dropboxConnected,
      lastSync: formatSyncTime(lastSyncAt),
      rev: lastRemoteRev ?? '—',
      dirty: localDirty,
      account: dropboxAccount,
    }),
    [dropboxAccount, dropboxConnected, lastRemoteRev, lastSyncAt, localDirty],
  )

  const llmStatus = geminiApiKey ? 'Ready' : 'No key'

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
    const filename = (filePath || DEFAULT_DROPBOX_PATH).split('/').pop() || 'inbox.md'
    await shareOrDownload(filename, content)
  }

  const handleConnectDropbox = async () => {
    setDropboxStatus(null)

    if (!online) {
      setDropboxStatus('Connect to the internet to link Dropbox.')
      return
    }

    try {
      await startDropboxAuth()
    } catch (error) {
      setDropboxStatus(error instanceof Error ? error.message : 'Dropbox connect failed.')
    }
  }

  const handleDisconnectDropbox = async () => {
    setDropboxStatus(null)

    try {
      await disconnectActiveProvider()
      await loadDropboxState()
      await loadSyncState()
      setDropboxStatus('Dropbox disconnected.')
    } catch (error) {
      setDropboxStatus(error instanceof Error ? error.message : 'Dropbox disconnect failed.')
    }
  }

  const handlePull = async () => {
    setDropboxStatus(null)

    if (!dropboxConnected) {
      setDropboxStatus('Connect Dropbox first.')
      return
    }

    setSyncBusy(true)
    try {
      const result = await pullFromSync()
      await loadTimeline()
      await loadDropboxState()
      await loadSyncState()
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

    if (!dropboxConnected) {
      setDropboxStatus('Connect Dropbox first.')
      return
    }

    setSyncBusy(true)
    try {
      const result = await pushToSync(force)
      await loadDropboxState()
      await loadSyncState()
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
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-600">LLM Access</h2>
            <p className="mt-1 text-xs text-slate-500">
              Add a Gemini API key to enable the Ask Anything assistant.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">
            {llmStatus}
          </span>
        </div>

        <form className="mt-4" onSubmit={handleSaveKey}>
          <div className="flex flex-wrap items-center gap-3">
            <input
              className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
              placeholder="Gemini API key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <button
              className={
                apiKey.trim()
                  ? `${buttonPrimary} text-black`
                  : 'rounded-xl bg-slate-300 px-4 py-2 text-sm font-semibold text-white shadow-sm'
              }
              type="submit"
              disabled={!apiKey.trim()}
            >
              {geminiApiKey ? 'Replace Gemini Key' : 'Save Gemini Key'}
            </button>
          </div>
        </form>

        <div className="mt-5 space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Model</span>
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
            placeholder="gemini-2.5-flash"
            value={geminiModel}
            onChange={(event) => void updateGeminiModel(event.target.value)}
          />
        </div>

        <div className="mt-5 space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reply Language</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={aiLanguage === 'follow' ? buttonPillActive : buttonPill}
              type="button"
              onClick={() => void updateAiLanguage('follow')}
            >
              Follow User
            </button>
            <input
              className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
              placeholder="or type: Italian, English..."
              value={aiLanguage === 'follow' ? '' : aiLanguage}
              onChange={(event) => {
                const value = event.target.value.trim()
                void updateAiLanguage(value || 'follow')
              }}
            />
          </div>
        </div>

        {status && <p className="mt-3 text-xs text-slate-500">{status}</p>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-600">Appearance</h2>
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Wallpaper</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className={wallpaper === 'white' ? buttonPillActive : buttonPill}
                type="button"
                onClick={() => void updateWallpaper('white')}
              >
                White
              </button>
              <button
                className={wallpaper === 'thoughts-light' ? buttonPillActive : buttonPill}
                type="button"
                onClick={() => void updateWallpaper('thoughts-light')}
              >
                Thoughts Light
              </button>
              <button
                className={wallpaper === 'thoughts-medium' ? buttonPillActive : buttonPill}
                type="button"
                onClick={() => void updateWallpaper('thoughts-medium')}
              >
                Thoughts Medium
              </button>
              <button
                className={wallpaper === 'thoughts-high' ? buttonPillActive : buttonPill}
                type="button"
                onClick={() => void updateWallpaper('thoughts-high')}
              >
                Thoughts High
              </button>
            </div>
          </div>

          <div className="mt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Font</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className={fontPreference === 'proportional' ? buttonPillActive : buttonPill}
                type="button"
                onClick={() => void updateFontPreference('proportional')}
              >
                Proportional
              </button>
              <button
                className={fontPreference === 'monospace' ? buttonPillActive : buttonPill}
                type="button"
                onClick={() => void updateFontPreference('monospace')}
                style={{ fontFamily: "'CartographCF', ui-monospace, SFMono-Regular, Menlo, monospace" }}
              >
                Monospace
              </button>
            </div>
          </div>

      </section>


      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-600">Dropbox Sync</h2>
          <span
            className={`rounded-full px-2 py-1 text-xs font-semibold ${
              geminiApiKey ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {geminiApiKey ? 'Ready' : llmStatus}
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
              <button className={buttonDanger} type="button" onClick={handleDisconnectDropbox}>
                Disconnect Dropbox
              </button>
            ) : (
              <button
                className={buttonPrimary}
                type="button"
                onClick={handleConnectDropbox}
                disabled={!online}
              >
                Connect Dropbox
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
              placeholder={DEFAULT_DROPBOX_PATH}
              value={dropboxPath}
              onChange={(event) => setDropboxPath(event.target.value)}
            />
            <button
              className={
                isDropboxPathDirty
                  ? buttonPrimary
                  : 'rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500'
              }
              type="button"
              disabled={!isDropboxPathDirty}
              onClick={() => void updateFilePath(dropboxPath.trim())}
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
              onClick={handlePull}
              disabled={syncBusy || !online || !dropboxSummary.connected}
            >
              Pull from Dropbox
            </button>
            <button
              className={buttonPrimary}
              type="button"
              onClick={() => handlePush(false)}
              disabled={syncBusy || !online || !dropboxSummary.connected}
            >
              Push to Dropbox
            </button>
            <button
              className={buttonDanger}
              type="button"
              onClick={() => handlePush(true)}
              disabled={syncBusy || !online || !dropboxSummary.connected}
            >
              Force overwrite
            </button>
          </div>
          {dropboxStatus && <p className="text-xs text-slate-500">{dropboxStatus}</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-600">Import / Export</h2>
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Import</h3>
          <div className="mt-3 flex flex-wrap gap-3">
            <label className={buttonSecondary}>
              <input type="file" accept=".md,text/markdown,text/plain" onChange={handleImport} />
            </label>
          </div>
          {importStatus && <p className="mt-3 text-xs text-slate-500">{importStatus}</p>}
        </div>
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Export</h3>
          <div className="mt-3 flex flex-wrap gap-3">
            <button className={buttonPrimary} type="button" onClick={handleExport}>
              Export {savedDropboxPath}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
