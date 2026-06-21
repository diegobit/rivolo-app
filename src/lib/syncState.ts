import { getJsonSetting, setJsonSetting } from './settingsRepository'

export const SYNC_PROVIDER_IDS = ['dropbox', 'google-drive'] as const
export type SyncProviderId = (typeof SYNC_PROVIDER_IDS)[number]

export const SYNC_PROVIDER_LABELS: Record<SyncProviderId, string> = {
  dropbox: 'Dropbox',
  'google-drive': 'Google Drive',
}

export const isSyncProviderId = (value: unknown): value is SyncProviderId =>
  typeof value === 'string' && SYNC_PROVIDER_IDS.includes(value as SyncProviderId)

type SyncState = {
  activeProvider: SyncProviderId | null
}

const DEFAULT_STATE: SyncState = {
  activeProvider: null,
}

export const getSyncState = async () => {
  const stored = await getJsonSetting<SyncState>('sync.state')
  return {
    ...DEFAULT_STATE,
    ...stored,
    activeProvider: isSyncProviderId(stored?.activeProvider) ? stored.activeProvider : null,
  }
}

export const updateSyncState = async (updates: Partial<SyncState>) => {
  const current = await getSyncState()
  const next = { ...current, ...updates }
  await setJsonSetting('sync.state', next)
  return next
}
