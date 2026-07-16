import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import SegmentedControl from '../components/SegmentedControl'
import AppearanceSection from '../components/settings/AppearanceSection'
import DataSection, { type CloudVersionHistory } from '../components/settings/DataSection'
import LlmSection from '../components/settings/LlmSection'
import SetupNoticeBanner from '../components/settings/SetupNoticeBanner'
import SyncSection from '../components/settings/SyncSection'
import { exportMarkdownFromDb, importMarkdownToDb } from '../lib/importExport'
import { getBodyFontChoice, getFontPreset } from '../lib/fonts'
import { shareOrDownload } from '../lib/share'
import { DEFAULT_DROPBOX_PATH } from '../lib/dropbox'
import { prepareGoogleDriveAuth } from '../lib/googleDriveAuth'
import { isProviderReady } from '../lib/llm/readiness'
import { getSetupNotices } from '../lib/setupAttention'
import { DEFAULT_GOOGLE_DRIVE_FILE_NAME, getGoogleDrivePath } from '../lib/googleDriveState'
import { claimPrimaryTabForSync } from '../lib/tabSyncCoordinator'
import type { SyncProviderId } from '../lib/sync'
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
  const updateFontPreset = useSettingsStore((state) => state.updateFontPreset)
  const updateTitleFont = useSettingsStore((state) => state.updateTitleFont)
  const updateBodyFontChoice = useSettingsStore((state) => state.updateBodyFontChoice)
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
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  const selectedSyncProvider = syncProviderDraft ?? activeProvider ?? 'dropbox'
  const settingsView = useSettingsStore((state) => state.settingsView)
  const updateSettingsView = useSettingsStore((state) => state.updateSettingsView)
  const showAdvanced = settingsView === 'advanced'
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

  const fontPreset = getFontPreset(fontPreference, bodyFont, monospaceFont, titleFont)
  const bodyFontChoice = getBodyFontChoice(fontPreference, monospaceFont)
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
    const blockedReason = claimPrimaryTabForSync()
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
    const blockedReason = claimPrimaryTabForSync()
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

  const { handleConnect, handleDisconnect, handleActivate, handlePull, handleForcePull, handlePush } =
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
    if (sectionId !== 'settings-ai' && sectionId !== 'settings-sync' && sectionId !== 'settings-data') return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [initialLoadDone, location.hash])

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between px-3 pt-1">
        <h1 className="text-2xl font-bold tracking-normal text-slate-700">Settings</h1>
        <SegmentedControl
          options={[
            { value: 'basic', label: 'Basic' },
            { value: 'advanced', label: 'Advanced' },
          ]}
          value={settingsView}
          onChange={(next) => {
            void updateSettingsView(next)
          }}
        />
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

      <div id="settings-ai" className="mx-3 scroll-mt-2 sm:mx-0 sm:scroll-mt-20">
        <LlmSection
          provider={provider}
          providerSettings={providerSettings}
          llmSecrets={llmSecrets}
          aiLanguage={aiLanguage}
          allowWebSearch={allowWebSearch}
          settingsError={settingsError}
          advanced={showAdvanced}
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

      <div id="settings-sync" className="mx-3 scroll-mt-2 sm:mx-0 sm:scroll-mt-20">
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
          advanced={showAdvanced}
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
          onForcePull={handleForcePull}
          onPush={handlePush}
        />
      </div>

      <div className="mx-3 sm:mx-0">
        <AppearanceSection
          advanced={showAdvanced}
          themePreference={themePreference}
          wallpaper={wallpaper}
          highlightInputMode={highlightInputMode}
          autocorrection={autocorrection}
          fontPreset={fontPreset}
          titleFont={titleFont}
          bodyFontChoice={bodyFontChoice}
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
          onFontPresetChange={(value) => {
            void updateFontPreset(value)
          }}
          onTitleFontChange={(value) => {
            void updateTitleFont(value)
          }}
          onBodyFontChoiceChange={(value) => {
            void updateBodyFontChoice(value)
          }}
        />
      </div>

      <div id="settings-data" className="mx-3 scroll-mt-2 sm:mx-0 sm:scroll-mt-20">
        <DataSection
          exportFileName={
            (activeSyncStatus.targetName || savedDropboxPath).split('/').pop() || 'inbox.md'
          }
          importStatus={importStatus}
          onImport={handleImport}
          onExport={handleExport}
          cloudHistory={cloudHistory}
          onRestored={async () => {
            await loadTimeline()
            await loadProviderStates()
            await loadSyncState()
          }}
        />
      </div>

      <p className="text-center text-xs text-slate-400">
        Rivolo v{__APP_VERSION__} •{' '}
        <Link to="/privacy" className="underline hover:text-slate-600">
          Privacy Policy
        </Link>{' '}
        •{' '}
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
