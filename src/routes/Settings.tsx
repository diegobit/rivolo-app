import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { exportMarkdownFromDb, importMarkdownToDb } from '../lib/importExport'
import {
  getMonospaceFontFamily,
  getMonospaceFontSize,
  getBodyFontFamily,
  getTitleFontFamily,
  type BodyFont,
  type MonospaceFont,
  type TitleFont,
  bodyFontOptions,
  monospaceFontOptions,
  titleFontOptions,
} from '../lib/fonts'
import { shareOrDownload } from '../lib/share'
import { DEFAULT_DROPBOX_PATH, startDropboxAuth } from '../lib/dropbox'
import { disconnectActiveProvider } from '../lib/sync'
import {
  buttonDanger,
  buttonPill,
  buttonPillActive,
  buttonPrimary,
  buttonSecondary,
} from '../lib/ui'
import { pullFromSyncAndRefresh, pushToSyncAndRefresh } from '../store/syncActions'
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

const previewText = `The quick brown fox jumps over the lazy dog.

Things to do:
- [X] Buy milk
- [ ] @Beppe prenotare parrucchiere

### Note call con Marco

Ha proposto di andare al cinema. Lista film:

| Titolo     | Quando            |
| ---------- | ----------------- |
| Star Wars  | 15 gennaio, 15:30 |
| The Matrix | 2 febbraio, 21:00 |

Poi ha detto che dovremmo cucinare le lasagne come le faceva sua nonna.

\`\`\`python
def make_lasagna(layers: int, sauce: int, cheese: int) -> str:
  total_ingredients = layers * 100 + sauce + cheese
  return f"Lasagna prepared."
\`\`\`

0123456789 ~ !  @  #  $  %  ^  &  *  (  )  _  +  - =
12*34=56 $\{var\} (a && b) == True
`

type HighlightCore = typeof import('highlight.js/lib/core')['default']

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const applyInlineHighlight = (value: string) =>
  value
    .replace(/\*\*([^*]+)\*\*/g, '<span class="hljs-strong">$1</span>')
    .replace(/\*([^*]+)\*/g, '<span class="hljs-emphasis">$1</span>')
    .replace(/`([^`]+)`/g, '<span class="hljs-attr">$1</span>')
    .replace(/(^|[^A-Za-z0-9_])(#[-A-Za-z0-9_/-]+)/g, '$1<span class="hljs-hashtag">$2</span>')
    .replace(/(^|[^A-Za-z0-9_])(@[-A-Za-z0-9_/-]+)/g, '$1<span class="hljs-mention">$2</span>')

const buildPreviewHtml = (text: string, hljs: HighlightCore) => {
  const lines = text.split('\n')
  const htmlLines: string[] = []
  let inFence = false
  let fenceLang = ''
  let fenceLines: string[] = []

  const flushFence = () => {
    const code = fenceLines.join('\n')
    if (!code) return
    try {
      htmlLines.push(hljs.highlight(code, { language: fenceLang || 'python', ignoreIllegals: true }).value)
    } catch (error) {
      htmlLines.push(escapeHtml(code))
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      if (inFence) {
        flushFence()
        htmlLines.push('<span class="hljs-meta">```</span>')
        inFence = false
        fenceLang = ''
        fenceLines = []
      } else {
        inFence = true
        fenceLang = trimmed.slice(3).trim()
        htmlLines.push('<span class="hljs-meta">```' + escapeHtml(fenceLang) + '</span>')
      }
      continue
    }

    if (inFence) {
      fenceLines.push(line)
      continue
    }

    const headingMatch = line.match(/^(\s*)(#{1,3})\s+(.*)$/)
    if (headingMatch) {
      const [, indent, hashes, content] = headingMatch
      const highlighted = applyInlineHighlight(escapeHtml(`${hashes} ${content}`))
      htmlLines.push(`${escapeHtml(indent)}<span class="hljs-section">${highlighted}</span>`)
      continue
    }

    const bulletMatch = line.match(/^(\s*)-\s+(.*)$/)
    if (bulletMatch) {
      const [, indent, content] = bulletMatch
      const todoMatch = content.match(/^\[([ xX])\]\s+(.*)$/)
      if (todoMatch) {
        const marker = todoMatch[1]
        const highlighted = applyInlineHighlight(escapeHtml(todoMatch[2]))
        htmlLines.push(
          `${escapeHtml(indent)}<span class="hljs-todo-marker">- [${escapeHtml(marker)}]</span> ${highlighted}`,
        )
      } else {
        const highlighted = applyInlineHighlight(escapeHtml(content))
        htmlLines.push(`${escapeHtml(indent)}<span class="hljs-bullet">-</span> ${highlighted}`)
      }
      continue
    }

    htmlLines.push(applyInlineHighlight(escapeHtml(line)))
  }

  if (inFence) {
    flushFence()
  }

  return htmlLines.join('\n')
}

