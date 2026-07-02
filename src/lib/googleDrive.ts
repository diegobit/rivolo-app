import { exportMarkdownFromDb, importMarkdownToDb } from './importExport'
import { authorizedGoogleDriveFetch, disconnectGoogleDriveAuth } from './googleDriveAuth'
import {
  DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
  DEFAULT_GOOGLE_DRIVE_FILE_NAME,
  finalizeGoogleDrivePushState,
  getGoogleDriveState,
  getGoogleDrivePath,
  updateGoogleDriveState,
} from './googleDriveState'
import { markSyncLocalDirty } from './syncDirty'
import type { SyncProvider, SyncPullOptions, SyncStatus } from './sync'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const RIVOLO_FILE_PROPERTY = "appProperties has { key='rivoloSync' and value='primary' }"
const RIVOLO_FOLDER_PROPERTY = "appProperties has { key='rivoloSync' and value='folder' }"

type DriveFile = {
  id: string
  name: string
  mimeType: string
  version: string
  etag?: string
  modifiedTime?: string
  trashed?: boolean
  parents?: string[]
  capabilities?: {
    canDownload?: boolean
    canEdit?: boolean
    canModifyContent?: boolean
  }
}

type DriveError = {
  error?: { message?: string }
}

const FILE_FIELDS = 'id,name,mimeType,version,modifiedTime,trashed,parents,capabilities(canDownload,canEdit,canModifyContent)'

class DrivePreconditionFailedError extends Error {
  constructor() {
    super('Google Drive file changed before upload.')
  }
}

const driveError = async (response: Response, fallback: string) => {
  const payload = (await response.json().catch(() => null)) as DriveError | null
  return new Error(payload?.error?.message || fallback)
}

const withDriveEtag = (file: DriveFile, response: Response) => {
  const etag = response.headers.get('ETag')
  return etag ? { ...file, etag } : file
}

const getDrivePreconditionHeaders = (file: DriveFile, force: boolean): Record<string, string> | undefined => {
  if (force || !file.etag) return undefined
  return { 'If-Match': file.etag }
}

const validateDriveFile = (file: DriveFile) => {
  if (file.trashed) throw new Error('Google Drive file is in the trash.')
  if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    throw new Error('Google Drive sync target cannot be a folder.')
  }
  if (file.mimeType.startsWith('application/vnd.google-apps.')) {
    throw new Error('Google Drive sync requires a normal Markdown file, not a Google document.')
  }
  if (file.capabilities?.canDownload === false) throw new Error('Google Drive file cannot be downloaded.')
  if (file.capabilities?.canEdit === false || file.capabilities?.canModifyContent === false) {
    throw new Error('Google Drive file cannot be edited.')
  }
  return file
}

// Without an ETag there is no server-enforced precondition, so re-check the
// remote version just before mutating. This narrows the race window to the
// re-check→upload gap but cannot close it.
const guardDriveFileForMutation = async (file: DriveFile, force: boolean) => {
  if (force || file.etag) return file
  const current = await fetchDriveFile(file.id)
  if (!current || current.version !== file.version) {
    throw new DrivePreconditionFailedError()
  }
  return current
}

const parseDriveMutationResponse = async (response: Response, fallback: string) => {
  if (response.status === 412) throw new DrivePreconditionFailedError()
  if (!response.ok) throw await driveError(response, fallback)
  return validateDriveFile(withDriveEtag((await response.json()) as DriveFile, response))
}

const fetchDriveFile = async (fileId: string) => {
  const response = await authorizedGoogleDriveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(FILE_FIELDS)}`,
  )
  if (response.status === 404) return null
  if (!response.ok) throw await driveError(response, 'Failed to fetch Google Drive metadata.')
  return validateDriveFile(withDriveEtag((await response.json()) as DriveFile, response))
}

const escapeDriveQueryValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

const discoverDriveFolder = async () => {
  const params = new URLSearchParams({
    q: `${RIVOLO_FOLDER_PROPERTY} and name='${escapeDriveQueryValue(DEFAULT_GOOGLE_DRIVE_FOLDER_NAME)}' and mimeType='${DRIVE_FOLDER_MIME_TYPE}' and trashed=false`,
    spaces: 'drive',
    orderBy: 'modifiedTime desc',
    pageSize: '10',
    fields: `files(${FILE_FIELDS})`,
  })
  const response = await authorizedGoogleDriveFetch(`${DRIVE_API}/files?${params}`)
  if (!response.ok) throw await driveError(response, 'Failed to find the Rivolo folder in Google Drive.')
  const payload = (await response.json()) as { files?: DriveFile[] }
  return payload.files?.[0] ?? null
}

const createDriveFolder = async () => {
  const params = new URLSearchParams({ fields: FILE_FIELDS })
  const response = await authorizedGoogleDriveFetch(`${DRIVE_API}/files?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      name: DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      appProperties: { rivoloSync: 'folder' },
    }),
  })
  if (!response.ok) throw await driveError(response, 'Failed to create the Rivolo folder in Google Drive.')
  return (await response.json()) as DriveFile
}

