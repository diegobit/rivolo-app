import { hashSyncContent } from '../../src/lib/syncHash'
const DROPBOX_API = 'https://api.dropboxapi.com/2'
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3'
const GOOGLE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const GRAPH_API = 'https://graph.microsoft.com/v1.0'
const ONEDRIVE_ITEM_ADDRESS = /^\/drives\/[A-Za-z0-9!_%.-]+\/items\/[A-Za-z0-9!_%.-]+$/

type OneDriveUser = {
  id?: string
  displayName?: string
  mail?: string | null
  userPrincipalName?: string
}

type OneDriveItem = {
  id?: string
  name?: string
  folder?: object
  parentReference?: { driveId?: string }
}

type DropboxAccount = {
  account_id?: string
  email?: string
  name?: {
    display_name?: string
  }
}

type DropboxMetadata = {
  id?: string
  '.tag'?: string
  path_display?: string
  is_downloadable?: boolean
}

type GoogleDriveUser = {
  permissionId?: string
  displayName?: string
  emailAddress?: string
}

type GoogleDriveFile = {
  id?: string
  name?: string
  mimeType?: string
  trashed?: boolean
  parents?: string[]
  appProperties?: Record<string, string>
  capabilities?: {
    canDownload?: boolean
    canEdit?: boolean
    canModifyContent?: boolean
  }
}

const GOOGLE_FILE_FIELDS =
  'id,name,mimeType,trashed,parents,capabilities(canDownload,canEdit,canModifyContent)'

export class ProviderAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderAccessError'
  }
}

const providerResponse = async (
  response: Response,
  provider: 'Dropbox' | 'Google Drive' | 'OneDrive',
) => {
  if (response.status === 401 || response.status === 403) {
    throw new ProviderAccessError(
      401,
      'AUTH_RECONNECT',
      `${provider} access expired. Connect again.`,
    )
  }
  if (!response.ok) {
    throw new ProviderAccessError(
      502,
      'PROVIDER_REQUEST_FAILED',
      `${provider} could not verify Agent access.`,
    )
  }
  return response
}

export const fetchDropboxAccount = async (accessToken: string) => {
  const response = await fetch(`${DROPBOX_API}/users/get_current_account`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  await providerResponse(response, 'Dropbox')
  const account = (await response.json()) as DropboxAccount
  if (!account.account_id) {
    throw new ProviderAccessError(
      502,
      'PROVIDER_IDENTITY_MISSING',
      'Dropbox account identity could not be verified.',
    )
  }
  return {
    accountId: account.account_id,
    email: account.email ?? null,
    name: account.name?.display_name ?? null,
  }
}

export const fetchDropboxTarget = async (accessToken: string, path: string) => {
  const response = await fetch(`${DROPBOX_API}/files/get_metadata`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  })
  if (response.status === 409) {
    throw new ProviderAccessError(
      409,
      'TARGET_UNAVAILABLE',
      'The configured Dropbox file was not found.',
    )
  }
  await providerResponse(response, 'Dropbox')
  const metadata = (await response.json()) as DropboxMetadata
  if (
    metadata['.tag'] !== 'file' ||
    !metadata.path_display ||
    metadata.is_downloadable === false
  ) {
    throw new ProviderAccessError(
      409,
      'TARGET_UNAVAILABLE',
      'The configured Dropbox target is not a downloadable file.',
    )
  }
  return { path: metadata.path_display }
}

