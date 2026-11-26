import { decryptToken, encryptToken } from './tokenCookie'

export type Provider = 'dropbox' | 'google-drive' | 'onedrive'

export type DropboxTarget = {
  path: string
}

export type GoogleDriveTarget = {
  fileId: string
  folderId: string | null
  fileName: string
}

// OneDrive notebooks are always daily. The folder is its canonical Graph
// address, /drives/{drive}/items/{item}, and is also the profile's daily folder.
export type OneDriveTarget = {
  folder: string
  folderName: string
}

type ProviderProfileInputBase = {
  providerAccountId: string
  providerEmail?: string | null
  providerName?: string | null
  timeZone: string
  refreshToken: string
  dailyFolderId?: string | null
}

export type ProviderProfileInput = ProviderProfileInputBase &
  (
    | { provider: 'dropbox'; target: DropboxTarget }
    | {
        provider: 'google-drive'
        target: Omit<GoogleDriveTarget, 'folderId'> & { folderId?: string | null }
      }
    | { provider: 'onedrive'; target: OneDriveTarget }
  )

type ProviderProfileMetadataBase = {
  profileId: string
  providerAccountId: string
  providerEmail: string | null
  providerName: string | null
  timeZone: string
  createdAt: string
  updatedAt: string
  revokedAt: string | null
  dailyFolderId?: string
}

export type ProviderProfileMetadata = ProviderProfileMetadataBase &
  (
    | { provider: 'dropbox'; target: DropboxTarget }
    | { provider: 'google-drive'; target: GoogleDriveTarget }
    | { provider: 'onedrive'; target: OneDriveTarget }
  )

type ValidatedProviderProfileInput = ProviderProfileInputBase &
  (
    | { provider: 'dropbox'; target: DropboxTarget }
    | { provider: 'google-drive'; target: GoogleDriveTarget }
    | { provider: 'onedrive'; target: OneDriveTarget }
  ) & {
    providerEmail: string | null
    providerName: string | null
  }

type ProviderProfileRow = {
  profile_id: string
  provider: Provider
  provider_account_id: string
  provider_email: string | null
  provider_name: string | null
  dropbox_path: string | null
  google_file_id: string | null
  google_folder_id: string | null
  google_file_name: string | null
  time_zone: string
  created_at: string
  updated_at: string
  revoked_at: string | null
  daily_folder_id: string | null
  onedrive_folder_name: string | null
}

type ProviderCredentialRow = {
  encrypted_refresh_token: string
}

const PROFILE_METADATA_COLUMNS = `
  profile_id,
  provider,
  provider_account_id,
  provider_email,
  provider_name,
  dropbox_path,
  google_file_id,
  google_folder_id,
  google_file_name,
  time_zone,
  created_at,
  updated_at,
  revoked_at,
  daily_folder_id,
  onedrive_folder_name
`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const IANA_TIME_ZONE = /^(?:UTC|GMT|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/
const hasControlCharacter = (value: string) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })

export class ProviderProfileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderProfileValidationError'
  }
}

const requiredText = (value: unknown, field: string, maxLength: number) => {
  if (typeof value !== 'string') {
    throw new ProviderProfileValidationError(`${field} must be a string.`)
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength || hasControlCharacter(normalized)) {
    throw new ProviderProfileValidationError(`${field} is invalid.`)
  }
  return normalized
}

const optionalText = (value: unknown, field: string, maxLength: number) => {
  if (value === undefined || value === null || value === '') return null
  return requiredText(value, field, maxLength)
}

const validateEmail = (value: unknown) => {
  const email = optionalText(value, 'providerEmail', 320)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ProviderProfileValidationError('providerEmail is invalid.')
  }
  return email
}

const validateTimeZone = (value: unknown) => {
  const timeZone = requiredText(value, 'timeZone', 64)
  if (!IANA_TIME_ZONE.test(timeZone)) {
    throw new ProviderProfileValidationError('timeZone must be an IANA time zone.')
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
  } catch {
    throw new ProviderProfileValidationError('timeZone must be an IANA time zone.')
  }
  return timeZone
}

const validateDropboxPath = (value: unknown) => {
  const path = requiredText(value, 'target.path', 1024)
  if (
    !path.startsWith('/') ||
    path === '/' ||
    path.endsWith('/') ||
    path.includes('//') ||
    path.includes('\\')
  ) {
    throw new ProviderProfileValidationError('target.path must be an absolute Dropbox file path.')
  }
  return path
}

const ONEDRIVE_ITEM_ADDRESS = /^\/drives\/[A-Za-z0-9!_%.-]+\/items\/[A-Za-z0-9!_%.-]+$/

const validateOneDriveFolder = (value: unknown) => {
  const folder = requiredText(value, 'target.folder', 1023)
  if (!ONEDRIVE_ITEM_ADDRESS.test(folder)) {
    throw new ProviderProfileValidationError('target.folder must be a OneDrive item address.')
  }
  return folder
}

