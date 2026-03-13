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
  localRevision: number
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
  localRevision: 0,
  accountId: null,
  accountEmail: null,
  accountName: null,
}

let writeQueue: Promise<void> = Promise.resolve()

const readDropboxState = async () => {
  const stored = await getJsonSetting<DropboxState>('dropbox.state')
  return { ...DEFAULT_STATE, ...stored }
}

const enqueueDropboxStateWrite = async <T>(
  mutator: (current: DropboxState) => { next: DropboxState; result: T },
) => {
  const run = async () => {
    const current = await readDropboxState()
    const { next, result } = mutator(current)
    await setJsonSetting('dropbox.state', next)
    return result
  }

  const queuedRun = writeQueue.then(run, run)
  writeQueue = queuedRun.then(
    () => undefined,
    () => undefined,
  )
  return queuedRun
}

export const getDropboxState = async () => {
  await writeQueue
  return readDropboxState()
}

export const updateDropboxState = async (updates: Partial<DropboxState>) => {
  return enqueueDropboxStateWrite((current) => {
    const next = { ...current, ...updates }
    return { next, result: next }
  })
}

export const markLocalDirty = async () => {
  await enqueueDropboxStateWrite((current) => {
    const next = {
      ...current,
      localDirty: true,
      localRevision: current.localRevision + 1,
    }

    return { next, result: next }
  })
}

export const finalizeDropboxPushState = async (remoteRev: string, sourceRevision: number) => {
  await enqueueDropboxStateWrite((current) => {
    const next = {
      ...current,
      lastRemoteRev: remoteRev,
      lastSyncAt: Date.now(),
      localDirty: current.localRevision === sourceRevision ? false : current.localDirty,
    }

    return { next, result: next }
  })
}
