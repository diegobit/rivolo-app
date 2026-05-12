import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppearanceSection from '../components/settings/AppearanceSection'
import DropboxSyncSection from '../components/settings/DropboxSyncSection'
import ImportExportSection from '../components/settings/ImportExportSection'
import LlmSection from '../components/settings/LlmSection'
import { isIOS } from '../lib/device'
import { exportMarkdownFromDb, importMarkdownToDb } from '../lib/importExport'
import {
  getMonospaceFontFamily,
  getMonospaceFontSize,
  getBodyFontFamily,
  getTitleFontFamily,
  type BodyFont,
  type MonospaceFont,
  type TitleFont,
} from '../lib/fonts'
import { shareOrDownload } from '../lib/share'
import { DEFAULT_DROPBOX_PATH } from '../lib/dropbox'
import { buttonSecondaryFlat } from '../lib/ui'
import { useDropboxSyncActions } from './settings/useDropboxSyncActions'
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
12*34=56 \${var} (a && b) == True
`

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
    updateAutocorrection,
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
    autocorrection,
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
  const { activeProvider, loadState: loadSyncState, syncing } = useSyncStore()

  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)

  const [dropboxStatus, setDropboxStatus] = useState<string | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [dropboxPathDraft, setDropboxPathDraft] = useState<string | null>(null)
  const [showFontPreview, setShowFontPreview] = useState(false)

  const savedDropboxPath = filePath || DEFAULT_DROPBOX_PATH
  const dropboxPath = dropboxPathDraft ?? savedDropboxPath
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
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    void loadSettings()
    void loadDropboxState()
    void loadSyncState()
  }, [loadDropboxState, loadSettings, loadSyncState])

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
  const isIosDevice = isIOS()
  const bodyPreviewFontSize =
    fontPreference === 'monospace'
      ? isIosDevice && monospaceFont === 'iawriter'
        ? '1rem'
        : getMonospaceFontSize(monospaceFont)
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

  const handleSaveDropboxPath = async () => {
    await updateFilePath(dropboxPath.trim() || DEFAULT_DROPBOX_PATH)
    setDropboxPathDraft(null)
    await loadDropboxState()
    await loadSyncState()
  }

  const { handleConnectDropbox, handleDisconnectDropbox, handlePull, handlePush } =
    useDropboxSyncActions({
      online,
      dropboxConnected,
      localDirty,
      setDropboxStatus,
      loadDropboxState,
      loadSyncState,
    })

  return (
    <div className="space-y-4">
      <LlmSection
        geminiApiKey={geminiApiKey}
        geminiModel={geminiModel}
        aiLanguage={aiLanguage}
        allowThinking={allowThinking}
        allowWebSearch={allowWebSearch}
        apiKey={apiKey}
        status={status}
        onSaveKey={handleSaveKey}
        onApiKeyChange={setApiKey}
        onGeminiModelChange={(value) => {
          void updateGeminiModel(value)
        }}
        onFollowLanguage={() => {
          void updateAiLanguage('follow')
        }}
        onAiLanguageChange={(value) => {
          const nextValue = value.trim()
          void updateAiLanguage(nextValue || 'follow')
        }}
        onAllowThinkingChange={(enabled) => {
          void updateAllowThinking(enabled)
        }}
        onAllowWebSearchChange={(enabled) => {
          void updateAllowWebSearch(enabled)
        }}
      />

      <AppearanceSection
        wallpaper={wallpaper}
        highlightInputMode={highlightInputMode}
        autocorrection={autocorrection}
        fontPreference={fontPreference}
        bodyFont={bodyFont}
        monospaceFont={monospaceFont}
        titleFont={titleFont}
        showFontPreview={showFontPreview}
        previewText={previewText}
        titlePreviewFontFamily={titlePreviewFontFamily}
        bodyPreviewFontFamily={bodyPreviewFontFamily}
        bodyPreviewFontSize={bodyPreviewFontSize}
        onWallpaperChange={(value) => {
          void updateWallpaper(value)
        }}
        onHighlightInputModeChange={(enabled) => {
          void updateHighlightInputMode(enabled)
        }}
        onAutocorrectionChange={(enabled) => {
          void updateAutocorrection(enabled)
        }}
        onTitleFontChange={handleTitleFont}
        onBodyFontChange={handleBodyFont}
        onMonospaceFontChange={handleMonospaceFont}
        onFontPreviewToggle={handleFontPreviewToggle}
      />


      <DropboxSyncSection
        dropboxSummary={dropboxSummary}
        filePath={filePath}
        online={online}
        dropboxPath={dropboxPath}
        isDropboxPathDirty={isDropboxPathDirty}
        syncBusy={syncing}
        dropboxStatus={dropboxStatus}
        placeholderPath={DEFAULT_DROPBOX_PATH}
        onConnectDropbox={handleConnectDropbox}
        onDisconnectDropbox={handleDisconnectDropbox}
        onDropboxPathChange={(value) => setDropboxPathDraft(value)}
        onSavePath={handleSaveDropboxPath}
        onPull={handlePull}
        onPush={handlePush}
      />

      <ImportExportSection
        savedDropboxPath={savedDropboxPath}
        importStatus={importStatus}
        onImport={handleImport}
        onExport={handleExport}
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-600">Legal</h2>
        <p className="mt-1 text-xs text-slate-500">Review the GDPR privacy notice for Rivolo and connected services.</p>
        <div className="mt-3">
          <Link to="/privacy" className={buttonSecondaryFlat}>
            Privacy Policy
          </Link>
        </div>
      </section>
    </div>
  )
}