const ensureDriveFolder = async () => (await discoverDriveFolder()) ?? createDriveFolder()

const discoverDriveFile = async (fileName: string, folderId: string) => {
  const params = new URLSearchParams({
    q: `${RIVOLO_FILE_PROPERTY} and name='${escapeDriveQueryValue(fileName)}' and '${escapeDriveQueryValue(folderId)}' in parents and trashed=false`,
    spaces: 'drive',
    orderBy: 'modifiedTime desc',
    pageSize: '10',
    fields: `files(${FILE_FIELDS})`,
  })
  const response = await authorizedGoogleDriveFetch(`${DRIVE_API}/files?${params}`)
  if (!response.ok) throw await driveError(response, 'Failed to find the Rivolo file in Google Drive.')
  const payload = (await response.json()) as { files?: DriveFile[] }
  const file = payload.files?.[0]
  return file ? fetchDriveFile(file.id) : null
}

const resolveDriveFile = async (fileId: string | null, fileName: string, folderId: string) => {
  if (fileId) {
    const file = await fetchDriveFile(fileId)
    if (file) return file
  }
  return discoverDriveFile(fileName, folderId)
}

const downloadDriveFile = async (fileId: string) => {
  const response = await authorizedGoogleDriveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
  )
  if (!response.ok) throw await driveError(response, 'Failed to download the Google Drive file.')
  return response.text()
}

const createDriveFile = async (fileName: string, folderId: string, content: string) => {
  const boundary = `rivolo_${crypto.randomUUID()}`
  const metadata = JSON.stringify({
    name: fileName,
    mimeType: 'text/markdown',
    parents: [folderId],
    appProperties: { rivoloSync: 'primary' },
  })
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: text/markdown; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n')
  const params = new URLSearchParams({ uploadType: 'multipart', fields: FILE_FIELDS })
  const response = await authorizedGoogleDriveFetch(`${DRIVE_UPLOAD_API}/files?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  if (!response.ok) throw await driveError(response, 'Failed to create the Google Drive file.')
  return validateDriveFile(withDriveEtag((await response.json()) as DriveFile, response))
}

const moveDriveFile = async (file: DriveFile, folderId: string, force = false) => {
  if (file.parents?.includes(folderId)) return file
  const params = new URLSearchParams({ addParents: folderId, fields: FILE_FIELDS })
  if (file.parents?.length) params.set('removeParents', file.parents.join(','))
  const response = await authorizedGoogleDriveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(file.id)}?${params}`,
    { method: 'PATCH', headers: getDrivePreconditionHeaders(file, force) },
  )
  return parseDriveMutationResponse(response, 'Failed to move the Google Drive file into the Rivolo folder.')
}

