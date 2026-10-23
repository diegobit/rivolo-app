import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from './useSettingsStore'
import { DEFAULT_LLM_PROVIDER_SETTINGS } from '../lib/llm/types'
import { THEME_STORAGE_KEY } from '../lib/theme'
import { ANIMATIONS_STORAGE_KEY } from '../lib/animations'

const settingsRepository = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getJsonSetting: vi.fn(),
  setJsonSetting: vi.fn(),
  setSettings: vi.fn(),
  updateJsonSetting: vi.fn(),
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

const installRepositoryMutationMocks = () => {
  settingsRepository.setSettings.mockImplementation(async (entries: Array<[string, string]>) => {
    for (const [key, value] of entries) await settingsRepository.setSetting(key, value)
  })
  settingsRepository.updateJsonSetting.mockImplementation(async (key: string, update: (value: unknown) => unknown) => {
    const current = await settingsRepository.getJsonSetting(key)
    const next = update(current)
    await settingsRepository.setJsonSetting(key, next)
    return next
  })
}

const migratedProviders = () => {
  const entries = settingsRepository.setSettings.mock.calls.flatMap(([writes]) =>
    writes as Array<[string, string]>,
  )
  const serialized = entries.find(([key]) => key === 'llm.providers')?.[1]
  expect(serialized).toBeDefined()
  return JSON.parse(serialized as string) as Record<string, unknown>
}

