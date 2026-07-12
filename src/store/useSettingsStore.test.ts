import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from './useSettingsStore'
import { DEFAULT_LLM_PROVIDER_SETTINGS } from '../lib/llm/types'
import { THEME_STORAGE_KEY } from '../lib/theme'

const settingsRepository = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getJsonSetting: vi.fn(),
  setJsonSetting: vi.fn(),
}))

vi.mock('../lib/settingsRepository', () => settingsRepository)

const installMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

const mockLoadSettingsValues = (
  values: Record<string, string | null> = {},
  jsonValues: Record<string, unknown> = {},
) => {
  settingsRepository.getSetting.mockImplementation((key: string) =>
    Promise.resolve(values[key] ?? null),
  )
  settingsRepository.getJsonSetting.mockImplementation((key: string) =>
    Promise.resolve(jsonValues[key] ?? null),
  )
}

describe('useSettingsStore setup notice dismissal', () => {
  beforeEach(() => {
    settingsRepository.setSetting.mockReset().mockResolvedValue(undefined)
    useSettingsStore.setState({ dismissedSetupNotices: { ai: false, sync: false } })
  })

  it('persists an individual dismissal', async () => {
    await useSettingsStore.getState().dismissSetupNotice('ai')

    expect(settingsRepository.setSetting).toHaveBeenCalledExactlyOnceWith(
      'setup.dismissedAi',
      'true',
    )
    expect(useSettingsStore.getState().dismissedSetupNotices).toEqual({ ai: true, sync: false })
  })

  it('restores the reminder when persistence fails', async () => {
    settingsRepository.setSetting.mockRejectedValueOnce(new Error('write failed'))

    await expect(useSettingsStore.getState().dismissSetupNotice('sync')).rejects.toThrow(
      'write failed',
    )
    expect(useSettingsStore.getState().dismissedSetupNotices).toEqual({ ai: false, sync: false })
  })
})