const validateGoogleFileName = (value: unknown) => {
  const fileName = requiredText(value, 'target.fileName', 255)
  if (fileName === '.' || fileName === '..' || /[\\/]/.test(fileName)) {
    throw new ProviderProfileValidationError('target.fileName is invalid.')
  }
  return fileName
}

export const validateProviderProfileInput = (
  input: ProviderProfileInput,
): ValidatedProviderProfileInput => {
  if (!input || !['dropbox', 'google-drive', 'onedrive'].includes(input.provider)) {
    throw new ProviderProfileValidationError('provider must be dropbox, google-drive or onedrive.')
  }

  const base = {
    providerAccountId: requiredText(input.providerAccountId, 'providerAccountId', 255),
    providerEmail: validateEmail(input.providerEmail),
    providerName: optionalText(input.providerName, 'providerName', 200),
    timeZone: validateTimeZone(input.timeZone),
    refreshToken: requiredText(input.refreshToken, 'refreshToken', 8192),
    dailyFolderId: optionalText(input.dailyFolderId, 'dailyFolderId', 512),
  }

  if (input.provider === 'dropbox') {
    return {
      ...base,
      provider: 'dropbox',
      target: { path: validateDropboxPath(input.target?.path) },
    }
  }

  if (input.provider === 'onedrive') {
    const folder = validateOneDriveFolder(input.target?.folder)
    return {
      ...base,
      provider: 'onedrive',
      dailyFolderId: folder,
      target: {
        folder,
        folderName: requiredText(input.target?.folderName, 'target.folderName', 255),
      },
    }
  }

  return {
    ...base,
    provider: 'google-drive',
    target: {
      fileId: requiredText(input.target?.fileId, 'target.fileId', 512),
      folderId: optionalText(input.target?.folderId, 'target.folderId', 512),
      fileName: validateGoogleFileName(input.target?.fileName),
    },
  }
}

const validateProfileId = (profileId: string) => {
  if (!UUID.test(profileId)) {
    throw new ProviderProfileValidationError('profileId is invalid.')
  }
  return profileId
}

const toMetadata = (row: ProviderProfileRow): ProviderProfileMetadata => {
  const base = {
    profileId: row.profile_id,
    providerAccountId: row.provider_account_id,
    providerEmail: row.provider_email,
    providerName: row.provider_name,
    timeZone: row.time_zone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
    ...(row.daily_folder_id ? { dailyFolderId: row.daily_folder_id } : {}),
  }

  if (row.provider === 'dropbox') {
    if (!row.dropbox_path) throw new Error('Dropbox profile has no target path.')
    return { ...base, provider: 'dropbox', target: { path: row.dropbox_path } }
  }

  if (row.provider === 'onedrive') {
    if (!row.daily_folder_id || !row.onedrive_folder_name) {
      throw new Error('OneDrive profile has an incomplete target.')
    }
    return {
      ...base,
      provider: 'onedrive',
      target: { folder: row.daily_folder_id, folderName: row.onedrive_folder_name },
    }
  }

  if (!row.google_file_id || !row.google_file_name) {
    throw new Error('Google Drive profile has an incomplete target.')
  }
  return {
    ...base,
    provider: 'google-drive',
    target: {
      fileId: row.google_file_id,
      folderId: row.google_folder_id,
      fileName: row.google_file_name,
    },
  }
}