export const fetchGoogleDriveAccount = async (accessToken: string) => {
  const response = await fetch(
    `${GOOGLE_DRIVE_API}/about?fields=${encodeURIComponent(
      'user(permissionId,displayName,emailAddress)',
    )}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  await providerResponse(response, 'Google Drive')
  const payload = (await response.json()) as { user?: GoogleDriveUser }
  if (!payload.user?.permissionId) {
    throw new ProviderAccessError(
      502,
      'PROVIDER_IDENTITY_MISSING',
      'Google account identity could not be verified.',
    )
  }
  return {
    accountId: payload.user.permissionId,
    email: payload.user.emailAddress ?? null,
    name: payload.user.displayName ?? null,
  }
}

export const fetchGoogleDriveTarget = async (
  accessToken: string,
  fileId: string,
) => {
  const response = await fetch(
    `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(
      fileId,
    )}?fields=${encodeURIComponent(GOOGLE_FILE_FIELDS)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (response.status === 404) {
    throw new ProviderAccessError(
      409,
      'TARGET_UNAVAILABLE',
      'The configured Google Drive file was not found.',
    )
  }
  await providerResponse(response, 'Google Drive')
  const file = (await response.json()) as GoogleDriveFile
  const unsupportedGoogleType =
    file.mimeType === GOOGLE_FOLDER_MIME_TYPE ||
    file.mimeType?.startsWith('application/vnd.google-apps.')
  if (
    !file.id ||
    !file.name ||
    file.trashed ||
    unsupportedGoogleType ||
    file.capabilities?.canDownload === false ||
    file.capabilities?.canEdit === false ||
    file.capabilities?.canModifyContent === false
  ) {
    throw new ProviderAccessError(
      409,
      'TARGET_UNAVAILABLE',
      'The configured Google Drive target is not a writable, downloadable file.',
    )
  }
  return {
    fileId: file.id,
    folderId: file.parents?.[0] ?? null,
    fileName: file.name,
  }
}

export const verifyDropboxDailyTarget = async (accessToken: string, folder: string, sourcePath: string) => {
  const expected = sourcePath.replace(/\.md$/i, '.rivolo-daily')
  if (expected === sourcePath) throw new ProviderAccessError(409, 'TARGET_UNAVAILABLE', 'Choose the original Dropbox Markdown path.')
  const load = async (path: string) => {
    const response = await fetch(`${DROPBOX_API}/files/get_metadata`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    return response.ok ? await response.json() as DropboxMetadata & { path_lower?: string } : null
  }
  const root = await load(folder)
  if (root?.id !== folder || root['.tag'] !== 'folder' || root.path_lower !== expected.toLowerCase() ||
      (await load(`${expected}/.rivolo-migrated`))?.['.tag'] !== 'file') {
    throw new ProviderAccessError(409, 'TARGET_UNAVAILABLE', 'The Dropbox daily folder is not ready for Agent access.')
  }
  return { path: sourcePath }
}

export const verifyGoogleDailyTarget = async (accessToken: string, folder: string,
  source?: { fileId: string; folderId: string | null; fileName: string }) => {
  const fields = 'id,name,mimeType,parents,trashed,appProperties,capabilities(canEdit)'
  const response = await fetch(`${GOOGLE_DRIVE_API}/files/${encodeURIComponent(folder)}?fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } })
  const item = response.ok ? await response.json() as GoogleDriveFile : null
  if (!item || item.id !== folder || !item.name || item.trashed || item.mimeType !== GOOGLE_FOLDER_MIME_TYPE ||
      item.capabilities?.canEdit === false || !item.appProperties?.rivoloDailySource || item.appProperties.rivoloMigrated !== 'true' ||
      source && (!source.folderId || !item.parents?.includes(source.folderId) ||
        item.appProperties.rivoloDailySource !== await hashSyncContent(source.fileName))) {
    throw new ProviderAccessError(409, 'TARGET_UNAVAILABLE', 'The Google Drive daily folder is not ready for Agent access.')
  }
  return source ?? { fileId: folder, folderId: item.parents?.[0] ?? null, fileName: item.name }
}

export const fetchOneDriveAccount = async (accessToken: string) => {
  const response = await fetch(
    `${GRAPH_API}/me?$select=id,displayName,mail,userPrincipalName`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  await providerResponse(response, 'OneDrive')
  const user = (await response.json()) as OneDriveUser
  if (!user.id) {
    throw new ProviderAccessError(
      502,
      'PROVIDER_IDENTITY_MISSING',
      'Microsoft account identity could not be verified.',
    )
  }
  const email = user.mail ?? user.userPrincipalName ?? null
  return {
    accountId: user.id,
    // Personal accounts can report a non-address principal name.
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    name: user.displayName ?? null,
  }
}

// The app sends its notebook folder as a canonical Graph address. Agent access
// is bound to that exact folder, so a shortcut or another address for the same
// folder is refused rather than resolved.
export const verifyOneDriveDailyTarget = async (accessToken: string, folder: string) => {
  if (!ONEDRIVE_ITEM_ADDRESS.test(folder) || folder.length >= 1024) {
    throw new ProviderAccessError(400, 'INVALID_REQUEST', 'A OneDrive notebook folder is required.')
  }
  const response = await fetch(
    `${GRAPH_API}${folder}?$select=id,name,folder,parentReference`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (response.status === 404) {
    throw new ProviderAccessError(409, 'TARGET_UNAVAILABLE', 'The OneDrive notebook folder was not found.')
  }
  await providerResponse(response, 'OneDrive')
  const item = (await response.json()) as OneDriveItem
  const canonical = item.id && item.parentReference?.driveId
    ? `/drives/${encodeURIComponent(item.parentReference.driveId)}/items/${encodeURIComponent(item.id)}`
    : null
  if (!item.folder || !item.name || canonical !== folder) {
    throw new ProviderAccessError(409, 'TARGET_UNAVAILABLE', 'The OneDrive notebook target is not a folder.')
  }
  return { folder, folderName: item.name }
}
