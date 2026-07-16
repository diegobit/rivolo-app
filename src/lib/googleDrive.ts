import { exportMarkdownFromDb, importMarkdownToDb, saveRollbackBackup } from './importExport'
import { authorizedGoogleDriveFetch, disconnectGoogleDriveAuth } from './googleDriveAuth'
import {
  DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
  DEFAULT_GOOGLE_DRIVE_FILE_NAME,
  finalizeGoogleDrivePushState,
  getGoogleDriveState,
  getGoogleDrivePath,
  updateGoogleDriveState,
} from './googleDriveState'
import type { GoogleDriveState } from './googleDriveState'
import { markSyncLocalDirty } from './syncDirty'
import { hashSyncContent } from './syncHash'
import type { SyncProvider, SyncPullOptions, SyncRemoteCheck, SyncStatus } from './sync'

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
  headRevisionId?: string
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

const FILE_FIELDS = 'id,name,mimeType,version,headRevisionId,modifiedTime,trashed,parents,capabilities(canDownload,canEdit,canModifyContent)'

const driveError = async (response: Response, fallback: string) => {
  const payload = (await response.json().catch(() => null)) as DriveError | null
  return new Error(payload?.error?.message || fallback)
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

const parseDriveMutationResponse = async (response: Response, fallback: string) => {
  if (!response.ok) throw await driveError(response, fallback)
  return validateDriveFile((await response.json()) as DriveFile)
}

const fetchDriveFile = async (fileId: string) => {
  const response = await authorizedGoogleDriveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(FILE_FIELDS)}`,
  )
  if (response.status === 404) return null
  if (!response.ok) throw await driveError(response, 'Failed to fetch Google Drive metadata.')
  return validateDriveFile((await response.json()) as DriveFile)
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

// Resolve the Rivolo folder id, reusing the cached id when we have one so the
// common push/pull path never spends a round trip rediscovering it.
const resolveFolderId = async (state: GoogleDriveState) => {
  if (state.folderId) return state.folderId
  const folder = (await discoverDriveFolder()) ?? (await createDriveFolder())
  await updateGoogleDriveState({ folderId: folder.id })
  return folder.id
}

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
  return file ? validateDriveFile(file) : null
}

// Resolve the sync target. When we already know the file id we fetch it
// directly and never touch the folder — that is the steady-state hot path.
// Only when the file must be discovered by name (or created) do we pay for
// folder resolution, and we report the folder id so callers can reuse it.
const resolveDriveTarget = async (state: GoogleDriveState) => {
  if (state.fileId) {
    const file = await fetchDriveFile(state.fileId)
    if (file) return { metadata: file, folderId: state.folderId }
  }
  const folderId = await resolveFolderId(state)
  const metadata = await discoverDriveFile(state.fileName, folderId)
  return { metadata, folderId }
}

// Ensure the file lives inside the Rivolo folder, moving it only when it is
// not already there. When the folder id is cached this membership check costs
// no round trip; a move happens only for files a user relocated in Drive.
const ensureInRivoloFolder = async (
  file: DriveFile,
  state: GoogleDriveState,
  knownFolderId: string | null,
) => {
  const folderId = knownFolderId ?? (await resolveFolderId(state))
  if (file.parents?.includes(folderId)) return { file, moved: false }
  const moved = await moveDriveFile(file, folderId)
  return { file: moved, moved: true }
}

const downloadDriveFile = async (fileId: string) => {
  const response = await authorizedGoogleDriveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
  )
  if (!response.ok) throw await driveError(response, 'Failed to download the Google Drive file.')
  return response.text()
}

type DriveRevision = { id: string; modifiedTime?: string }

const findConcurrentDriveRevision = async (
  fileId: string,
  previousHeadRevisionId: string | undefined,
  nextHeadRevisionId: string | undefined,
) => {
  if (!previousHeadRevisionId || !nextHeadRevisionId) return null

  try {
    const params = new URLSearchParams({ pageSize: '1000', fields: 'revisions(id,modifiedTime)' })
    const response = await authorizedGoogleDriveFetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/revisions?${params}`,
    )
    if (!response.ok) return null
    const payload = (await response.json()) as { revisions?: DriveRevision[]; nextPageToken?: string }
    if (payload.nextPageToken) return null
    const revisions = payload.revisions ?? []
    if (revisions.some((revision) => !revision.modifiedTime)) return null
    const orderedRevisions = [...revisions].sort((left, right) =>
      left.modifiedTime!.localeCompare(right.modifiedTime!),
    )
    const previousIndex = orderedRevisions.findIndex((revision) => revision.id === previousHeadRevisionId)
    const nextIndex = orderedRevisions.findIndex((revision) => revision.id === nextHeadRevisionId)
    if (previousIndex === -1 || nextIndex === -1 || Math.abs(previousIndex - nextIndex) <= 1) {
      return null
    }

    return orderedRevisions[nextIndex + Math.sign(previousIndex - nextIndex)]?.id ?? null
  } catch {
    return null
  }
}

