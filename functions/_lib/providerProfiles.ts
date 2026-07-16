import { decryptToken, encryptToken } from './tokenCookie'

export type Provider = 'dropbox' | 'google-drive'

export type DropboxTarget = {
  path: string
}

export type GoogleDriveTarget = {
  fileId: string
  folderId: string | null
  fileName: string
}

type ProviderProfileInputBase = {
  providerAccountId: string
  providerEmail?: string | null
  providerName?: string | null
  timeZone: string
  refreshToken: string
}

export type ProviderProfileInput = ProviderProfileInputBase &
  (
    | { provider: 'dropbox'; target: DropboxTarget }
    | {
        provider: 'google-drive'
        target: Omit<GoogleDriveTarget, 'folderId'> & { folderId?: string | null }
      }
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
}

export type ProviderProfileMetadata = ProviderProfileMetadataBase &
  (
    | { provider: 'dropbox'; target: DropboxTarget }
    | { provider: 'google-drive'; target: GoogleDriveTarget }
  )

type ValidatedProviderProfileInput = ProviderProfileInputBase &
  (
    | { provider: 'dropbox'; target: DropboxTarget }
    | { provider: 'google-drive'; target: GoogleDriveTarget }
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
  revoked_at
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
  if (!input || (input.provider !== 'dropbox' && input.provider !== 'google-drive')) {
    throw new ProviderProfileValidationError('provider must be dropbox or google-drive.')
  }

  const base = {
    providerAccountId: requiredText(input.providerAccountId, 'providerAccountId', 255),
    providerEmail: validateEmail(input.providerEmail),
    providerName: optionalText(input.providerName, 'providerName', 200),
    timeZone: validateTimeZone(input.timeZone),
    refreshToken: requiredText(input.refreshToken, 'refreshToken', 8192),
  }

  if (input.provider === 'dropbox') {
    return {
      ...base,
      provider: 'dropbox',
      target: { path: validateDropboxPath(input.target?.path) },
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
  }

  if (row.provider === 'dropbox') {
    if (!row.dropbox_path) throw new Error('Dropbox profile has no target path.')
    return { ...base, provider: 'dropbox', target: { path: row.dropbox_path } }
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
          revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(provider, provider_account_id) DO UPDATE SET
          provider_email = excluded.provider_email,
          provider_name = excluded.provider_name,
          dropbox_path = excluded.dropbox_path,
          google_file_id = excluded.google_file_id,
          google_folder_id = excluded.google_folder_id,
          google_file_name = excluded.google_file_name,
          time_zone = excluded.time_zone,
          encrypted_refresh_token = excluded.encrypted_refresh_token,
          updated_at = excluded.updated_at,
          revoked_at = NULL
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
      )
      .first<ProviderProfileRow>()

    if (!row) throw new Error('Provider profile was not persisted.')
    return toMetadata(row)
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
