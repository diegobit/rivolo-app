import { getJsonSetting, setJsonSetting } from './settingsRepository'

export type SyncProviderId = 'dropbox'

type SyncState = {
  activeProvider: SyncProviderId | null
}

const DEFAULT_STATE: SyncState = {
  activeProvider: null,
}

export const getSyncState = async () => {
  const stored = await getJsonSetting<SyncState>('sync.state')
  return { ...DEFAULT_STATE, ...stored }
}

export const updateSyncState = async (updates: Partial<SyncState>) => {
  const current = await getSyncState()
  const next = { ...current, ...updates }
  await setJsonSetting('sync.state', next)
  return next
}
