import { create } from 'zustand'
import { isIOS } from '../lib/device'
import { type BodyFont, type MonospaceFont, type TitleFont, isBodyFont, isMonospaceFont, isTitleFont } from '../lib/fonts'
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

type Wallpaper = 'white' | 'thoughts-light' | 'thoughts-high'

type FontPreference = 'proportional' | 'monospace'

type AiLanguage = 'follow' | string

type SettingsState = {
  provider: LlmProviderId
  providerSettings: LlmProviderSettings
  llmSecrets: LlmSecrets
  allowWebSearch: boolean
  aiLanguage: AiLanguage
  settingsError: string | null
  loading: boolean
  dismissedSetupNotices: DismissedSetupNotices
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
  updateWallpaper: (wallpaper: Wallpaper) => Promise<void>
  updateHighlightInputMode: (enabled: boolean) => Promise<void>
  updateAutocorrection: (enabled: boolean) => Promise<void>
  updateFontPreference: (fontPreference: FontPreference) => Promise<void>
  updateBodyFont: (bodyFont: BodyFont) => Promise<void>
  updateMonospaceFont: (monospaceFont: MonospaceFont) => Promise<void>
  updateTitleFont: (titleFont: TitleFont) => Promise<void>
  dismissSetupNotice: (noticeId: SetupNoticeId) => Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const useSettingsStore = create<SettingsState>((set, get) => ({
  provider: 'gemini',
  providerSettings: DEFAULT_LLM_PROVIDER_SETTINGS,
  llmSecrets: {},
  allowWebSearch: true,
  aiLanguage: 'follow',
  settingsError: null,
  loading: false,
  dismissedSetupNotices: DEFAULT_DISMISSED_SETUP_NOTICES,
  wallpaper: isIOS() ? 'white' : 'thoughts-light',
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
      const providerSettings = normalizeProviderSettings(
        storedProviders,
        legacyGeminiModel,
        legacyAllowThinking,
        !Number.isFinite(llmSchemaVersion) || llmSchemaVersion < 2,
      )
      const llmSecrets = normalizeSecrets(storedSecrets)
      const allowWebSearch = storedAllowWebSearch !== 'false'
      const aiLanguage = storedAiLanguage || 'follow'
      const defaultWallpaper: Wallpaper = isIOS() ? 'white' : 'thoughts-light'
      const wallpaper: Wallpaper =
        storedWallpaper === 'thoughts-medium'
          ? 'thoughts-high'
          : storedWallpaper === 'white' ||
              storedWallpaper === 'thoughts-light' ||
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

      const persistedProviders = mergePersistedProviderSettings(storedProviders, providerSettings)
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

      set({
        provider,
        providerSettings,
        llmSecrets,
        allowWebSearch,
        aiLanguage,
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
    await setJsonSetting('llm.providers', mergePersistedProviderSettings(currentStored, nextSettings))

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
      ...(provider === 'gemini' ? { geminiApiKey: normalizedKey } : {}),
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

  updateFontPreference: async (fontPreference) => {
    await setSetting('appearance.font', fontPreference)
    set({ fontPreference })
  },

  updateBodyFont: async (bodyFont) => {
    await setSetting('appearance.bodyFont', bodyFont)
    set({ bodyFont })
  },

  updateMonospaceFont: async (monospaceFont) => {
    await setSetting('appearance.monospaceFont', monospaceFont)
    set({ monospaceFont })
  },

  updateTitleFont: async (titleFont) => {
    await setSetting('appearance.titleFont', titleFont)
    set({ titleFont })
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
