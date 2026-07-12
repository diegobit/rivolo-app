import { create } from 'zustand'
import {
  getFontPresetSettings,
  type BodyFont,
  type BodyFontChoice,
  type FontPreference,
  type FontPreset,
  type MonospaceFont,
  type TitleFont,
  isBodyFont,
  isMonospaceFont,
  isTitleFont,
} from '../lib/fonts'
import {
  DEFAULT_LLM_PROVIDER_SETTINGS,
  isLlmProviderId,
  mergePersistedProviderSettings,
  normalizeProviderSettings,
  normalizeSecrets,
  type LlmProviderId,
  type LlmProviderSettings,
  type LlmSecrets,
} from '../lib/llm/types'
import {
  DEFAULT_DISMISSED_SETUP_NOTICES,
  type DismissedSetupNotices,
  type SetupNoticeId,
} from '../lib/setupAttention'
import { getJsonSetting, getSetting, setJsonSetting, setSetting } from '../lib/settingsRepository'
import {
  getLocalThemePreference,
  normalizeThemePreference,
  syncThemePreference,
  type ThemePreference,
} from '../lib/theme'

type Wallpaper = 'none' | 'thoughts-light' | 'thoughts-high'

type AiLanguage = 'follow' | string

type SettingsView = 'basic' | 'advanced'

