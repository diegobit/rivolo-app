const DROPBOX_API = 'https://api.dropboxapi.com/2'
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3'
const GOOGLE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'

type DropboxAccount = {
  account_id?: string
  email?: string
  name?: {
    display_name?: string
  }
}

type DropboxMetadata = {
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
  provider: 'Dropbox' | 'Google Drive',
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
