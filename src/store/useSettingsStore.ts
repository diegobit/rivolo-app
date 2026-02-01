import { create } from 'zustand'
import { isIOS } from '../lib/device'
import { type BodyFont, type MonospaceFont, type TitleFont, isBodyFont, isMonospaceFont, isTitleFont } from '../lib/fonts'
import { getJsonSetting, getSetting, setJsonSetting, setSetting } from '../lib/settingsRepository'

type Provider = 'gemini'

type Wallpaper = 'white' | 'thoughts-light' | 'thoughts-medium' | 'thoughts-high'

type FontPreference = 'proportional' | 'monospace'

type LlmSecrets = {
  geminiApiKey: string
}

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

type AiLanguage = 'follow' | string

type SettingsState = {
  provider: Provider
  geminiApiKey: string | null
  geminiModel: string
  allowThinking: boolean
  allowWebSearch: boolean
  aiLanguage: AiLanguage
  loading: boolean
  wallpaper: Wallpaper
  highlightInputMode: boolean
  fontPreference: FontPreference
  bodyFont: BodyFont
  monospaceFont: MonospaceFont
  titleFont: TitleFont
  loadSettings: () => Promise<void>
  saveGeminiKey: (apiKey: string) => Promise<void>
  updateGeminiModel: (model: string) => Promise<void>
  updateAllowThinking: (enabled: boolean) => Promise<void>
  updateAllowWebSearch: (enabled: boolean) => Promise<void>
  updateAiLanguage: (language: AiLanguage) => Promise<void>
  updateWallpaper: (wallpaper: Wallpaper) => Promise<void>
  updateHighlightInputMode: (enabled: boolean) => Promise<void>
  updateFontPreference: (fontPreference: FontPreference) => Promise<void>
  updateBodyFont: (bodyFont: BodyFont) => Promise<void>
  updateMonospaceFont: (monospaceFont: MonospaceFont) => Promise<void>
  updateTitleFont: (titleFont: TitleFont) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  provider: 'gemini',
  geminiApiKey: null,
  geminiModel: DEFAULT_GEMINI_MODEL,
  allowThinking: false,
  allowWebSearch: true,
  aiLanguage: 'follow',
  loading: false,
  wallpaper: isIOS() ? 'white' : 'thoughts-light',
  highlightInputMode: false,
  fontPreference: 'monospace',
  bodyFont: 'system',
  monospaceFont: 'iawriter',
  titleFont: 'handlee',

  loadSettings: async () => {
    set({ loading: true })
    const provider = (await getSetting('llm.provider')) as Provider | null
    const storedGeminiModel = await getSetting('llm.geminiModel')
    const storedAllowThinking = await getSetting('llm.allowThinking')
    const storedAllowWebSearch = await getSetting('llm.allowWebSearch')
    const storedAiLanguage = (await getSetting('ai.language')) as AiLanguage | null
    const storedWallpaper = (await getSetting('appearance.wallpaper')) as Wallpaper | null
    const storedHighlightInputMode = await getSetting('appearance.highlightInputMode')
    const storedFontPreference = (await getSetting('appearance.font')) as FontPreference | null
    const storedBodyFont = await getSetting('appearance.bodyFont')
    const storedMonospaceFont = await getSetting('appearance.monospaceFont')
    const storedTitleFont = await getSetting('appearance.titleFont')
    const geminiModel = storedGeminiModel ?? DEFAULT_GEMINI_MODEL
    const allowThinking = storedAllowThinking === 'true'
    const allowWebSearch = storedAllowWebSearch !== 'false'
    const shouldPersistAllowThinking =
      storedAllowThinking === null || (storedAllowThinking !== 'true' && storedAllowThinking !== 'false')
    const shouldPersistAllowWebSearch =
      storedAllowWebSearch === null || (storedAllowWebSearch !== 'true' && storedAllowWebSearch !== 'false')
    const aiLanguage = storedAiLanguage ?? 'follow'
    const defaultWallpaper = isIOS() ? 'white' : 'thoughts-light'
    const wallpaper = storedWallpaper ?? defaultWallpaper
    const highlightInputMode = storedHighlightInputMode === 'true'
    const shouldPersistHighlightInputMode =
      storedHighlightInputMode === null ||
      (storedHighlightInputMode !== 'true' && storedHighlightInputMode !== 'false')
    const fontPreference = storedFontPreference ?? 'monospace'
    const bodyFont = isBodyFont(storedBodyFont) ? storedBodyFont : 'system'
    const monospaceFont = isMonospaceFont(storedMonospaceFont) ? storedMonospaceFont : 'iawriter'
    const titleFont = isTitleFont(storedTitleFont) ? storedTitleFont : 'handlee'

    if (!storedGeminiModel) {
      await setSetting('llm.geminiModel', geminiModel)
    }
    if (shouldPersistAllowThinking) {
      await setSetting('llm.allowThinking', allowThinking ? 'true' : 'false')
    }
    if (shouldPersistAllowWebSearch) {
      await setSetting('llm.allowWebSearch', allowWebSearch ? 'true' : 'false')
    }
    if (!storedAiLanguage) {
      await setSetting('ai.language', aiLanguage)
    }
    if (!storedWallpaper) {
      await setSetting('appearance.wallpaper', wallpaper)
    }
    if (shouldPersistHighlightInputMode) {
      await setSetting('appearance.highlightInputMode', highlightInputMode ? 'true' : 'false')
    }
    if (!storedFontPreference) {
      await setSetting('appearance.font', fontPreference)
    }
    if (!storedBodyFont || !isBodyFont(storedBodyFont)) {
      await setSetting('appearance.bodyFont', bodyFont)
    }
    if (!storedMonospaceFont || !isMonospaceFont(storedMonospaceFont)) {
      await setSetting('appearance.monospaceFont', monospaceFont)
    }
    if (!storedTitleFont || !isTitleFont(storedTitleFont)) {
      await setSetting('appearance.titleFont', titleFont)
    }

    const secrets = await getJsonSetting<LlmSecrets>('llm.secrets')
    const geminiApiKey = secrets?.geminiApiKey ?? null

    set({
      provider: provider ?? 'gemini',
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
      loading: false,
    })
  },

  saveGeminiKey: async (apiKey: string) => {
    await setJsonSetting('llm.secrets', { geminiApiKey: apiKey })
    await setSetting('llm.provider', 'gemini')
    set({ geminiApiKey: apiKey, provider: 'gemini' })
  },

  updateGeminiModel: async (model: string) => {
    const normalized = model.trim() || DEFAULT_GEMINI_MODEL
    await setSetting('llm.geminiModel', normalized)
    set({ geminiModel: normalized })
  },

  updateAllowThinking: async (enabled: boolean) => {
    await setSetting('llm.allowThinking', enabled ? 'true' : 'false')
    set({ allowThinking: enabled })
  },

  updateAllowWebSearch: async (enabled: boolean) => {
    await setSetting('llm.allowWebSearch', enabled ? 'true' : 'false')
    set({ allowWebSearch: enabled })
  },

  updateAiLanguage: async (language: AiLanguage) => {
    await setSetting('ai.language', language)
    set({ aiLanguage: language })
  },

  updateWallpaper: async (wallpaper: Wallpaper) => {
    await setSetting('appearance.wallpaper', wallpaper)
    set({ wallpaper })
  },

  updateHighlightInputMode: async (enabled: boolean) => {
    await setSetting('appearance.highlightInputMode', enabled ? 'true' : 'false')
    set({ highlightInputMode: enabled })
  },

  updateFontPreference: async (fontPreference: FontPreference) => {
    await setSetting('appearance.font', fontPreference)
    set({ fontPreference })
  },

  updateBodyFont: async (bodyFont: BodyFont) => {
    await setSetting('appearance.bodyFont', bodyFont)
    set({ bodyFont })
  },

  updateMonospaceFont: async (monospaceFont: MonospaceFont) => {
    await setSetting('appearance.monospaceFont', monospaceFont)
    set({ monospaceFont })
  },

  updateTitleFont: async (titleFont: TitleFont) => {
    await setSetting('appearance.titleFont', titleFont)
    set({ titleFont })
  },
})
)