describe('useSettingsStore theme preference', () => {
  beforeEach(() => {
    installMatchMedia(false)
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-preference')
    document.head.innerHTML = '<meta name="theme-color" content="#ffffff" />'
    settingsRepository.getSetting.mockReset()
    settingsRepository.setSetting.mockReset().mockResolvedValue(undefined)
    settingsRepository.getJsonSetting.mockReset()
    settingsRepository.setJsonSetting.mockReset().mockResolvedValue(undefined)
    useSettingsStore.setState({ themePreference: 'system', loading: false, settingsError: null })
  })

  it('defaults missing theme settings to system and mirrors the resolved light theme', async () => {
    mockLoadSettingsValues()

    await useSettingsStore.getState().loadSettings()

    expect(useSettingsStore.getState().themePreference).toBe('system')
    expect(useSettingsStore.getState().aiLanguage).toBe('follow')
    expect(useSettingsStore.getState().wallpaper).toBe('thoughts-light')
    expect(settingsRepository.setSetting).toHaveBeenCalledWith('appearance.theme', 'system')
    expect(settingsRepository.setSetting).toHaveBeenCalledWith('ai.language', 'follow')
    expect(settingsRepository.setSetting).toHaveBeenCalledWith('appearance.wallpaper', 'thoughts-light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(document.querySelector("meta[name='theme-color']")).toHaveAttribute('content', '#ffffff')
  })

  it('normalizes an invalid stored theme to system', async () => {
    mockLoadSettingsValues({ 'appearance.theme': 'sepia' })

    await useSettingsStore.getState().loadSettings()

    expect(useSettingsStore.getState().themePreference).toBe('system')
    expect(settingsRepository.setSetting).toHaveBeenCalledWith('appearance.theme', 'system')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
  })

  it('persists theme updates to IndexedDB and the localStorage mirror', async () => {
    await useSettingsStore.getState().updateThemePreference('dark')

    expect(settingsRepository.setSetting).toHaveBeenCalledExactlyOnceWith('appearance.theme', 'dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(useSettingsStore.getState().themePreference).toBe('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.querySelector("meta[name='theme-color']")).toHaveAttribute('content', '#05070b')
  })

  it('migrates the legacy white wallpaper value to none', async () => {
    mockLoadSettingsValues({ 'appearance.wallpaper': 'white' })

    await useSettingsStore.getState().loadSettings()

    expect(useSettingsStore.getState().wallpaper).toBe('none')
    expect(settingsRepository.setSetting).toHaveBeenCalledWith('appearance.wallpaper', 'none')
  })

  it('writes a font preset through the existing font setting keys', async () => {
    await useSettingsStore.getState().updateFontPreset('proportional')

    expect(settingsRepository.setSetting).toHaveBeenCalledWith('appearance.font', 'proportional')
    expect(settingsRepository.setSetting).toHaveBeenCalledWith('appearance.bodyFont', 'system')
    expect(settingsRepository.setSetting).toHaveBeenCalledWith('appearance.monospaceFont', 'iawriter')
    expect(settingsRepository.setSetting).toHaveBeenCalledWith('appearance.titleFont', 'handlee')
    expect(useSettingsStore.getState()).toMatchObject({
      fontPreference: 'proportional',
      bodyFont: 'system',
      monospaceFont: 'iawriter',
      titleFont: 'handlee',
    })
  })

  it('persists an individual title font choice', async () => {
    await useSettingsStore.getState().updateTitleFont('bree')

    expect(settingsRepository.setSetting).toHaveBeenCalledExactlyOnceWith(
      'appearance.titleFont',
      'bree',
    )
    expect(useSettingsStore.getState().titleFont).toBe('bree')
  })

  it('maps body font choices onto font preference and monospace font', async () => {
    await useSettingsStore.getState().updateBodyFontChoice('inconsolata')

    expect(settingsRepository.setSetting).toHaveBeenCalledWith('appearance.font', 'monospace')
    expect(settingsRepository.setSetting).toHaveBeenCalledWith(
      'appearance.monospaceFont',
      'inconsolata',
    )
    expect(useSettingsStore.getState()).toMatchObject({
      fontPreference: 'monospace',
      monospaceFont: 'inconsolata',
    })

    await useSettingsStore.getState().updateBodyFontChoice('lato')

    expect(settingsRepository.setSetting).toHaveBeenCalledWith('appearance.font', 'proportional')
    expect(useSettingsStore.getState().fontPreference).toBe('proportional')
  })

  it('moves stored native default models to the current app default', async () => {
    mockLoadSettingsValues({}, {
      'llm.providers': {
        gemini: {
          model: 'removed-gemini-default',
          modelSource: 'default',
          reasoning: { thinkingLevel: 'high' },
          allowThinking: true,
        },
      },
    })

    await useSettingsStore.getState().loadSettings()

    expect(useSettingsStore.getState().providerSettings.gemini.model).toBe(
      DEFAULT_LLM_PROVIDER_SETTINGS.gemini.model,
    )
    expect(settingsRepository.setJsonSetting).toHaveBeenCalledWith(
      'llm.providers',
      expect.objectContaining({
        gemini: expect.objectContaining({
          model: DEFAULT_LLM_PROVIDER_SETTINGS.gemini.model,
          modelSource: 'default',
        }),
      }),
    )
  })

  it('preserves stored custom native model values', async () => {
    mockLoadSettingsValues({}, {
      'llm.providers': {
        anthropic: {
          model: 'claude-custom-model',
          reasoning: { mode: 'default' },
        },
      },
    })

    await useSettingsStore.getState().loadSettings()

    expect(useSettingsStore.getState().providerSettings.anthropic.model).toBe('claude-custom-model')
    expect(settingsRepository.setJsonSetting).toHaveBeenCalledWith(
      'llm.providers',
      expect.objectContaining({
        anthropic: expect.objectContaining({
          model: 'claude-custom-model',
          modelSource: 'custom',
        }),
      }),
    )
  })

  it('marks explicit native model edits as custom', async () => {
    settingsRepository.getJsonSetting.mockResolvedValue({
      gemini: {
        model: DEFAULT_LLM_PROVIDER_SETTINGS.gemini.model,
        modelSource: 'default',
      },
    })
    useSettingsStore.setState({ providerSettings: DEFAULT_LLM_PROVIDER_SETTINGS })

    await useSettingsStore.getState().saveProviderSettings('gemini', {
      ...DEFAULT_LLM_PROVIDER_SETTINGS.gemini,
      model: 'gemini-custom-model',
    })

    expect(settingsRepository.setJsonSetting).toHaveBeenCalledWith(
      'llm.providers',
      expect.objectContaining({
        gemini: expect.objectContaining({
          model: 'gemini-custom-model',
          modelSource: 'custom',
        }),
      }),
    )
  })
})

describe('useSettingsStore legacy geminiApiKey', () => {
  beforeEach(() => {
    installMatchMedia(false)
    settingsRepository.getSetting.mockReset()
    settingsRepository.setSetting.mockReset().mockResolvedValue(undefined)
    settingsRepository.getJsonSetting.mockReset()
    settingsRepository.setJsonSetting.mockReset().mockResolvedValue(undefined)
    useSettingsStore.setState({ llmSecrets: {}, providerSettings: DEFAULT_LLM_PROVIDER_SETTINGS })
  })

  it('still migrates a pre-existing legacy geminiApiKey on load', async () => {
    mockLoadSettingsValues({}, { 'llm.secrets': { geminiApiKey: 'legacy-key' } })

    await useSettingsStore.getState().loadSettings()

    expect(useSettingsStore.getState().llmSecrets.gemini?.apiKey).toBe('legacy-key')
  })

  it('does not recreate the legacy mirror when saving a new key', async () => {
    settingsRepository.getJsonSetting.mockResolvedValue({})

    await useSettingsStore.getState().saveProviderKey('gemini', 'fresh-key')

    expect(settingsRepository.setJsonSetting).toHaveBeenCalledExactlyOnceWith(
      'llm.secrets',
      { gemini: { apiKey: 'fresh-key' } },
    )
  })

  it('clears a stale legacy mirror when the key is removed, so it cannot resurrect on the next load', async () => {
    settingsRepository.getJsonSetting.mockResolvedValue({
      gemini: { apiKey: 'fresh-key' },
      geminiApiKey: 'stale-legacy-key',
    })

    await useSettingsStore.getState().clearProviderKey('gemini')

    expect(settingsRepository.setJsonSetting).toHaveBeenCalledExactlyOnceWith(
      'llm.secrets',
      { gemini: {} },
    )
  })
})
