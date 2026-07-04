import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from './useSettingsStore'

const settingsRepository = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getJsonSetting: vi.fn(),
  setJsonSetting: vi.fn(),
}))

vi.mock('../lib/settingsRepository', () => settingsRepository)

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