export default function Settings() {
  const navigate = useNavigate()
  const { loadTimeline } = useDaysStore()
  const {
    loadSettings,
    saveGeminiKey,
    updateGeminiModel,
    updateAllowThinking,
    updateAllowWebSearch,
    updateAiLanguage,
    updateWallpaper,
    updateHighlightInputMode,
    updateFontPreference,
    updateBodyFont,
    updateMonospaceFont,
    updateTitleFont,
    geminiApiKey,
    geminiModel,
    allowThinking,
    allowWebSearch,
    aiLanguage,
    wallpaper,
    highlightInputMode,
    fontPreference,
    bodyFont,
    monospaceFont,
    titleFont,
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
  const [showFontPreview, setShowFontPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  const savedDropboxPath = filePath || DEFAULT_DROPBOX_PATH
  const isDropboxPathDirty = dropboxPath.trim() !== savedDropboxPath

  const handleMonospaceFont = (font: MonospaceFont) => {
    void updateMonospaceFont(font)
    void updateFontPreference('monospace')
  }

  const handleBodyFont = (font: BodyFont) => {
    void updateBodyFont(font)
    void updateFontPreference('proportional')
  }

  const handleTitleFont = (font: TitleFont) => {
    void updateTitleFont(font)
  }

  const handleFontPreviewToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    setShowFontPreview(event.currentTarget.open)
  }

  useEffect(() => {
    let active = true

    if (!showFontPreview) {
      setPreviewHtml(null)
      return () => {
        active = false
      }
    }

    const loadHighlighting = async () => {
      try {
        const [{ default: hljs }, { default: markdown }, { default: python }] = await Promise.all([
          import('highlight.js/lib/core'),
          import('highlight.js/lib/languages/markdown'),
          import('highlight.js/lib/languages/python'),
        ])

        if (!hljs.getLanguage('markdown')) {
          hljs.registerLanguage('markdown', markdown)
        }
        if (!hljs.getLanguage('python')) {
          hljs.registerLanguage('python', python)
        }

        if (!active) return
        setPreviewHtml(buildPreviewHtml(previewText, hljs))
      } catch (error) {
        if (active) {
          setPreviewHtml(null)
        }
      }
    }

    void loadHighlighting()

    return () => {
      active = false
    }
  }, [showFontPreview])

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
  const bodyPreviewFontFamily =
    fontPreference === 'monospace'
      ? getMonospaceFontFamily(monospaceFont)
      : getBodyFontFamily(bodyFont)
  const bodyPreviewFontSize =
    fontPreference === 'monospace'
      ? getMonospaceFontSize(monospaceFont)
      : '1rem'
  const titlePreviewFontFamily = getTitleFontFamily(titleFont)
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
      const result = await pullFromSyncAndRefresh()
      await loadDropboxState()
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
      const result = await pushToSyncAndRefresh(force)
      await loadDropboxState()
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
              autoComplete="off"
              type="Text"
              inputMode="text"
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
            autoComplete="off"
            type="Text"
            inputMode="text"
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
              autoComplete="off"
              type="Text"
              inputMode="text"
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

        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Allow thinking for supported models
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={allowThinking ? buttonPillActive : buttonPill}
              type="button"
              onClick={() => void updateAllowThinking(true)}
            >
              YES
            </button>
            <button
              className={!allowThinking ? buttonPillActive : buttonPill}
              type="button"
              onClick={() => void updateAllowThinking(false)}
            >
              NO
            </button>
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Allow web search for supported models
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={allowWebSearch ? buttonPillActive : buttonPill}
              type="button"
              onClick={() => void updateAllowWebSearch(true)}
            >
              YES
            </button>
            <button
              className={!allowWebSearch ? buttonPillActive : buttonPill}
              type="button"
              onClick={() => void updateAllowWebSearch(false)}
            >
              NO
            </button>
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
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Highlight Input Mode
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className={highlightInputMode ? buttonPillActive : buttonPill}
                type="button"
                onClick={() => void updateHighlightInputMode(true)}
              >
                YES
              </button>
              <button
                className={!highlightInputMode ? buttonPillActive : buttonPill}
                type="button"
                onClick={() => void updateHighlightInputMode(false)}
              >
                NO
              </button>
            </div>
          </div>

          <div className="mt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Title Font</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {titleFontOptions.map((option) => (
                <button
                  key={option.id}
                  className={titleFont === option.id ? buttonPillActive : buttonPill}
                  type="button"
                  onClick={() => handleTitleFont(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Body Font</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {bodyFontOptions.map((option) => (
                <button
                  key={option.id}
                  className={
                    fontPreference === 'proportional' && bodyFont === option.id
                      ? buttonPillActive
                      : buttonPill
                  }
                  type="button"
                  onClick={() => handleBodyFont(option.id)}
                >
                  {option.label}
                </button>
              ))}
              {monospaceFontOptions.map((option) => (
                <button
                  key={option.id}
                  className={
                    fontPreference === 'monospace' && monospaceFont === option.id
                      ? buttonPillActive
                      : buttonPill
                  }
                  type="button"
                  onClick={() => handleMonospaceFont(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <details
              className="mt-4 rounded-xl border border-slate-200 bg-[#F8FAFC] px-4 py-3"
              onToggle={handleFontPreviewToggle}
            >
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
                Font Preview
              </summary>
              {showFontPreview && (
                <div className="mt-3 space-y-3 rounded-[4px] border border-slate-200/60 bg-white p-4 shadow-[0_6px_6px_-4px_rgba(0,0,0,0.10),0_2px_12px_rgba(0,0,0,0.06)]">
                  <div
                    className="flex flex-wrap items-baseline gap-2 text-xl text-slate-900"
                    style={{ fontFamily: titlePreviewFontFamily }}
                  >
                    <span className="font-bold">Today</span>
                    <span className="font-semibold">24, Saturday</span>
                  </div>
                  <pre
                    className="overflow-x-auto whitespace-pre-wrap bg-transparent text-sm font-normal text-slate-900"
                    style={{ fontFamily: bodyPreviewFontFamily, fontSize: bodyPreviewFontSize }}
                  >
                    <code
                      className="hljs language-markdown"
                      style={{ fontFamily: bodyPreviewFontFamily, fontSize: bodyPreviewFontSize }}
                      dangerouslySetInnerHTML={{ __html: previewHtml ?? escapeHtml(previewText) }}
                    />
                  </pre>
                </div>
              )}
            </details>
          </div>

      </section>


      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-600">Dropbox Sync</h2>
          <span
            className={`rounded-full px-2 py-1 text-xs font-semibold ${
              dropboxSummary.connected
                ? 'bg-emerald-200 text-emerald-800'
                : 'bg-slate-100 text-slate-500'
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
              autoComplete="off"
              type="Text"
              inputMode="text"
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
