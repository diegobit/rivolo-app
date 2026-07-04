import { getJsonSetting, setJsonSetting } from './settingsRepository'

export type DropboxState = {
  connected: boolean
  filePath: string | null
  lastRemoteRev: string | null
  lastPushedHash: string | null
  lastSyncAt: number | null
  localDirty: boolean
  localRevision: number
  accountId: string | null
  accountEmail: string | null
  accountName: string | null
}

const DEFAULT_STATE: DropboxState = {
  connected: false,
  filePath: null,
  lastRemoteRev: null,
  lastPushedHash: null,
  lastSyncAt: null,
  localDirty: false,
  localRevision: 0,
  accountId: null,
  accountEmail: null,
  accountName: null,
}

let writeQueue: Promise<void> = Promise.resolve()

// Legacy state kept the refresh token in `auth`. That token now lives only in
// an HttpOnly cookie, so strip any leftover copy from client storage; users
// with a legacy token simply reconnect once.
const readDropboxState = async () => {
  const stored = await getJsonSetting<DropboxState & { auth?: unknown }>('dropbox.state')
  const merged = { ...DEFAULT_STATE, ...stored }
  if ('auth' in merged) {
    delete (merged as { auth?: unknown }).auth
  }
  return merged as DropboxState
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

export const updateDropboxFilePath = async (filePath: string) => {
  return enqueueDropboxStateWrite((current) => {
    const pathChanged = current.filePath !== filePath
    const next = {
      ...current,
      filePath,
      lastRemoteRev: pathChanged ? null : current.lastRemoteRev,
      lastPushedHash: pathChanged ? null : current.lastPushedHash,
      lastSyncAt: pathChanged ? null : current.lastSyncAt,
    }

    return { next, result: next }
  })
}

export const markDropboxLocalDirty = async () => {
  await enqueueDropboxStateWrite((current) => {
    const next = {
      ...current,
      localDirty: true,
      localRevision: current.localRevision + 1,
    }

    return { next, result: next }
  })
}

export const finalizeDropboxPushState = async (
  remoteRev: string,
  sourceRevision: number,
  pushedHash?: string | null,
) => {
  await enqueueDropboxStateWrite((current) => {
    const next = {
      ...current,
      lastRemoteRev: remoteRev,
      lastPushedHash: pushedHash === undefined ? current.lastPushedHash : pushedHash,
      lastSyncAt: Date.now(),
      localDirty: current.localRevision === sourceRevision ? false : current.localDirty,
    }

    return { next, result: next }
  })
}