describe('useSettingsStore setup notice dismissal', () => {
  beforeEach(() => {
    settingsRepository.setSetting.mockReset().mockResolvedValue(undefined)
    settingsRepository.setSettings.mockReset()
    settingsRepository.updateJsonSetting.mockReset()
    installRepositoryMutationMocks()
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
    document.documentElement.removeAttribute('data-animations')
    document.head.innerHTML = '<meta name="theme-color" content="#ffffff" />'
    settingsRepository.getSetting.mockReset()
    settingsRepository.setSetting.mockReset().mockResolvedValue(undefined)
    settingsRepository.getJsonSetting.mockReset()
    settingsRepository.setJsonSetting.mockReset().mockResolvedValue(undefined)
    settingsRepository.setSettings.mockReset()
    settingsRepository.updateJsonSetting.mockReset()
    installRepositoryMutationMocks()
    useSettingsStore.setState({
      settingsView: 'basic',
      themePreference: 'system',
      loading: false,
      settingsError: null,
    })
  })

  it('defaults a missing Settings view to basic and persists the preference', async () => {
    mockLoadSettingsValues()

    await useSettingsStore.getState().loadSettings()

    expect(useSettingsStore.getState().settingsView).toBe('basic')
    expect(settingsRepository.setSetting).toHaveBeenCalledWith('settings.view', 'basic')
  })

  it('restores and updates the selected Settings view', async () => {
    mockLoadSettingsValues({ 'settings.view': 'advanced' })

    await useSettingsStore.getState().loadSettings()
    expect(useSettingsStore.getState().settingsView).toBe('advanced')

    settingsRepository.setSetting.mockClear()
    await useSettingsStore.getState().updateSettingsView('basic')

    expect(settingsRepository.setSetting).toHaveBeenCalledExactlyOnceWith('settings.view', 'basic')
    expect(useSettingsStore.getState().settingsView).toBe('basic')
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

  it('keeps animations on by default and persists the preference', async () => {
    mockLoadSettingsValues()

    await useSettingsStore.getState().loadSettings()

    expect(useSettingsStore.getState().animations).toBe(true)
    expect(settingsRepository.setSetting).toHaveBeenCalledWith('appearance.animations', 'true')
    expect(document.documentElement).not.toHaveAttribute('data-animations')
  })

  it('restores animations turned off, so the page stops moving after a reload', async () => {
    mockLoadSettingsValues({ 'appearance.animations': 'false' })

    await useSettingsStore.getState().loadSettings()

    expect(useSettingsStore.getState().animations).toBe(false)
    expect(document.documentElement).toHaveAttribute('data-animations', 'off')
    // The mirror lets index.html turn them off before the first paint.
    expect(window.localStorage.getItem(ANIMATIONS_STORAGE_KEY)).toBe('false')
  })

  it('persists turning animations off and on again', async () => {
    await useSettingsStore.getState().updateAnimations(false)

    expect(settingsRepository.setSetting).toHaveBeenCalledExactlyOnceWith('appearance.animations', 'false')
    expect(document.documentElement).toHaveAttribute('data-animations', 'off')
    expect(window.localStorage.getItem(ANIMATIONS_STORAGE_KEY)).toBe('false')

    await useSettingsStore.getState().updateAnimations(true)

    expect(useSettingsStore.getState().animations).toBe(true)
    expect(document.documentElement).not.toHaveAttribute('data-animations')
    expect(window.localStorage.getItem(ANIMATIONS_STORAGE_KEY)).toBe('true')
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
    expect(migratedProviders()).toMatchObject({
      gemini: expect.objectContaining({
        model: DEFAULT_LLM_PROVIDER_SETTINGS.gemini.model,
        modelSource: 'default',
      }),
    })
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
    expect(migratedProviders()).toMatchObject({
      anthropic: expect.objectContaining({
        model: 'claude-custom-model',
        modelSource: 'custom',
      }),
    })
  })

  it('marks explicit native model edits as custom', async () => {
    settingsRepository.getJsonSetting.mockResolvedValue({
      gemini: {
        model: DEFAULT_LLM_PROVIDER_SETTINGS.gemini.model,
        modelSource: 'default',
      },
    })
    useSettingsStore.setState({ providerSettings: DEFAULT_LLM_PROVIDER_SETTINGS })

    await useSettingsStore.getState().saveProviderSettings('gemini', (current) => ({
      ...current,
      gemini: { ...current.gemini, model: 'gemini-custom-model' },
    }))

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

  it('keeps queued provider field edits together while a durable save is pending', async () => {
    const endpoint = 'https://local.example/v1'
    const currentSettings = {
      ...DEFAULT_LLM_PROVIDER_SETTINGS,
      openai: { ...DEFAULT_LLM_PROVIDER_SETTINGS.openai, model: 'openai-custom-model' },
    }
    let storedProviders: Record<string, unknown> = {
      openai: {
        model: 'openai-custom-model',
        modelSource: 'custom',
        reasoning: { effort: 'medium' },
        accountTag: 'keep-openai-metadata',
      },
      'openai-compatible': {
        model: '',
        baseUrl: '',
        endpointTag: 'keep-compatible-metadata',
      },
    }
    let beginFirstWrite!: () => void
    let releaseFirstWrite!: () => void
    const firstWriteStarted = new Promise<void>((resolve) => { beginFirstWrite = resolve })
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve })
    let writeCount = 0
    settingsRepository.updateJsonSetting.mockImplementation(async (_key, update) => {
      const next = update(storedProviders) as Record<string, unknown>
      writeCount += 1
      if (writeCount === 1) {
        beginFirstWrite()
        await firstWriteGate
      }
      storedProviders = next
      return next
    })
    useSettingsStore.setState({ providerSettings: currentSettings })

    const firstSave = useSettingsStore.getState().saveProviderSettings(
      'openai-compatible',
      (current) => ({
        ...current,
        'openai-compatible': { ...current['openai-compatible'], baseUrl: endpoint },
      }),
    )
    await firstWriteStarted
    const secondSave = useSettingsStore.getState().saveProviderSettings(
      'openai-compatible',
      (current) => ({
        ...current,
        'openai-compatible': { ...current['openai-compatible'], model: 'qa-intermediate-model' },
      }),
    )
    const thirdSave = useSettingsStore.getState().saveProviderSettings(
      'openai-compatible',
      (current) => ({
        ...current,
        'openai-compatible': { ...current['openai-compatible'], model: 'qa-model' },
      }),
    )
    releaseFirstWrite()
    await Promise.all([firstSave, secondSave, thirdSave])

    expect(storedProviders['openai-compatible']).toMatchObject({ model: 'qa-model', baseUrl: endpoint })
    expect(storedProviders.openai).toMatchObject({
      model: 'openai-custom-model',
      modelSource: 'custom',
      accountTag: 'keep-openai-metadata',
    })
    expect(storedProviders['openai-compatible']).toMatchObject({ endpointTag: 'keep-compatible-metadata' })
  })
})

describe('useSettingsStore legacy geminiApiKey', () => {
  beforeEach(() => {
    installMatchMedia(false)
    settingsRepository.getSetting.mockReset()
    settingsRepository.setSetting.mockReset().mockResolvedValue(undefined)
    settingsRepository.getJsonSetting.mockReset()
    settingsRepository.setJsonSetting.mockReset().mockResolvedValue(undefined)
    settingsRepository.setSettings.mockReset()
    settingsRepository.updateJsonSetting.mockReset()
    installRepositoryMutationMocks()
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
