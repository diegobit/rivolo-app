import { getJsonSetting, setJsonSetting } from './settingsRepository'

export const DEFAULT_GOOGLE_DRIVE_FILE_NAME = 'inbox.md'
export const DEFAULT_GOOGLE_DRIVE_FOLDER_NAME = 'rivolo'
export const getGoogleDrivePath = (fileName: string) =>
  `/${DEFAULT_GOOGLE_DRIVE_FOLDER_NAME}/${fileName || DEFAULT_GOOGLE_DRIVE_FILE_NAME}`

export type GoogleDriveState = {
  connected: boolean
  fileId: string | null
  folderId: string | null
  fileName: string
  lastRemoteVersion: string | null
  lastPushedHash: string | null
  lastSyncAt: number | null
  localDirty: boolean
  localRevision: number
  accountId: string | null
  accountEmail: string | null
  accountName: string | null
}

const DEFAULT_STATE: GoogleDriveState = {
  connected: false,
  fileId: null,
  folderId: null,
  fileName: DEFAULT_GOOGLE_DRIVE_FILE_NAME,
  lastRemoteVersion: null,
  lastPushedHash: null,
  lastSyncAt: null,
  localDirty: false,
  localRevision: 0,
  accountId: null,
  accountEmail: null,
  accountName: null,
}

let writeQueue: Promise<void> = Promise.resolve()

const readGoogleDriveState = async () => {
  const stored = await getJsonSetting<GoogleDriveState>('google-drive.state')
  return { ...DEFAULT_STATE, ...stored }
}

const enqueueGoogleDriveStateWrite = async <T>(
  mutator: (current: GoogleDriveState) => { next: GoogleDriveState; result: T },
) => {
  const run = async () => {
    const current = await readGoogleDriveState()
    const { next, result } = mutator(current)
    await setJsonSetting('google-drive.state', next)
    return result
  }

  const queuedRun = writeQueue.then(run, run)
  writeQueue = queuedRun.then(
    () => undefined,
    () => undefined,
  )
  return queuedRun
}

export const getGoogleDriveState = async () => {
  await writeQueue
  return readGoogleDriveState()
}

export const updateGoogleDriveState = async (updates: Partial<GoogleDriveState>) =>
  enqueueGoogleDriveStateWrite((current) => {
    const next = { ...current, ...updates }
    return { next, result: next }
  })

export const updateGoogleDriveFileName = async (fileName: string) =>
  enqueueGoogleDriveStateWrite((current) => {
    const nextName = fileName.trim() || DEFAULT_GOOGLE_DRIVE_FILE_NAME
    const changed = nextName !== current.fileName
    const next = {
      ...current,
      fileName: nextName,
      fileId: changed ? null : current.fileId,
      lastRemoteVersion: changed ? null : current.lastRemoteVersion,
      lastPushedHash: changed ? null : current.lastPushedHash,
      lastSyncAt: changed ? null : current.lastSyncAt,
      localDirty: changed ? true : current.localDirty,
      localRevision: changed ? current.localRevision + 1 : current.localRevision,
    }
    return { next, result: next }
  })

export const markGoogleDriveLocalDirty = async () => {
  await enqueueGoogleDriveStateWrite((current) => {
    const next = {
      ...current,
      localDirty: true,
      localRevision: current.localRevision + 1,
    }
    return { next, result: next }
  })
}

export const finalizeGoogleDrivePushState = async (
  fileId: string,
  remoteVersion: string,
  sourceRevision: number,
  pushedHash?: string | null,
) => {
  await enqueueGoogleDriveStateWrite((current) => {
    const next = {
      ...current,
      fileId,
      lastRemoteVersion: remoteVersion,
      lastPushedHash: pushedHash === undefined ? current.lastPushedHash : pushedHash,
      lastSyncAt: Date.now(),
      localDirty: current.localRevision === sourceRevision ? false : current.localDirty,
    }
    return { next, result: next }
  })
}
