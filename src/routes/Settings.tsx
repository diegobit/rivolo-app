import { moveAgentAccessToDailyNotebook } from '../lib/agentAccess'
import { migrateActiveNotebookAndRefresh } from '../store/syncActions'
import { useSyncPanelNavigation } from './settings/useSyncPanelNavigation'
import { useOneDriveStore } from '../store/useOneDriveStore'
import { validateOneDriveTarget } from '../lib/oneDrive'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import SegmentedControl from '../components/SegmentedControl'
import AppearanceSection from '../components/settings/AppearanceSection'
import { appIdentities } from '../lib/appIdentity'
import DataSection, { type CloudVersionHistory } from '../components/settings/DataSection'
import LlmSection from '../components/settings/LlmSection'
import AttentionBanner from '../components/settings/AttentionBanner'
import McpOAuthPendingBanner from '../components/settings/McpOAuthPendingBanner'
import SyncSection from '../components/settings/SyncSection'
import { exportMarkdownFromDb, importMarkdownToDb } from '../lib/importExport'
import { getBodyFontChoice, getFontPreset } from '../lib/fonts'
import { shareOrDownload } from '../lib/share'
import { DEFAULT_DROPBOX_PATH } from '../lib/dropbox'
import { prepareGoogleDriveAuth } from '../lib/googleDriveAuth'
import { isProviderReady } from '../lib/llm/readiness'
import { getSetupNotices } from '../lib/setupAttention'
import { buildAttentionItems } from '../lib/attention'
import { DEFAULT_GOOGLE_DRIVE_FILE_NAME, getGoogleDrivePath } from '../lib/googleDriveState'
import { claimPrimaryTabForSync } from '../lib/tabSyncCoordinator'
import { useTabSyncState } from '../hooks/useTabSyncState'
import {
  agentAccessDisableWarning,
  runConfirmedAgentAccessDisable,
  runWithAgentAccessSafety,
  useAgentAccess,
} from './settings/useAgentAccess'
import { useDatabasePersistFailure } from '../hooks/useDatabasePersistFailure'
import { useMcpOAuthPending } from './settings/useMcpOAuthPending'
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
  const updateAnimations = useSettingsStore((state) => state.updateAnimations)
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
  const appIdentity = useSettingsStore((state) => state.appIdentity)
  const updateAppIdentity = useSettingsStore((state) => state.updateAppIdentity)
  const wallpaper = useSettingsStore((state) => state.wallpaper)
  const highlightInputMode = useSettingsStore((state) => state.highlightInputMode)
  const autocorrection = useSettingsStore((state) => state.autocorrection)
  const animations = useSettingsStore((state) => state.animations)
  const fontPreference = useSettingsStore((state) => state.fontPreference)
  const bodyFont = useSettingsStore((state) => state.bodyFont)
  const monospaceFont = useSettingsStore((state) => state.monospaceFont)
  const titleFont = useSettingsStore((state) => state.titleFont)
  const dismissedSetupNotices = useSettingsStore((state) => state.dismissedSetupNotices)
  const oneDrive = useOneDriveStore()
  const loadOneDriveState = oneDrive.loadState
  useEffect(() => {
    const refresh = () => { void loadOneDriveState().catch(() => undefined) }
    window.addEventListener('rivolo:onedrive-progress', refresh)
    return () => window.removeEventListener('rivolo:onedrive-progress', refresh)
  }, [loadOneDriveState])
  const [oneDriveTargetDraft, setOneDriveTargetDraft] = useState<string | null>(null)
  const oneDriveTarget = oneDriveTargetDraft ?? oneDrive.filePath
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
  const googleDriveFileId = useGoogleDriveStore((state) => state.fileId)
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
  const persistFailureMessage = useDatabasePersistFailure()
  const tabSync = useTabSyncState()

  const [importStatus, setImportStatus] = useState<string | null>(null)

  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [dropboxPathDraft, setDropboxPathDraft] = useState<string | null>(null)
  const [googleDriveFileNameDraft, setGoogleDriveFileNameDraft] = useState<string | null>(null)
  const [initialLoadDone, setInitialLoadDone] = useState(false)
  const agentAccess = useAgentAccess(online)
  const oauthPending = useMcpOAuthPending(online)

  const { provider: selectedSyncProvider, selectProvider: setSyncProviderDraft, openPanel: openSyncPanel, openRequest: syncOpenRequest } = useSyncPanelNavigation(activeProvider, initialLoadDone)
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
    activeProvider === 'onedrive' && oneDrive.hasAuth
      ? { provider: 'onedrive', fileName: 'shared notebook folder', url: 'https://onedrive.live.com/' }
      : activeProvider === 'dropbox' && dropboxHasAuth
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
      loadOneDriveState(),
      loadDropboxState(),
      loadGoogleDriveState(),
      loadSyncState(),
    ]).finally(() => setInitialLoadDone(true))
  }, [loadOneDriveState, loadDropboxState, loadGoogleDriveState, loadSettings, loadSyncState])

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
      return `${dropboxAccountName} · ${dropboxAccountEmail}`
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
      target: activeProvider === 'dropbox' && activeSyncStatus.daily ? activeSyncStatus.targetName ?? savedDropboxPath : savedDropboxPath,
    }),
    [
      activeProvider, activeSyncStatus.daily, activeSyncStatus.targetName,
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
      return `${googleDriveAccountName} · ${googleDriveAccountEmail}`
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
      target: activeProvider === 'google-drive' && activeSyncStatus.daily ? activeSyncStatus.targetName ?? getGoogleDrivePath(savedGoogleDriveFileName) : getGoogleDrivePath(savedGoogleDriveFileName),
    }),
    [
      activeProvider, activeSyncStatus.daily, activeSyncStatus.targetName,
      googleDriveAccount,
      googleDriveConnected,
      googleDriveLastSyncAt,
      googleDriveLocalDirty,
      googleDriveRemoteVersion,
      savedGoogleDriveFileName,
    ],
  )

  const oneDriveSummary = {
    connected: oneDrive.hasAuth,
    lastSync: formatSyncTime(oneDrive.lastSyncAt),
    remoteVersion: oneDrive.lastRemoteRev ?? '—',
    dirty: oneDrive.localDirty,
    account: oneDrive.accountEmail ?? oneDrive.accountName ?? '—',
    target: oneDrive.filePath,
  }
  const selectedSummary = selectedSyncProvider === 'onedrive' ? oneDriveSummary : selectedSyncProvider === 'dropbox' ? dropboxSummary : googleDriveSummary
  const selectedTarget = selectedSyncProvider === 'onedrive' ? oneDriveTarget : selectedSyncProvider === 'dropbox' ? dropboxPath : googleFileName
  const selectedTargetDirty =
    selectedSyncProvider === 'onedrive' ? oneDriveTarget.trim() !== oneDrive.filePath : selectedSyncProvider === 'dropbox' ? isDropboxPathDirty : isGoogleFileNameDirty
  const agentAccessBoundToSelectedProvider =
    agentAccess.view.state === 'enabled' &&
    agentAccess.view.profile.provider === selectedSyncProvider

  const loadProviderStates = async () => {
    await Promise.all([loadOneDriveState(), loadDropboxState(), loadGoogleDriveState()])
  }

  const runWithAgentSafety = async (
    actionLabel: string,
    action: () => Promise<void>,
    requiresDisable = agentAccess.enabled,
  ) => {
    const result = await runWithAgentAccessSafety({
      statusKnown: agentAccess.statusKnown,
      enabled: requiresDisable,
      confirmDisable: () =>
        window.confirm(
          agentAccessDisableWarning(`This will ${actionLabel} and disable Agent access`),
        ),
      disable: agentAccess.disable,
      action,
    })
    if (result === 'cancelled') {
      setSyncStatus('No changes were made.')
      return false
    }
    if (result === 'status-unknown') {
      setSyncStatus(`Check Agent access before you ${actionLabel}.`)
      return false
    }
    if (result === 'disable-failed') {
      setSyncStatus(`Agent access must be disabled before you ${actionLabel}.`)
      return false
    }
    return true
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

  const exportFileName = activeProvider === 'onedrive' || activeSyncStatus.targetName?.startsWith('https://')
    ? 'rivolo-notes.md'
    : (activeSyncStatus.targetName || savedDropboxPath).split('/').pop() || 'inbox.md'

  const handleExport = async () => {
    const content = await exportMarkdownFromDb()
    await shareOrDownload(exportFileName, content)
  }

  const handleSaveSyncTarget = async () => {
    setSyncStatus(null)
    const blockedReason = claimPrimaryTabForSync()
    if (blockedReason) {
      setSyncStatus(blockedReason)
      return
    }

    if (selectedSyncProvider === 'onedrive') {
      try {
        const nextTarget = validateOneDriveTarget(oneDriveTarget)
        if (!(await runWithAgentSafety(
          'change the sync target',
          () => oneDrive.updateFilePath(nextTarget),
          agentAccessBoundToSelectedProvider && nextTarget !== oneDrive.filePath,
        ))) return
        setOneDriveTargetDraft(null)
      } catch (error) {
        setSyncStatus(error instanceof Error ? error.message : 'Invalid OneDrive target.')
        return
      }
    } else if (selectedSyncProvider === 'dropbox') {
      const nextPath = dropboxPath.trim() || DEFAULT_DROPBOX_PATH
      if (
        !(await runWithAgentSafety(
          'change the sync target',
          async () => {
            await updateFilePath(nextPath)
          },
          agentAccessBoundToSelectedProvider && selectedTargetDirty,
        ))
      ) {
        return
      }
      setDropboxPathDraft(null)
    } else {
      const nextFileName = googleFileName.trim() || DEFAULT_GOOGLE_DRIVE_FILE_NAME
      if (nextFileName.includes('/') || !nextFileName.toLowerCase().endsWith('.md')) {
        setSyncStatus('Google Drive file name must be a Markdown file name without folders.')
        return
      }
      if (
        !(await runWithAgentSafety(
          'change the sync target',
          async () => {
            await updateGoogleDriveFileName(nextFileName)
          },
          agentAccessBoundToSelectedProvider && selectedTargetDirty,
        ))
      ) {
        return
      }
      setGoogleDriveFileNameDraft(null)
    }
    await loadProviderStates()
    await loadSyncState()
  }

  const {
    handleConnect,
    handleDisconnect,
    handleActivate,
    handlePull,
    handleForcePull,
    handlePush,
    pullRefused,
    pushBlocked,
  } = useSyncProviderActions({
      provider: selectedSyncProvider,
      activeProvider,
      connected: selectedSummary.connected,
      localDirty: selectedSummary.dirty,
      daily: activeProvider === selectedSyncProvider && activeSyncStatus.daily,
      online,
      setStatus: setSyncStatus,
      loadProviderStates,
      loadSyncState,
      setActiveProvider: setActiveSyncProvider,
      onConnected: async () => {
        await oauthPending.continueAfterEnable()
      },
    })

  const finishAgentUpgrade = async () => {
    const { activeProvider: active, status } = useSyncStore.getState()
    if (!active || active === 'onedrive' || active !== selectedSyncProvider ||
        !status.daily || !status.notebookChannel) return
    if (status.localDirty || !status.offlineReady) throw new Error('Finish syncing your days before moving Agent access.')
    await moveAgentAccessToDailyNotebook(active, status.notebookChannel)
    await agentAccess.load()
  }

  const handleDailyUpgrade = async () => {
    if (activeProvider !== selectedSyncProvider || !online) return
    setSyncStatus(null)
    try {
      const result = await migrateActiveNotebookAndRefresh()
      if (result.status === 'pushed' && result.attention) {
        setSyncStatus(result.attention)
        return
      }
      if (agentAccessBoundToSelectedProvider) await finishAgentUpgrade()
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : 'Daily sync upgrade failed. Retry when online.')
    } finally {
      await loadProviderStates()
    }
  }

  const handleAgentUpgrade = async () => {
    try {
      await finishAgentUpgrade()
      setSyncStatus('Agent access now uses the daily notebook.')
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : 'Agent access could not be updated.')
    }
  }

  const handleDisconnectWithAgentSafety = async () => {
    if (activeProvider !== selectedSyncProvider && !agentAccessBoundToSelectedProvider) {
      await handleDisconnect()
      return
    }
    await runWithAgentSafety(`disconnect ${selectedSyncProvider}`, handleDisconnect)
  }

  const handleActivateWithAgentSafety = async () => {
    await runWithAgentSafety(
      'switch sync providers',
      handleActivate,
      agentAccess.enabled && activeProvider !== selectedSyncProvider,
    )
  }

  const handleConnectWithAgentSafety = async () => {
    if (activeProvider !== 'onedrive' && !(selectedSyncProvider === 'onedrive' && agentAccess.enabled)) {
      handleConnect()
      return
    }
    const blockedReason = claimPrimaryTabForSync()
    if (blockedReason) {
      setSyncStatus(blockedReason)
      return
    }
    await runWithAgentSafety(`connect ${selectedSyncProvider}`, async () => { handleConnect() })
  }

  const handleEnableAgentAccess = async () => {
    const dailyFolderId = activeSyncStatus.daily ? activeSyncStatus.notebookChannel ?? undefined : undefined
    const googleFile = googleDriveFileId ?? dailyFolderId
    const oneDriveFolder = activeProvider === 'onedrive' ? oneDrive.notebookFolder : null
    const enabled = selectedSyncProvider === 'dropbox'
      ? await agentAccess.enable({ provider: 'dropbox', path: savedDropboxPath, dailyFolderId })
      : selectedSyncProvider === 'google-drive' && googleFile
        ? await agentAccess.enable({ provider: 'google-drive', fileId: googleFile, dailyFolderId })
        : selectedSyncProvider === 'onedrive' && oneDriveFolder
          ? await agentAccess.enable({ provider: 'onedrive', folder: oneDriveFolder })
          : false
    if (enabled) await oauthPending.continueAfterEnable()
  }

  const handleDisableAgentAccess = async () => {
    await runConfirmedAgentAccessDisable({
      confirmDisable: window.confirm,
      disable: agentAccess.disable,
    })
  }

  // Sync attention belongs to the active provider; only surface it (and the
  // force action it calls for) while that provider's panel is the one shown.
  const selectedAttention = activeProvider === selectedSyncProvider ? syncAttention : null

  const setupNotices = getSetupNotices({
    aiNeedsSetup: !isProviderReady(provider, providerSettings, llmSecrets),
    syncNeedsSetup: activeProvider === null,
    dismissed: dismissedSetupNotices,
  })
  const attentionItems = buildAttentionItems({
    persistFailureMessage,
    syncAttentionMessage: syncAttention?.message ?? null,
    activeSyncProvider: activeProvider,
    setupNotices,
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
  }, [initialLoadDone, location.hash, location.key, syncOpenRequest])

  return (
    <div className="space-y-4">
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

        {(oauthPending.view.state === 'pending' ||
          oauthPending.view.state === 'restart' ||
          oauthPending.view.state === 'error') && (
          <McpOAuthPendingBanner
            view={oauthPending.view}
            onContinue={oauthPending.continueNow}
            onCancel={oauthPending.cancel}
            onRetry={() => {
              void oauthPending.load()
            }}
          />
        )}

        {initialLoadDone &&
          attentionItems.map((item) => (
            <AttentionBanner
              key={item.id}
              item={item}
              onOpen={() => {
                if (item.settingsSectionId === 'settings-sync') openSyncPanel(item.syncProvider ?? activeProvider)
                window.requestAnimationFrame(() => scrollToSection(item.settingsSectionId))
              }}
              onDismiss={
                item.dismissibleSetupNoticeId
                  ? () => {
                      void dismissSetupNotice(item.dismissibleSetupNoticeId!).catch((error) => {
                        console.error('[Setup reminder dismissal failed]', error)
                      })
                    }
                  : undefined
              }
            />
          ))}
      </div>

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
          openRequest={syncOpenRequest}
          summaries={{
            onedrive: oneDriveSummary,
            dropbox: dropboxSummary,
            'google-drive': googleDriveSummary,
          }}
          online={online}
          syncPaused={!tabSync.isPrimary}
          attention={selectedAttention?.message ?? null}
          targetDraft={selectedTarget}
          targetDirty={selectedTargetDirty}
          syncBusy={syncing}
          status={syncStatus ?? (selectedSyncProvider === 'onedrive' ? oneDrive.migrationMessage ?? oneDrive.offlineProgress : null)}
          advanced={showAdvanced}
          daily={activeProvider === selectedSyncProvider && activeSyncStatus.daily}
          onMigrate={selectedSyncProvider === 'onedrive' ? undefined : handleDailyUpgrade}
          onMigrateAgent={activeSyncStatus.daily && agentAccessBoundToSelectedProvider &&
            agentAccess.view.state === 'enabled' && !agentAccess.view.profile.dailyFolderId ? handleAgentUpgrade : undefined}
          showForcePull={pullRefused || selectedAttention?.operation === 'pull'}
          showForcePush={pushBlocked || selectedAttention?.operation === 'push'}
          onProviderChange={(nextProvider) => {
            setSyncProviderDraft(nextProvider)
            setSyncStatus(null)
          }}
          onConnect={handleConnectWithAgentSafety}
          onDisconnect={handleDisconnectWithAgentSafety}
          onActivate={handleActivateWithAgentSafety}
          onTargetChange={(value) => {
            if (selectedSyncProvider === 'onedrive') setOneDriveTargetDraft(value)
            else if (selectedSyncProvider === 'dropbox') setDropboxPathDraft(value)
            else setGoogleDriveFileNameDraft(value)
          }}
          onSaveTarget={handleSaveSyncTarget}
          onPull={handlePull}
          onForcePull={handleForcePull}
          onPush={handlePush}
          agentAccess={{
            view: agentAccess.view,
            busy: agentAccess.busy,
            online,
            targetReady:
              selectedSyncProvider === 'dropbox'
                ? Boolean(savedDropboxPath.trim())
                : selectedSyncProvider === 'onedrive'
                  ? Boolean(oneDrive.notebookFolder)
                  : Boolean(googleDriveFileId || activeSyncStatus.daily && activeSyncStatus.notebookChannel),
            statusKnown: agentAccess.statusKnown,
            enabled: agentAccess.enabled,
            boundToProvider: agentAccessBoundToSelectedProvider,
            onEnable: handleEnableAgentAccess,
            onDisable: handleDisableAgentAccess,
            onRetry: agentAccess.load,
          }}
        />
      </div>

      <div className="mx-3 sm:mx-0">
        <AppearanceSection
          advanced={showAdvanced}
          themePreference={themePreference}
          appIdentity={appIdentity}
          onAppIdentityChange={updateAppIdentity}
          wallpaper={wallpaper}
          highlightInputMode={highlightInputMode}
          autocorrection={autocorrection}
          animations={animations}
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
          onAnimationsChange={(enabled) => {
            void updateAnimations(enabled)
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
          exportFileName={exportFileName}
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
        {appIdentities[appIdentity].name} v{__APP_VERSION__} •{' '}
        <Link to="/privacy" className="underline hover:text-slate-600">
          Privacy Policy
        </Link>{' '}
        •{' '}
        <a
          href={appIdentities[appIdentity].source}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-slate-600"
        >
          Open source
        </a>{' '}
        • {appIdentity === 'ait' ? 'Original by' : 'Made by'}{' '}
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
