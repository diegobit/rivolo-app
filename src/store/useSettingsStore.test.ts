import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from './useSettingsStore'
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

const mockLoadSettingsValues = (values: Record<string, string | null> = {}) => {
  settingsRepository.getSetting.mockImplementation((key: string) =>
    Promise.resolve(values[key] ?? null),
  )
  settingsRepository.getJsonSetting.mockImplementation(() => Promise.resolve(null))
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
    expect(settingsRepository.setSetting).toHaveBeenCalledWith('appearance.theme', 'system')
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
})