const recoverConcurrentDriveRevision = async (fileId: string, revisionId: string) => {
  try {
    const response = await authorizedGoogleDriveFetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?alt=media`,
    )
    if (!response.ok) return false
    await saveRollbackBackup(await response.text())
    return true
  } catch {
    return false
  }
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
  return validateDriveFile((await response.json()) as DriveFile)
}

const moveDriveFile = async (file: DriveFile, folderId: string) => {
  if (file.parents?.includes(folderId)) return file
  const params = new URLSearchParams({ addParents: folderId, fields: FILE_FIELDS })
  if (file.parents?.length) params.set('removeParents', file.parents.join(','))
  const response = await authorizedGoogleDriveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(file.id)}?${params}`,
    { method: 'PATCH' },
  )
  return parseDriveMutationResponse(response, 'Failed to move the Google Drive file into the Rivolo folder.')
}

const updateDriveFile = async (file: DriveFile, content: string) => {
  const params = new URLSearchParams({ uploadType: 'media', fields: FILE_FIELDS })
  const response = await authorizedGoogleDriveFetch(
    `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(file.id)}?${params}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'text/markdown; charset=UTF-8' },
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
    folderId: null,
    lastRemoteVersion: null,
    lastPushedHash: null,
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

// Content-free check used while local edits are dirty (pull is suppressed then):
// fetch the known file's metadata only (no folder creation, no download) and
// compare its version to the last one we synced.
export const checkGoogleDriveRemote = async (): Promise<SyncRemoteCheck> => {
  const state = await getGoogleDriveState()
  if (!state.connected || !state.lastRemoteVersion || !state.fileId) {
    return { status: 'unknown' as const }
  }
  const metadata = await fetchDriveFile(state.fileId)
  if (!metadata) return { status: 'changed' as const, reason: 'remote_missing' as const }
  return metadata.version === state.lastRemoteVersion
    ? { status: 'unchanged' as const }
    : { status: 'changed' as const, reason: 'remote_changed' as const }
}

export const pullFromGoogleDrive = async (options: SyncPullOptions = {}) => {
  const state = await getGoogleDriveState()
  const force = options.force ?? false
  if (!state.connected) throw new Error('Google Drive not connected.')
  if (state.localDirty && !force) {
    return { status: 'noop' as const }
  }
  const { metadata } = await resolveDriveTarget(state)
  if (!metadata) throw new Error('Google Drive file not found. Push to create it first.')

  if (metadata.version === state.lastRemoteVersion && !(force && state.localDirty)) {
    return { status: 'noop' as const }
  }

  const content = await downloadDriveFile(metadata.id)
  await importMarkdownToDb(content, {
    replace: true,
    markDirty: false,
    allowUnsafeImport: options.allowUnsafeImport,
  })

  await markSyncLocalDirty()
  await updateGoogleDriveState({
    fileId: metadata.id,
    fileName: metadata.name,
    lastRemoteVersion: metadata.version,
    // Remote content now equals local, so record its hash to suppress an
    // immediate redundant push of what we just pulled.
    lastPushedHash: await hashSyncContent(content),
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

  const wantUpload = state.localDirty || force

  const { metadata, folderId } = await resolveDriveTarget(state)
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

  // Not dirty and not forced: the only work left is relocating a file the user
  // moved out of the Rivolo folder in Drive.
  if (!wantUpload) {
    if (metadata) {
      const { file: moved, moved: didMove } = await ensureInRivoloFolder(metadata, state, folderId)
      if (didMove) {
        await finalizeGoogleDrivePushState(moved.id, moved.version, state.localRevision)
        return { status: 'pushed' as const }
      }
    }
    return { status: 'clean' as const }
  }

  // Short-circuit the upload if the exported content is byte-identical to what
  // we last pushed and the remote is still at that version — nothing to send.
  const content = await exportMarkdownFromDb()
  const contentHash = await hashSyncContent(content)
  if (
    !force &&
    metadata &&
    contentHash === state.lastPushedHash &&
    metadata.version === state.lastRemoteVersion
  ) {
    await finalizeGoogleDrivePushState(metadata.id, metadata.version, state.localRevision, contentHash)
    return { status: 'clean' as const }
  }

  let uploaded: DriveFile
  if (metadata) {
    const { file } = await ensureInRivoloFolder(metadata, state, folderId)
    uploaded = await updateDriveFile(file, content)
  } else {
    uploaded = await createDriveFile(
      state.fileName || DEFAULT_GOOGLE_DRIVE_FILE_NAME,
      folderId ?? (await resolveFolderId(state)),
      content,
    )
  }
  const concurrentRevisionId = metadata
    ? await findConcurrentDriveRevision(metadata.id, metadata.headRevisionId, uploaded.headRevisionId)
    : null
  const recoveredConflict = concurrentRevisionId
    ? await recoverConcurrentDriveRevision(uploaded.id, concurrentRevisionId)
    : false
  await finalizeGoogleDrivePushState(uploaded.id, uploaded.version, state.localRevision, contentHash)
  return concurrentRevisionId
    ? {
        status: 'pushed' as const,
        attention: recoveredConflict
          ? 'Google Drive changed while uploading. A local backup of the remote conflict was saved.'
          : 'Google Drive changed while uploading. The conflict could not be backed up automatically.',
      }
    : { status: 'pushed' as const }
}

export const googleDriveProvider = {
  id: 'google-drive',
  getStatus: getGoogleDriveStatus,
  pull: pullFromGoogleDrive,
  push: pushToGoogleDrive,
  checkRemote: checkGoogleDriveRemote,
  disconnect: disconnectGoogleDrive,
} satisfies SyncProvider
