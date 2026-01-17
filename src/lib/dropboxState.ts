import { getJsonSetting, setJsonSetting } from './settingsRepository'

type DropboxAuth = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type DropboxState = {
  auth: DropboxAuth | null
  filePath: string | null
  lastRemoteRev: string | null
  lastSyncAt: number | null
  localDirty: boolean
  accountId: string | null
  accountEmail: string | null
  accountName: string | null
}

const DEFAULT_STATE: DropboxState = {
  auth: null,
  filePath: null,
  lastRemoteRev: null,
  lastSyncAt: null,
  localDirty: false,
  accountId: null,
  accountEmail: null,
  accountName: null,
}

export const getDropboxState = async () => {
  const stored = await getJsonSetting<DropboxState>('dropbox.state')
  return { ...DEFAULT_STATE, ...stored }
}

export const updateDropboxState = async (updates: Partial<DropboxState>) => {
  const current = await getDropboxState()
  const next = { ...current, ...updates }
  await setJsonSetting('dropbox.state', next)
  return next
}

export const markLocalDirty = async () => {
  await updateDropboxState({ localDirty: true })
}