type SettingsState = {
  provider: LlmProviderId
  providerSettings: LlmProviderSettings
  llmSecrets: LlmSecrets
  allowWebSearch: boolean
  aiLanguage: AiLanguage
  settingsError: string | null
  loading: boolean
  dismissedSetupNotices: DismissedSetupNotices
  settingsView: SettingsView
  themePreference: ThemePreference
  wallpaper: Wallpaper
  highlightInputMode: boolean
  autocorrection: boolean
  fontPreference: FontPreference
  bodyFont: BodyFont
  monospaceFont: MonospaceFont
  titleFont: TitleFont
  loadSettings: () => Promise<void>
  selectProvider: (provider: LlmProviderId) => Promise<void>
  saveProviderSettings: (
    provider: LlmProviderId,
    settings: LlmProviderSettings[LlmProviderId],
  ) => Promise<void>
  saveProviderKey: (provider: LlmProviderId, apiKey: string) => Promise<void>
  clearProviderKey: (provider: LlmProviderId) => Promise<void>
  updateAllowWebSearch: (enabled: boolean) => Promise<void>
  updateAiLanguage: (language: AiLanguage) => Promise<void>
  updateSettingsView: (settingsView: SettingsView) => Promise<void>
  updateThemePreference: (themePreference: ThemePreference) => Promise<void>
  updateWallpaper: (wallpaper: Wallpaper) => Promise<void>
  updateHighlightInputMode: (enabled: boolean) => Promise<void>
  updateAutocorrection: (enabled: boolean) => Promise<void>
  updateFontPreset: (preset: FontPreset) => Promise<void>
  updateTitleFont: (titleFont: TitleFont) => Promise<void>
  updateBodyFontChoice: (choice: BodyFontChoice) => Promise<void>
  dismissSetupNotice: (noticeId: SetupNoticeId) => Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSettingsView = (value: string | null): value is SettingsView =>
  value === 'basic' || value === 'advanced'

type NativeLlmProviderId = Exclude<LlmProviderId, 'openai-compatible'>
type ModelSource = 'default' | 'custom'

const nativeLlmProviderIds: NativeLlmProviderId[] = ['gemini', 'anthropic', 'openai']

const knownNativeDefaultModels: Record<NativeLlmProviderId, string[]> = {
  // When changing a native default model, keep the previous default here for one release.
  gemini: [DEFAULT_LLM_PROVIDER_SETTINGS.gemini.model],
  anthropic: [DEFAULT_LLM_PROVIDER_SETTINGS.anthropic.model],
  openai: [DEFAULT_LLM_PROVIDER_SETTINGS.openai.model],
}

const readStoredString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const isModelSource = (value: unknown): value is ModelSource =>
  value === 'default' || value === 'custom'

const readProviderRecord = (root: Record<string, unknown>, provider: LlmProviderId) =>
  isRecord(root[provider]) ? root[provider] : {}

const readModelSource = (providerRecord: Record<string, unknown>) =>
  isModelSource(providerRecord.modelSource) ? providerRecord.modelSource : null

const inferModelSource = (
  provider: NativeLlmProviderId,
  providerRecord: Record<string, unknown>,
  fallbackModel: string | null | undefined,
): ModelSource => {
  const storedSource = readModelSource(providerRecord)
  if (storedSource) return storedSource

  const storedModel = readStoredString(providerRecord.model) || readStoredString(fallbackModel)
  return storedModel && !knownNativeDefaultModels[provider].includes(storedModel)
    ? 'custom'
    : 'default'
}

const applyNativeModelDefaults = (
  storedProviders: unknown,
  settings: LlmProviderSettings,
  legacyGeminiModel: string | null,
) => {
  const root = isRecord(storedProviders) ? storedProviders : {}
  const nextSettings = { ...settings } as LlmProviderSettings
  const modelSources: Record<NativeLlmProviderId, ModelSource> = {
    gemini: 'default',
    anthropic: 'default',
    openai: 'default',
  }

  for (const provider of nativeLlmProviderIds) {
    const source = inferModelSource(
      provider,
      readProviderRecord(root, provider),
      provider === 'gemini' ? legacyGeminiModel : null,
    )
    modelSources[provider] = source
    if (source === 'default') {
      if (provider === 'gemini') {
        nextSettings.gemini = {
          ...nextSettings.gemini,
          model: DEFAULT_LLM_PROVIDER_SETTINGS.gemini.model,
        }
      } else if (provider === 'anthropic') {
        nextSettings.anthropic = {
          ...nextSettings.anthropic,
          model: DEFAULT_LLM_PROVIDER_SETTINGS.anthropic.model,
        }
      } else {
        nextSettings.openai = {
          ...nextSettings.openai,
          model: DEFAULT_LLM_PROVIDER_SETTINGS.openai.model,
        }
      }
    }
  }

  return { settings: nextSettings, modelSources }
}

const addModelSourcesToPersistedProviders = (
  persistedProviders: Record<string, unknown>,
  modelSources: Record<NativeLlmProviderId, ModelSource>,
) => {
  for (const provider of nativeLlmProviderIds) {
    const providerRecord = readProviderRecord(persistedProviders, provider)
    persistedProviders[provider] = {
      ...providerRecord,
      modelSource: modelSources[provider],
    }
  }
  return persistedProviders
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  provider: 'gemini',
  providerSettings: DEFAULT_LLM_PROVIDER_SETTINGS,
  llmSecrets: {},
  allowWebSearch: true,
  aiLanguage: 'follow',
  settingsError: null,
  loading: false,
  dismissedSetupNotices: DEFAULT_DISMISSED_SETUP_NOTICES,
  settingsView: 'basic',
  themePreference: getLocalThemePreference() ?? 'system',
  wallpaper: 'thoughts-light',
  highlightInputMode: false,
  autocorrection: true,
  fontPreference: 'monospace',
  bodyFont: 'system',
  monospaceFont: 'iawriter',
  titleFont: 'handlee',

  loadSettings: async () => {
    set({ loading: true, settingsError: null })

    try {
      const [
        storedProvider,
        storedProviders,
        storedLlmSchemaVersion,
        legacyGeminiModel,
        legacyAllowThinking,
        storedAllowWebSearch,
        storedAiLanguage,
        storedSecrets,
        storedSettingsView,
        storedTheme,
        storedWallpaper,
        storedHighlightInputMode,
        storedAutocorrection,
        storedFontPreference,
        storedBodyFont,
        storedMonospaceFont,
        storedTitleFont,
        storedDismissedAiSetup,
        storedDismissedSyncSetup,
      ] = await Promise.all([
        getSetting('llm.provider'),
        getJsonSetting<unknown>('llm.providers'),
        getSetting('llm.schemaVersion'),
        getSetting('llm.geminiModel'),
        getSetting('llm.allowThinking'),
        getSetting('llm.allowWebSearch'),
        getSetting('ai.language'),
        getJsonSetting<unknown>('llm.secrets'),
        getSetting('settings.view'),
        getSetting('appearance.theme'),
        getSetting('appearance.wallpaper'),
        getSetting('appearance.highlightInputMode'),
        getSetting('appearance.autocorrection'),
        getSetting('appearance.font'),
        getSetting('appearance.bodyFont'),
        getSetting('appearance.monospaceFont'),
        getSetting('appearance.titleFont'),
        getSetting('setup.dismissedAi'),
        getSetting('setup.dismissedSync'),
      ])

      const provider = isLlmProviderId(storedProvider) ? storedProvider : 'gemini'
      const llmSchemaVersion = Number.parseInt(storedLlmSchemaVersion ?? '', 10)
      const normalizedProviderSettings = normalizeProviderSettings(
        storedProviders,
        legacyGeminiModel,
        legacyAllowThinking,
        !Number.isFinite(llmSchemaVersion) || llmSchemaVersion < 2,
      )
      const {
        settings: providerSettings,
        modelSources,
      } = applyNativeModelDefaults(
        storedProviders,
        normalizedProviderSettings,
        legacyGeminiModel,
      )
      const llmSecrets = normalizeSecrets(storedSecrets)
      const allowWebSearch = storedAllowWebSearch !== 'false'
      const aiLanguage = storedAiLanguage || 'follow'
      const settingsView: SettingsView = isSettingsView(storedSettingsView)
        ? storedSettingsView
        : 'basic'
      const themePreference = normalizeThemePreference(storedTheme)
      const defaultWallpaper: Wallpaper = 'thoughts-light'
      const wallpaper: Wallpaper =
        storedWallpaper === 'thoughts-medium'
          ? 'thoughts-high'
          : storedWallpaper === 'white' || storedWallpaper === 'none'
            ? 'none'
            : storedWallpaper === 'thoughts-light' ||
              storedWallpaper === 'thoughts-high'
            ? storedWallpaper
            : defaultWallpaper
      const highlightInputMode = storedHighlightInputMode === 'true'
      const autocorrection = storedAutocorrection !== 'false'
      const fontPreference = (storedFontPreference as FontPreference | null) ?? 'monospace'
      const bodyFont = isBodyFont(storedBodyFont) ? storedBodyFont : 'system'
      const monospaceFont = isMonospaceFont(storedMonospaceFont) ? storedMonospaceFont : 'iawriter'
      const titleFont = isTitleFont(storedTitleFont) ? storedTitleFont : 'handlee'
      const dismissedSetupNotices: DismissedSetupNotices = {
        ai: storedDismissedAiSetup === 'true',
        sync: storedDismissedSyncSetup === 'true',
      }

      const persistedProviders = addModelSourcesToPersistedProviders(
        mergePersistedProviderSettings(storedProviders, providerSettings),
        modelSources,
      )
      const secretsRoot = isRecord(storedSecrets) ? storedSecrets : {}
      const storedGeminiSecret = isRecord(secretsRoot.gemini) ? secretsRoot.gemini : {}
      const shouldMigrateLegacyGeminiSecret =
        Boolean(llmSecrets.gemini?.apiKey) &&
        (typeof storedGeminiSecret.apiKey !== 'string' || !storedGeminiSecret.apiKey.trim())
      const persistedSecrets = shouldMigrateLegacyGeminiSecret
        ? {
            ...secretsRoot,
            gemini: { ...storedGeminiSecret, apiKey: llmSecrets.gemini?.apiKey },
          }
        : secretsRoot

      const migrations: Promise<void>[] = [
        setJsonSetting('llm.providers', persistedProviders),
      ]
      if (storedProvider !== provider) migrations.push(setSetting('llm.provider', provider))
      if (shouldMigrateLegacyGeminiSecret) migrations.push(setJsonSetting('llm.secrets', persistedSecrets))
      if (storedAllowWebSearch !== 'true' && storedAllowWebSearch !== 'false') {
        migrations.push(setSetting('llm.allowWebSearch', allowWebSearch ? 'true' : 'false'))
      }
      if (!storedAiLanguage) migrations.push(setSetting('ai.language', aiLanguage))
      if (storedSettingsView !== settingsView) {
        migrations.push(setSetting('settings.view', settingsView))
      }
      if (storedTheme !== themePreference) migrations.push(setSetting('appearance.theme', themePreference))
      if (storedWallpaper !== wallpaper) migrations.push(setSetting('appearance.wallpaper', wallpaper))
      if (storedHighlightInputMode !== 'true' && storedHighlightInputMode !== 'false') {
        migrations.push(setSetting('appearance.highlightInputMode', highlightInputMode ? 'true' : 'false'))
      }
      if (storedAutocorrection !== 'true' && storedAutocorrection !== 'false') {
        migrations.push(setSetting('appearance.autocorrection', autocorrection ? 'true' : 'false'))
      }
      if (!storedFontPreference) migrations.push(setSetting('appearance.font', fontPreference))
      if (!storedBodyFont || !isBodyFont(storedBodyFont)) migrations.push(setSetting('appearance.bodyFont', bodyFont))
      if (!storedMonospaceFont || !isMonospaceFont(storedMonospaceFont)) {
        migrations.push(setSetting('appearance.monospaceFont', monospaceFont))
      }
      if (!storedTitleFont || !isTitleFont(storedTitleFont)) migrations.push(setSetting('appearance.titleFont', titleFont))

      await Promise.all(migrations)
      await setSetting('llm.schemaVersion', '2')
      syncThemePreference(themePreference)

      set({
        provider,
        providerSettings,
        llmSecrets,
        allowWebSearch,
        aiLanguage,
        settingsView,
        themePreference,
        wallpaper,
        highlightInputMode,
        autocorrection,
        fontPreference,
        bodyFont,
        monospaceFont,
        titleFont,
        dismissedSetupNotices,
        loading: false,
      })
    } catch (error) {
      console.error('[Settings migration failed]', error)
      set({
        loading: false,
        settingsError: 'AI settings could not be migrated. Existing local data was left in place.',
      })
    }
  },

  selectProvider: async (provider) => {
    await setSetting('llm.provider', provider)
    set({ provider })
  },

  saveProviderSettings: async (provider, settings) => {
    const currentStored = await getJsonSetting<unknown>('llm.providers')
    const currentRoot = isRecord(currentStored) ? currentStored : {}
    const normalizedSettings =
      provider === 'gemini'
        ? {
            ...(settings as LlmProviderSettings['gemini']),
            allowThinking:
              (settings as LlmProviderSettings['gemini']).reasoning.thinkingLevel !== 'minimal',
          }
        : settings
    const nextSettings = {
      ...get().providerSettings,
      [provider]: normalizedSettings,
    } as LlmProviderSettings
    const persistedProviders = mergePersistedProviderSettings(currentStored, nextSettings)

    if (provider !== 'openai-compatible') {
      const providerRecord = readProviderRecord(currentRoot, provider)
      const currentModel = get().providerSettings[provider].model
      const nextModel = nextSettings[provider].model
      const inferredSource = inferModelSource(provider, providerRecord, currentModel)
      const nextSource: ModelSource =
        nextModel !== currentModel
          ? nextModel === DEFAULT_LLM_PROVIDER_SETTINGS[provider].model
            ? 'default'
            : 'custom'
          : inferredSource
      persistedProviders[provider] = {
        ...readProviderRecord(persistedProviders, provider),
        modelSource: nextSource,
      }
    }

    await setJsonSetting('llm.providers', persistedProviders)

    if (provider === 'gemini') {
      const geminiSettings = normalizedSettings as LlmProviderSettings['gemini']
      await Promise.all([
        setSetting('llm.geminiModel', geminiSettings.model),
        setSetting('llm.allowThinking', geminiSettings.allowThinking ? 'true' : 'false'),
      ])
    }

    set({ providerSettings: nextSettings })
  },

  saveProviderKey: async (provider, apiKey) => {
    const normalizedKey = apiKey.trim()
    if (!normalizedKey) return

    const currentStored = await getJsonSetting<unknown>('llm.secrets')
    const root = isRecord(currentStored) ? currentStored : {}
    const currentProvider = isRecord(root[provider]) ? root[provider] : {}
    const nextStored = {
      ...root,
      [provider]: { ...currentProvider, apiKey: normalizedKey },
    }
    await setJsonSetting('llm.secrets', nextStored)
    set({ llmSecrets: { ...get().llmSecrets, [provider]: { apiKey: normalizedKey } } })
  },

  clearProviderKey: async (provider) => {
    const currentStored = await getJsonSetting<unknown>('llm.secrets')
    const root = isRecord(currentStored) ? currentStored : {}
    const currentProvider = isRecord(root[provider]) ? root[provider] : {}
    const remainingProviderFields = { ...currentProvider }
    delete remainingProviderFields.apiKey
    const nextStored: Record<string, unknown> = {
      ...root,
      [provider]: remainingProviderFields,
    }
    // Still clear the legacy mirror on removal (unlike the save path, which no longer
    // writes it): normalizeSecrets falls back to root.geminiApiKey when gemini.apiKey is
    // absent, so leaving a stale legacy value here would resurrect a "removed" key for
    // any user whose stored data predates this cleanup.
    if (provider === 'gemini') delete nextStored.geminiApiKey
    await setJsonSetting('llm.secrets', nextStored)

    const nextSecrets = { ...get().llmSecrets }
    delete nextSecrets[provider]
    set({ llmSecrets: nextSecrets })
  },

  updateAllowWebSearch: async (enabled) => {
    await setSetting('llm.allowWebSearch', enabled ? 'true' : 'false')
    set({ allowWebSearch: enabled })
  },

  updateAiLanguage: async (language) => {
    await setSetting('ai.language', language)
    set({ aiLanguage: language })
  },

  updateSettingsView: async (settingsView) => {
    await setSetting('settings.view', settingsView)
    set({ settingsView })
  },

  updateThemePreference: async (themePreference) => {
    await setSetting('appearance.theme', themePreference)
    syncThemePreference(themePreference)
    set({ themePreference })
  },

  updateWallpaper: async (wallpaper) => {
    await setSetting('appearance.wallpaper', wallpaper)
    set({ wallpaper })
  },

  updateHighlightInputMode: async (enabled) => {
    await setSetting('appearance.highlightInputMode', enabled ? 'true' : 'false')
    set({ highlightInputMode: enabled })
  },

  updateAutocorrection: async (enabled) => {
    await setSetting('appearance.autocorrection', enabled ? 'true' : 'false')
    set({ autocorrection: enabled })
  },

  updateFontPreset: async (preset) => {
    const settings = getFontPresetSettings(preset)
    await Promise.all([
      setSetting('appearance.font', settings.fontPreference),
      setSetting('appearance.bodyFont', settings.bodyFont),
      setSetting('appearance.monospaceFont', settings.monospaceFont),
      setSetting('appearance.titleFont', settings.titleFont),
    ])
    set(settings)
  },

  updateTitleFont: async (titleFont) => {
    await setSetting('appearance.titleFont', titleFont)
    set({ titleFont })
  },

  updateBodyFontChoice: async (choice) => {
    if (choice === 'lato') {
      await setSetting('appearance.font', 'proportional')
      set({ fontPreference: 'proportional' })
      return
    }
    await Promise.all([
      setSetting('appearance.font', 'monospace'),
      setSetting('appearance.monospaceFont', choice),
    ])
    set({ fontPreference: 'monospace', monospaceFont: choice })
  },

  dismissSetupNotice: async (noticeId) => {
    const previous = get().dismissedSetupNotices
    const next = { ...previous, [noticeId]: true }
    set({ dismissedSetupNotices: next })
    try {
      await setSetting(`setup.dismissed${noticeId === 'ai' ? 'Ai' : 'Sync'}`, 'true')
    } catch (error) {
      set({ dismissedSetupNotices: previous })
      throw error
    }
  },
}))
