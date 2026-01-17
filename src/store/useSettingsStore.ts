import { create } from 'zustand'
import { getJsonSetting, getSetting, setJsonSetting, setSetting } from '../lib/settingsRepository'

type Provider = 'gemini'

type TimelineView = 'full' | 'preview'

type LlmSecrets = {
  geminiApiKey: string
}

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

type AiLanguage = 'follow' | string

type SettingsState = {
  provider: Provider
  geminiApiKey: string | null
  geminiModel: string
  aiLanguage: AiLanguage
  loading: boolean
  timelineView: TimelineView
  loadSettings: () => Promise<void>
  saveGeminiKey: (apiKey: string) => Promise<void>
  updateTimelineView: (view: TimelineView) => Promise<void>
  updateGeminiModel: (model: string) => Promise<void>
  updateAiLanguage: (language: AiLanguage) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  provider: 'gemini',
  geminiApiKey: null,
  geminiModel: DEFAULT_GEMINI_MODEL,
  aiLanguage: 'follow',
  loading: false,
  timelineView: 'full',

  loadSettings: async () => {
    set({ loading: true })
    const provider = (await getSetting('llm.provider')) as Provider | null
    const storedTimelineView = (await getSetting('timeline.view')) as TimelineView | null
    const storedGeminiModel = await getSetting('llm.geminiModel')
    const storedAiLanguage = (await getSetting('ai.language')) as AiLanguage | null
    const timelineView = storedTimelineView ?? 'full'
    const geminiModel = storedGeminiModel ?? DEFAULT_GEMINI_MODEL
    const aiLanguage = storedAiLanguage ?? 'follow'

    if (!storedTimelineView) {
      await setSetting('timeline.view', timelineView)
    }
    if (!storedGeminiModel) {
      await setSetting('llm.geminiModel', geminiModel)
    }
    if (!storedAiLanguage) {
      await setSetting('ai.language', aiLanguage)
    }

    const secrets = await getJsonSetting<LlmSecrets>('llm.secrets')
    const geminiApiKey = secrets?.geminiApiKey ?? null

    set({
      provider: provider ?? 'gemini',
      geminiApiKey,
      geminiModel,
      aiLanguage,
      timelineView,
      loading: false,
    })
  },

  saveGeminiKey: async (apiKey: string) => {
    await setJsonSetting('llm.secrets', { geminiApiKey: apiKey })
    await setSetting('llm.provider', 'gemini')
    set({ geminiApiKey: apiKey, provider: 'gemini' })
  },

  updateTimelineView: async (view: TimelineView) => {
    await setSetting('timeline.view', view)
    set({ timelineView: view })
  },

  updateGeminiModel: async (model: string) => {
    const normalized = model.trim() || DEFAULT_GEMINI_MODEL
    await setSetting('llm.geminiModel', normalized)
    set({ geminiModel: normalized })
  },

  updateAiLanguage: async (language: AiLanguage) => {
    await setSetting('ai.language', language)
    set({ aiLanguage: language })
  },
}))
