import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import AppearanceSection from '../components/settings/AppearanceSection'
import BackupsSection, { type CloudVersionHistory } from '../components/settings/BackupsSection'
import ImportExportSection from '../components/settings/ImportExportSection'
import LlmSection from '../components/settings/LlmSection'
import SetupNoticeBanner from '../components/settings/SetupNoticeBanner'
import SyncSection from '../components/settings/SyncSection'
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
import { prepareGoogleDriveAuth } from '../lib/googleDriveAuth'
import { isProviderReady } from '../lib/llm/readiness'
import { getSetupNotices } from '../lib/setupAttention'
import { DEFAULT_GOOGLE_DRIVE_FILE_NAME, getGoogleDrivePath } from '../lib/googleDriveState'
import { getTabSyncBlockReason } from '../lib/tabSyncCoordinator'
import type { SyncProviderId } from '../lib/sync'
import { buttonSecondary } from '../lib/ui'
import { useTabSyncState } from '../hooks/useTabSyncState'
import { useSyncProviderActions } from './settings/useSyncProviderActions'
import { useDaysStore } from '../store/useDaysStore'
import { useDropboxStore } from '../store/useDropboxStore'
import { useGoogleDriveStore } from '../store/useGoogleDriveStore'
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
  const location = useLocation()
  const loadTimeline = useDaysStore((state) => state.loadTimeline)
  const loadSettings = useSettingsStore((state) => state.loadSettings)
  const selectProvider = useSettingsStore((state) => state.selectProvider)
  const saveProviderSettings = useSettingsStore((state) => state.saveProviderSettings)
  const saveProviderKey = useSettingsStore((state) => state.saveProviderKey)
  const clearProviderKey = useSettingsStore((state) => state.clearProviderKey)
  const updateAllowWebSearch = useSettingsStore((state) => state.updateAllowWebSearch)
  const updateAiLanguage = useSettingsStore((state) => state.updateAiLanguage)
  const updateThemePreference = useSettingsStore((state) => state.updateThemePreference)
  const updateWallpaper = useSettingsStore((state) => state.updateWallpaper)
  const updateHighlightInputMode = useSettingsStore((state) => state.updateHighlightInputMode)
  const updateAutocorrection = useSettingsStore((state) => state.updateAutocorrection)
  const updateFontPreference = useSettingsStore((state) => state.updateFontPreference)
  const updateBodyFont = useSettingsStore((state) => state.updateBodyFont)
  const updateMonospaceFont = useSettingsStore((state) => state.updateMonospaceFont)
  const updateTitleFont = useSettingsStore((state) => state.updateTitleFont)
  const dismissSetupNotice = useSettingsStore((state) => state.dismissSetupNotice)
  const provider = useSettingsStore((state) => state.provider)
  const providerSettings = useSettingsStore((state) => state.providerSettings)
  const llmSecrets = useSettingsStore((state) => state.llmSecrets)
  const settingsError = useSettingsStore((state) => state.settingsError)
  const allowWebSearch = useSettingsStore((state) => state.allowWebSearch)
  const aiLanguage = useSettingsStore((state) => state.aiLanguage)
  const themePreference = useSettingsStore((state) => state.themePreference)
  const wallpaper = useSettingsStore((state) => state.wallpaper)
  const highlightInputMode = useSettingsStore((state) => state.highlightInputMode)
  const autocorrection = useSettingsStore((state) => state.autocorrection)
  const fontPreference = useSettingsStore((state) => state.fontPreference)
  const bodyFont = useSettingsStore((state) => state.bodyFont)
  const monospaceFont = useSettingsStore((state) => state.monospaceFont)
  const titleFont = useSettingsStore((state) => state.titleFont)
  const dismissedSetupNotices = useSettingsStore((state) => state.dismissedSetupNotices)
  const dropboxFilePath = useDropboxStore((state) => state.filePath)
  const dropboxRemoteRev = useDropboxStore((state) => state.lastRemoteRev)
  const dropboxLastSyncAt = useDropboxStore((state) => state.lastSyncAt)
  const dropboxLocalDirty = useDropboxStore((state) => state.localDirty)
  const dropboxHasAuth = useDropboxStore((state) => state.hasAuth)
  const dropboxAccountEmail = useDropboxStore((state) => state.accountEmail)
  const dropboxAccountName = useDropboxStore((state) => state.accountName)
  const loadDropboxState = useDropboxStore((state) => state.loadState)
  const updateFilePath = useDropboxStore((state) => state.updateFilePath)
  const googleDriveConnected = useGoogleDriveStore((state) => state.connected)
  const googleDriveFolderId = useGoogleDriveStore((state) => state.folderId)
  const googleDriveFileName = useGoogleDriveStore((state) => state.fileName)
  const googleDriveRemoteVersion = useGoogleDriveStore((state) => state.lastRemoteVersion)
  const googleDriveLastSyncAt = useGoogleDriveStore((state) => state.lastSyncAt)
  const googleDriveLocalDirty = useGoogleDriveStore((state) => state.localDirty)
  const googleDriveAccountEmail = useGoogleDriveStore((state) => state.accountEmail)
  const googleDriveAccountName = useGoogleDriveStore((state) => state.accountName)
  const loadGoogleDriveState = useGoogleDriveStore((state) => state.loadState)
  const updateGoogleDriveFileName = useGoogleDriveStore((state) => state.updateFileName)
  const activeProvider = useSyncStore((state) => state.activeProvider)
  const activeSyncStatus = useSyncStore((state) => state.status)
  const loadSyncState = useSyncStore((state) => state.loadState)
  const setActiveSyncProvider = useSyncStore((state) => state.setActiveProvider)
  const syncing = useSyncStore((state) => state.syncing)
  const syncAttention = useSyncStore((state) => state.syncAttention)
  const tabSync = useTabSyncState()

  const [importStatus, setImportStatus] = useState<string | null>(null)

  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [syncProviderDraft, setSyncProviderDraft] = useState<SyncProviderId | null>(null)
  const [dropboxPathDraft, setDropboxPathDraft] = useState<string | null>(null)
  const [googleDriveFileNameDraft, setGoogleDriveFileNameDraft] = useState<string | null>(null)
  const [showFontPreview, setShowFontPreview] = useState(false)
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  const selectedSyncProvider = syncProviderDraft ?? activeProvider ?? 'dropbox'
  const savedDropboxPath = dropboxFilePath || DEFAULT_DROPBOX_PATH
  const dropboxPath = dropboxPathDraft ?? savedDropboxPath
  const isDropboxPathDirty = dropboxPath.trim() !== savedDropboxPath
  const savedGoogleDriveFileName = googleDriveFileName || DEFAULT_GOOGLE_DRIVE_FILE_NAME
  const googleFileName = googleDriveFileNameDraft ?? savedGoogleDriveFileName
  const isGoogleFileNameDirty = googleFileName.trim() !== savedGoogleDriveFileName

  const cloudHistory: CloudVersionHistory | null =
    activeProvider === 'dropbox' && dropboxHasAuth
      ? {
          provider: 'dropbox',
          fileName: savedDropboxPath.split('/').pop() || DEFAULT_DROPBOX_PATH.slice(1),
          url: 'https://www.dropbox.com/home',
        }
      : activeProvider === 'google-drive' && googleDriveConnected
        ? {
            provider: 'google-drive',
            fileName: savedGoogleDriveFileName,
            url: googleDriveFolderId
              ? `https://drive.google.com/drive/folders/${googleDriveFolderId}`
              : 'https://drive.google.com/drive/my-drive',
          }
        : null

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

  const handleFontPreviewToggle = () => setShowFontPreview((current) => !current)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    void Promise.all([
      loadSettings(),
      loadDropboxState(),
      loadGoogleDriveState(),
      loadSyncState(),
    ]).finally(() => setInitialLoadDone(true))
  }, [loadDropboxState, loadGoogleDriveState, loadSettings, loadSyncState])

  useEffect(() => {
    if (selectedSyncProvider !== 'google-drive') return
    void prepareGoogleDriveAuth().catch(() => undefined)
  }, [selectedSyncProvider])

  useEffect(() => {
    const handleStatus = () => setOnline(navigator.onLine)
    window.addEventListener('online', handleStatus)
    window.addEventListener('offline', handleStatus)
    return () => {
      window.removeEventListener('online', handleStatus)
      window.removeEventListener('offline', handleStatus)
    }
  }, [])

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
    if (dropboxAccountName && dropboxAccountEmail) {
      return `${dropboxAccountName} (${dropboxAccountEmail})`
    }
    return dropboxAccountEmail ?? dropboxAccountName ?? '—'
  }, [dropboxAccountEmail, dropboxAccountName])

  const dropboxSummary = useMemo(
    () => ({
      connected: dropboxHasAuth,
      lastSync: formatSyncTime(dropboxLastSyncAt),
      remoteVersion: dropboxRemoteRev ?? '—',
      dirty: dropboxLocalDirty,
      account: dropboxAccount,
      target: savedDropboxPath,
    }),
    [
      dropboxAccount,
      dropboxHasAuth,
      dropboxLastSyncAt,
      dropboxLocalDirty,
      dropboxRemoteRev,
      savedDropboxPath,
    ],
  )

  const googleDriveAccount = useMemo(() => {
    if (googleDriveAccountName && googleDriveAccountEmail) {
      return `${googleDriveAccountName} (${googleDriveAccountEmail})`
    }
    return googleDriveAccountEmail ?? googleDriveAccountName ?? '—'
  }, [googleDriveAccountEmail, googleDriveAccountName])

  const googleDriveSummary = useMemo(
    () => ({
      connected: googleDriveConnected,
      lastSync: formatSyncTime(googleDriveLastSyncAt),
      remoteVersion: googleDriveRemoteVersion ?? '—',
      dirty: googleDriveLocalDirty,
      account: googleDriveAccount,
      target: getGoogleDrivePath(savedGoogleDriveFileName),
    }),
    [
      googleDriveAccount,
      googleDriveConnected,
      googleDriveLastSyncAt,
      googleDriveLocalDirty,
      googleDriveRemoteVersion,
      savedGoogleDriveFileName,
    ],
  )

  const selectedSummary = selectedSyncProvider === 'dropbox' ? dropboxSummary : googleDriveSummary
  const selectedTarget = selectedSyncProvider === 'dropbox' ? dropboxPath : googleFileName
  const selectedTargetDirty =
    selectedSyncProvider === 'dropbox' ? isDropboxPathDirty : isGoogleFileNameDirty

  const loadProviderStates = async () => {
    await Promise.all([loadDropboxState(), loadGoogleDriveState()])
  }

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const blockedReason = getTabSyncBlockReason()
    if (blockedReason) {
      setImportStatus(blockedReason)
      event.target.value = ''
      return
    }

    const content = await file.text()
    try {
      const result = await importMarkdownToDb(content)
      await loadTimeline()
      const warningText = result.warnings.length ? ` Warnings: ${result.warnings.join(' ')}` : ''
      setImportStatus(`Imported ${result.imported} day(s).${warningText}`)
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Import failed.')
    }
    event.target.value = ''
  }

  const handleExport = async () => {
    const content = await exportMarkdownFromDb()
    const filename =
      (activeSyncStatus.targetName || savedDropboxPath).split('/').pop() || 'inbox.md'
    await shareOrDownload(filename, content)
  }

  const handleSaveSyncTarget = async () => {
    setSyncStatus(null)
    const blockedReason = getTabSyncBlockReason()
    if (blockedReason) {
      setSyncStatus(blockedReason)
      return
    }

    if (selectedSyncProvider === 'dropbox') {
      await updateFilePath(dropboxPath.trim() || DEFAULT_DROPBOX_PATH)
      setDropboxPathDraft(null)
    } else {
      const nextFileName = googleFileName.trim() || DEFAULT_GOOGLE_DRIVE_FILE_NAME
      if (nextFileName.includes('/') || !nextFileName.toLowerCase().endsWith('.md')) {
        setSyncStatus('Google Drive file name must be a Markdown file name without folders.')
        return
      }
      await updateGoogleDriveFileName(nextFileName)
      setGoogleDriveFileNameDraft(null)
    }
    await loadProviderStates()
    await loadSyncState()
  }

  const { handleConnect, handleDisconnect, handleActivate, handlePull, handlePush } =
    useSyncProviderActions({
      provider: selectedSyncProvider,
      activeProvider,
      connected: selectedSummary.connected,
      localDirty: selectedSummary.dirty,
      online,
      setStatus: setSyncStatus,
      loadProviderStates,
      loadSyncState,
      setActiveProvider: setActiveSyncProvider,
    })

  const setupNotices = getSetupNotices({
    aiNeedsSetup: !isProviderReady(provider, providerSettings, llmSecrets),
    syncNeedsSetup: activeProvider === null,
    dismissed: dismissedSetupNotices,
  })

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    if (!initialLoadDone) return
    const sectionId = location.hash.slice(1)
    if (sectionId !== 'settings-ai' && sectionId !== 'settings-sync') return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [initialLoadDone, location.hash])

  return (
    <div className="space-y-4">
      <header className="px-1 pt-1">
        <h1 className="text-2xl font-bold tracking-normal text-slate-700">Settings</h1>
      </header>

      {initialLoadDone &&
        setupNotices.map((notice) => (
          <SetupNoticeBanner
            key={notice.id}
            notice={notice}
            onOpen={() => scrollToSection(notice.settingsSectionId)}
            onDismiss={() => {
              void dismissSetupNotice(notice.id).catch((error) => {
                console.error('[Setup reminder dismissal failed]', error)
              })
            }}
          />
        ))}

      <div id="settings-ai" className="scroll-mt-2 sm:scroll-mt-20">
        <LlmSection
          provider={provider}
          providerSettings={providerSettings}
          llmSecrets={llmSecrets}
          aiLanguage={aiLanguage}
          allowWebSearch={allowWebSearch}
          settingsError={settingsError}
          onSelectProvider={selectProvider}
          onSaveProviderSettings={saveProviderSettings}
          onSaveProviderKey={saveProviderKey}
          onClearProviderKey={clearProviderKey}
          onFollowLanguage={() => {
            void updateAiLanguage('follow')
          }}
          onAiLanguageChange={(value) => {
            const nextValue = value.trim()
            void updateAiLanguage(nextValue || 'follow')
          }}
          onAllowWebSearchChange={updateAllowWebSearch}
        />
      </div>

      <div>
        <AppearanceSection
          themePreference={themePreference}
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
          onThemePreferenceChange={(value) => {
            void updateThemePreference(value)
          }}
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
      </div>

      <div id="settings-sync" className="scroll-mt-2 sm:scroll-mt-20">
        <SyncSection
          activeProvider={activeProvider}
          provider={selectedSyncProvider}
          summaries={{
            dropbox: dropboxSummary,
            'google-drive': googleDriveSummary,
          }}
          online={online}
          syncPaused={!tabSync.isPrimary}
          attention={
            activeProvider === selectedSyncProvider ? (syncAttention?.message ?? null) : null
          }
          targetDraft={selectedTarget}
          targetDirty={selectedTargetDirty}
          syncBusy={syncing}
          status={syncStatus}
          onProviderChange={(nextProvider) => {
            setSyncProviderDraft(nextProvider)
            setSyncStatus(null)
          }}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onActivate={handleActivate}
          onTargetChange={(value) => {
            if (selectedSyncProvider === 'dropbox') setDropboxPathDraft(value)
            else setGoogleDriveFileNameDraft(value)
          }}
          onSaveTarget={handleSaveSyncTarget}
          onPull={handlePull}
          onPush={handlePush}
        />
      </div>

      <div className="space-y-4">
        <ImportExportSection
          exportFileName={
            (activeSyncStatus.targetName || savedDropboxPath).split('/').pop() || 'inbox.md'
          }
          importStatus={importStatus}
          onImport={handleImport}
          onExport={handleExport}
        />

        <BackupsSection
          cloudHistory={cloudHistory}
          onRestored={async () => {
            await loadTimeline()
            await loadProviderStates()
            await loadSyncState()
          }}
        />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-slate-700">Legal</h2>
        <p className="mt-1 text-xs text-slate-500">
          Review the GDPR privacy notice for Rivolo and connected services.
        </p>
        <div className="mt-3">
          <Link to="/privacy" className={buttonSecondary}>
            Privacy Policy
          </Link>
        </div>
      </section>

      <p className="text-center text-xs text-slate-400">
        Rivolo v{__APP_VERSION__} •{' '}
        <a
          href="https://github.com/diegobit/rivolo-app"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-slate-600"
        >
          Open source
        </a>{' '}
        • Made by{' '}
        <a
          href="https://diegobit.com"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-slate-600"
        >
          diegobit
        </a>
      </p>
    </div>
  )
}