export class ProviderProfileRepository {
  constructor(
    private readonly db: D1Database,
    private readonly encryptionSecret: string,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async createOrUpdate(input: ProviderProfileInput): Promise<ProviderProfileMetadata> {
    const profile = validateProviderProfileInput(input)
    const encryptedRefreshToken = await encryptToken(
      profile.refreshToken,
      this.encryptionSecret,
    )
    const timestamp = this.now().toISOString()
    const dropboxPath = profile.provider === 'dropbox' ? profile.target.path : null
    const googleFileId = profile.provider === 'google-drive' ? profile.target.fileId : null
    const googleFolderId =
      profile.provider === 'google-drive' ? profile.target.folderId : null
    const googleFileName =
      profile.provider === 'google-drive' ? profile.target.fileName : null
    const oneDriveFolderName =
      profile.provider === 'onedrive' ? profile.target.folderName : null

    const row = await this.db
      .prepare(
        `INSERT INTO mcp_provider_profiles (
          profile_id,
          provider,
          provider_account_id,
          provider_email,
          provider_name,
          dropbox_path,
          google_file_id,
          google_folder_id,
          google_file_name,
          time_zone,
          encrypted_refresh_token,
          created_at,
          updated_at,
          revoked_at,
          daily_folder_id,
          onedrive_folder_name,
          credential_refreshed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
        ON CONFLICT(provider, provider_account_id) DO UPDATE SET
          provider_email = excluded.provider_email,
          provider_name = excluded.provider_name,
          dropbox_path = excluded.dropbox_path,
          google_file_id = excluded.google_file_id,
          google_folder_id = excluded.google_folder_id,
          google_file_name = excluded.google_file_name,
          onedrive_folder_name = excluded.onedrive_folder_name,
          credential_refreshed_at = excluded.credential_refreshed_at,
          time_zone = excluded.time_zone,
          encrypted_refresh_token = excluded.encrypted_refresh_token,
          updated_at = excluded.updated_at,
          revoked_at = NULL,
          daily_folder_id = CASE WHEN mcp_provider_profiles.revoked_at IS NULL
            THEN COALESCE(mcp_provider_profiles.daily_folder_id, excluded.daily_folder_id)
            ELSE excluded.daily_folder_id END
        WHERE mcp_provider_profiles.revoked_at IS NOT NULL
          OR (
            mcp_provider_profiles.dropbox_path IS excluded.dropbox_path
            AND mcp_provider_profiles.google_file_id IS excluded.google_file_id
            AND (mcp_provider_profiles.daily_folder_id IS NULL OR excluded.daily_folder_id IS NULL
              OR mcp_provider_profiles.daily_folder_id IS excluded.daily_folder_id)
          )
        RETURNING ${PROFILE_METADATA_COLUMNS}`,
      )
      .bind(
        this.createId(),
        profile.provider,
        profile.providerAccountId,
        profile.providerEmail,
        profile.providerName,
        dropboxPath,
        googleFileId,
        googleFolderId,
        googleFileName,
        profile.timeZone,
        encryptedRefreshToken,
        timestamp,
        timestamp,
        profile.dailyFolderId ?? null,
        oneDriveFolderName,
        timestamp,
      )
      .first<ProviderProfileRow>()

    if (!row) {
      throw new ProviderProfileValidationError(
        'Disable Agent access in the browser where it is enabled before selecting a different file or folder. Existing agents must reconnect.',
      )
    }
    return toMetadata(row)
  }

  async setDailyFolder(profile: ProviderProfileMetadata, folder: string): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE mcp_provider_profiles SET daily_folder_id = ?, updated_at = ?
       WHERE profile_id = ? AND updated_at = ? AND revoked_at IS NULL AND (daily_folder_id IS NULL OR daily_folder_id = ?)`,
    ).bind(folder, this.now().toISOString(), validateProfileId(profile.profileId), profile.updatedAt, folder).run()
    return (result.meta.changes ?? 0) > 0
  }

  async getMetadata(profileId: string): Promise<ProviderProfileMetadata | null> {
    const row = await this.db
      .prepare(
        `SELECT ${PROFILE_METADATA_COLUMNS}
        FROM mcp_provider_profiles
        WHERE profile_id = ?`,
      )
      .bind(validateProfileId(profileId))
      .first<ProviderProfileRow>()

    return row ? toMetadata(row) : null
  }

  async decryptCredential(profileId: string): Promise<string | null> {
    const row = await this.db
      .prepare(
        `SELECT encrypted_refresh_token
        FROM mcp_provider_profiles
        WHERE profile_id = ? AND revoked_at IS NULL`,
      )
      .bind(validateProfileId(profileId))
      .first<ProviderCredentialRow>()

    if (!row?.encrypted_refresh_token) return null
    return decryptToken(row.encrypted_refresh_token, this.encryptionSecret)
  }

  // Records the refresh in credential_refreshed_at, not updated_at: Settings
  // uses updated_at to detect concurrent profile changes, and a background
  // token refresh is not one.
  async updateCredential(profileId: string, refreshToken: string): Promise<void> {
    const credential = requiredText(refreshToken, 'refreshToken', 8192)
    const encryptedRefreshToken = await encryptToken(
      credential,
      this.encryptionSecret,
    )
    const result = await this.db
      .prepare(
        `UPDATE mcp_provider_profiles
        SET encrypted_refresh_token = ?, credential_refreshed_at = ?
        WHERE profile_id = ? AND revoked_at IS NULL`,
      )
      .bind(
        encryptedRefreshToken,
        this.now().toISOString(),
        validateProfileId(profileId),
      )
      .run()

    if (result.meta.changes !== 1) {
      throw new ProviderProfileValidationError('Profile is not active.')
    }
  }

  async revoke(profileId: string): Promise<boolean> {
    const timestamp = this.now().toISOString()
    const result = await this.db
      .prepare(
        `UPDATE mcp_provider_profiles
        SET encrypted_refresh_token = '', updated_at = ?, revoked_at = ?
        WHERE profile_id = ? AND revoked_at IS NULL`,
      )
      .bind(timestamp, timestamp, validateProfileId(profileId))
      .run()

    return result.meta.changes > 0
  }
}