const updateDriveFile = async (file: DriveFile, content: string, force = false) => {
  const params = new URLSearchParams({ uploadType: 'media', fields: FILE_FIELDS })
  const response = await authorizedGoogleDriveFetch(
    `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(file.id)}?${params}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'text/markdown; charset=UTF-8',
        ...getDrivePreconditionHeaders(file, force),
      },
      body: content,
    },
  )
  return parseDriveMutationResponse(response, 'Failed to upload the Google Drive file.')
}

export const disconnectGoogleDrive = async () => {
  await disconnectGoogleDriveAuth()
  await updateGoogleDriveState({
    connected: false,
    fileId: null,
    lastRemoteVersion: null,
    lastSyncAt: null,
    accountId: null,
    accountEmail: null,
    accountName: null,
  })
}

export const getGoogleDriveStatus = async (): Promise<SyncStatus> => {
  const state = await getGoogleDriveState()
  return {
    connected: state.connected,
    targetName: getGoogleDrivePath(state.fileName),
    lastRemoteVersion: state.lastRemoteVersion,
    lastSyncAt: state.lastSyncAt,
    localDirty: state.localDirty,
    accountName: state.accountName,
    accountEmail: state.accountEmail,
  }
}

export const pullFromGoogleDrive = async (options: SyncPullOptions = {}) => {
  const state = await getGoogleDriveState()
  const force = options.force ?? false
  if (!state.connected) throw new Error('Google Drive not connected.')
  if (state.localDirty && !force) {
    return { status: 'noop' as const }
  }
  const folder = await ensureDriveFolder()
  const metadata = await resolveDriveFile(state.fileId, state.fileName, folder.id)
  if (!metadata) throw new Error('Google Drive file not found. Push to create it first.')

  if (metadata.version === state.lastRemoteVersion && !(force && state.localDirty)) {
    return { status: 'noop' as const }
  }

  const content = await downloadDriveFile(metadata.id)
  const result = await importMarkdownToDb(content, {
    replace: true,
    markDirty: false,
    allowDestructiveReplace: options.allowDestructiveReplace,
  })
  const hasNoMarkersWarning =
    result.imported === 0 &&
    result.warnings.some((warning) => warning.toLowerCase().includes('no day markers'))
  if (hasNoMarkersWarning) {
    throw new Error('Google Drive file has no day markers. Import aborted to avoid data loss.')
  }

  await markSyncLocalDirty()
  await updateGoogleDriveState({
    fileId: metadata.id,
    fileName: metadata.name,
    lastRemoteVersion: metadata.version,
    lastSyncAt: Date.now(),
    localDirty: false,
  })
  return { status: 'pulled' as const }
}

export const pushToGoogleDrive = async (force = false) => {
  const state = await getGoogleDriveState()
  if (!state.connected) throw new Error('Google Drive not connected.')
  if (!state.localDirty && !force && !state.lastRemoteVersion) {
    return { status: 'clean' as const }
  }

  const folder = await ensureDriveFolder()
  const metadata = await resolveDriveFile(state.fileId, state.fileName, folder.id)
  if (!force && state.lastRemoteVersion && (!metadata || metadata.version !== state.lastRemoteVersion)) {
    return {
      status: 'blocked' as const,
      reason: metadata ? ('remote_changed' as const) : ('remote_missing' as const),
    }
  }
  if (!force && !state.lastRemoteVersion && metadata && state.localDirty) {
    await updateGoogleDriveState({ fileId: metadata.id, fileName: metadata.name })
    return { status: 'blocked' as const, reason: 'remote_changed' as const }
  }
  if (!state.localDirty && !force) {
    if (metadata && !metadata.parents?.includes(folder.id)) {
      try {
        const moved = await moveDriveFile(await guardDriveFileForMutation(metadata, false), folder.id)
        await finalizeGoogleDrivePushState(moved.id, moved.version, state.localRevision)
        return { status: 'pushed' as const }
      } catch (error) {
        if (error instanceof DrivePreconditionFailedError) {
          return { status: 'blocked' as const, reason: 'remote_changed' as const }
        }
        throw error
      }
    }
    return { status: 'clean' as const }
  }

  const content = await exportMarkdownFromDb()
  let uploaded: DriveFile
  try {
    uploaded = metadata
      ? await updateDriveFile(
          await moveDriveFile(await guardDriveFileForMutation(metadata, force), folder.id, force),
          content,
          force,
        )
      : await createDriveFile(state.fileName || DEFAULT_GOOGLE_DRIVE_FILE_NAME, folder.id, content)
  } catch (error) {
    if (error instanceof DrivePreconditionFailedError) {
      return { status: 'blocked' as const, reason: 'remote_changed' as const }
    }
    throw error
  }
  await finalizeGoogleDrivePushState(uploaded.id, uploaded.version, state.localRevision)
  return { status: 'pushed' as const }
}

export const googleDriveProvider = {
  id: 'google-drive',
  getStatus: getGoogleDriveStatus,
  pull: pullFromGoogleDrive,
  push: pushToGoogleDrive,
  disconnect: disconnectGoogleDrive,
} satisfies SyncProvider
