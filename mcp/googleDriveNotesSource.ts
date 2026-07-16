import { formatDayTitle } from '../src/lib/dates.js'
import { exportMarkdown, parseMarkdown } from '../src/lib/markdown.js'
import { addToDay, type AddToDayInput, type AddToDayResult } from '../src/lib/noteWrites.js'
import { sortDaysDescending, type Day } from '../src/lib/notesCore.js'
import type { NotesSnapshot } from './readTools.js'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const FILE_FIELDS =
  'id,name,mimeType,size,version,headRevisionId,modifiedTime,trashed,parents,capabilities(canDownload,canEdit,canModifyContent)'

type AuthorizedFetch = (input: string, init?: RequestInit) => Promise<Response>

type DriveFile = {
  id: string
  name: string
  mimeType: string
  size?: string
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

type DriveRevision = {
  id: string
  modifiedTime?: string
}

type DriveError = {
  error?: {
    message?: string
  }
}

export type GoogleDriveNotesTarget = {
  fileId: string
  fileName: string
  folderId?: string | null
}

export type GoogleDriveNotesSourceInfo = {
  provider: 'google-drive'
  fileId: string
  fileName: string
  folderId: string | null
  version: string
  headRevisionId: string | null
  modifiedAt: string | null
  sizeBytes: number | null
}

export type GoogleDriveNotesSnapshot = NotesSnapshot & {
  source: GoogleDriveNotesSourceInfo
}

export type GoogleDriveAddToDayResult = Pick<
  AddToDayResult,
  'day' | 'created' | 'position' | 'operation_id'
> & {
  source: GoogleDriveNotesSourceInfo
  status: 'written' | 'attention'
  recovered: boolean
  attention?: string
}

type ConcurrentRevisionInspection =
  | { status: 'none' }
  | { status: 'recoverable'; revisionId: string }
  | { status: 'inconclusive' }

const driveError = async (response: Response, fallback: string) => {
  const payload = (await response.json().catch(() => null)) as DriveError | null
  return new Error(payload?.error?.message || fallback)
}

const validateDriveFile = (file: DriveFile, target: GoogleDriveNotesTarget) => {
  if (file.id !== target.fileId) {
    throw new Error('Google Drive returned metadata for an unexpected file.')
  }
  if (file.trashed) {
    throw new Error('Google Drive notes file is in the trash.')
  }
  if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    throw new Error('Google Drive notes target cannot be a folder.')
  }
  if (file.mimeType.startsWith('application/vnd.google-apps.')) {
    throw new Error('Google Drive notes target must be a normal Markdown file.')
  }
  if (file.capabilities?.canDownload === false) {
    throw new Error('Google Drive notes file cannot be downloaded.')
  }
  if (file.capabilities?.canEdit === false || file.capabilities?.canModifyContent === false) {
    throw new Error('Google Drive notes file cannot be edited.')
  }
  return file
}

const toSourceInfo = (
  metadata: DriveFile,
  target: GoogleDriveNotesTarget,
): GoogleDriveNotesSourceInfo => {
  const sizeBytes = metadata.size === undefined ? null : Number(metadata.size)

  return {
    provider: 'google-drive',
    fileId: metadata.id,
    fileName: metadata.name || target.fileName,
    folderId: target.folderId ?? null,
    version: metadata.version,
    headRevisionId: metadata.headRevisionId ?? null,
    modifiedAt: metadata.modifiedTime ?? null,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
  }
}

const toDays = (source: string, modifiedTime?: string) => {
  const parsed = parseMarkdown(source)
  const timestamp = modifiedTime ? Date.parse(modifiedTime) : Date.now()
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now()
  const days: Day[] = parsed.days.map((day) => ({
    dayId: day.dayId,
    humanTitle: day.humanTitle || formatDayTitle(day.dayId),
    contentMd: day.contentMd,
    createdAt: safeTimestamp,
    updatedAt: safeTimestamp,
  }))

  return {
    warnings: parsed.warnings,
    days: sortDaysDescending(days),
  }
}

const versionDistance = (candidate: string, previous: string) => {
  const candidateNumber = Number(candidate)
  const previousNumber = Number(previous)
  if (!Number.isSafeInteger(candidateNumber) || !Number.isSafeInteger(previousNumber)) {
    return null
  }
  return candidateNumber - previousNumber
}

export const createGoogleDriveNotesSource = (
  authorizedFetch: AuthorizedFetch,
  target: GoogleDriveNotesTarget,
) => {
  if (!target.fileId.trim()) {
    throw new Error('Google Drive fileId is required.')
  }
  if (!target.fileName.trim()) {
    throw new Error('Google Drive fileName is required.')
  }

  const fetchMetadata = async () => {
    const response = await authorizedFetch(
      `${DRIVE_API}/files/${encodeURIComponent(target.fileId)}?fields=${encodeURIComponent(FILE_FIELDS)}`,
    )
    if (!response.ok) {
      throw await driveError(response, 'Failed to fetch Google Drive notes metadata.')
    }
    return validateDriveFile((await response.json()) as DriveFile, target)
  }

  const downloadFile = async () => {
    const response = await authorizedFetch(
      `${DRIVE_API}/files/${encodeURIComponent(target.fileId)}?alt=media`,
    )
    if (!response.ok) {
      throw await driveError(response, 'Failed to download Google Drive notes.')
    }
    return response.text()
  }

  const downloadRevision = async (revisionId: string) => {
    const response = await authorizedFetch(
      `${DRIVE_API}/files/${encodeURIComponent(target.fileId)}/revisions/${encodeURIComponent(revisionId)}?alt=media`,
    )
    if (!response.ok) {
      throw await driveError(response, 'Failed to download the concurrent Google Drive revision.')
    }
    return response.text()
  }

  const uploadFile = async (content: string) => {
    const params = new URLSearchParams({
      uploadType: 'media',
      fields: FILE_FIELDS,
    })
    const response = await authorizedFetch(
      `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(target.fileId)}?${params}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'text/markdown; charset=UTF-8',
        },
        body: content,
      },
    )
    if (!response.ok) {
      throw await driveError(response, 'Failed to upload Google Drive notes.')
    }
    return validateDriveFile((await response.json()) as DriveFile, target)
  }

  const listRevisions = async () => {
    const params = new URLSearchParams({
      pageSize: '1000',
      fields: 'nextPageToken,revisions(id,modifiedTime)',
    })
    const response = await authorizedFetch(
      `${DRIVE_API}/files/${encodeURIComponent(target.fileId)}/revisions?${params}`,
    )
    if (!response.ok) {
      return null
    }
    const payload = (await response.json()) as {
      revisions?: DriveRevision[]
      nextPageToken?: string
    }
    if (payload.nextPageToken) {
      return null
    }
    const revisions = payload.revisions ?? []
    if (revisions.some((revision) => !revision.modifiedTime)) {
      return null
    }
    return [...revisions].sort((left, right) =>
      left.modifiedTime!.localeCompare(right.modifiedTime!),
    )
  }

  const inspectConcurrentRevision = async (
    before: DriveFile,
    uploaded: DriveFile,
    current: DriveFile,
  ): Promise<ConcurrentRevisionInspection> => {
    const currentMovedAfterUpload =
      current.version !== uploaded.version ||
      (current.headRevisionId !== undefined &&
        uploaded.headRevisionId !== undefined &&
        current.headRevisionId !== uploaded.headRevisionId)

    const uploadVersionDistance = versionDistance(uploaded.version, before.version)
    const suspiciousUpload =
      uploadVersionDistance === null
        ? uploaded.version !== before.version
        : uploadVersionDistance > 1

    const revisions = await listRevisions()
    if (!revisions || !before.headRevisionId || !uploaded.headRevisionId) {
      return currentMovedAfterUpload || suspiciousUpload
        ? { status: 'inconclusive' }
        : { status: 'none' }
    }

    const beforeIndex = revisions.findIndex((revision) => revision.id === before.headRevisionId)
    const uploadedIndex = revisions.findIndex((revision) => revision.id === uploaded.headRevisionId)
    if (beforeIndex === -1 || uploadedIndex === -1 || uploadedIndex <= beforeIndex) {
      return currentMovedAfterUpload || suspiciousUpload
        ? { status: 'inconclusive' }
        : { status: 'none' }
    }

    if (currentMovedAfterUpload) {
      const currentIndex = revisions.findIndex((revision) => revision.id === current.headRevisionId)
      if (currentIndex <= uploadedIndex) {
        return { status: 'inconclusive' }
      }
      return { status: 'recoverable', revisionId: revisions[currentIndex].id }
    }

    if (uploadedIndex - beforeIndex === 1) {
      return { status: 'none' }
    }

    return {
      status: 'recoverable',
      revisionId: revisions[uploadedIndex - 1].id,
    }
  }

  const read = async (): Promise<GoogleDriveNotesSnapshot> => {
    const metadata = await fetchMetadata()
    const content = await downloadFile()
    const parsed = toDays(content, metadata.modifiedTime)

    return {
      source: toSourceInfo(metadata, target),
      warnings: parsed.warnings,
      days: parsed.days,
    }
  }

  const applyWrite = (source: string, input: AddToDayInput, modifiedTime?: string) => {
    const parsed = toDays(source, modifiedTime)
    const unsafeWarning = parsed.warnings.find(
      (warning) =>
        warning === 'No day markers found.' ||
        warning.startsWith('Duplicate day marker for '),
    )
    if (unsafeWarning) {
      throw new Error(
        `Google Drive notes cannot be written safely: ${unsafeWarning} Repair the Markdown structure in Rivolo first.`,
      )
    }
    const added = addToDay(parsed.days, input)
    return {
      added,
      content: exportMarkdown(added.days),
    }
  }

  const add = async (input: AddToDayInput): Promise<GoogleDriveAddToDayResult> => {
    const before = await fetchMetadata()
    const beforeContent = await downloadFile()
    const initial = applyWrite(beforeContent, input, before.modifiedTime)
    const uploaded = await uploadFile(initial.content)
    const current = await fetchMetadata()
    const inspection = await inspectConcurrentRevision(before, uploaded, current)

    if (inspection.status === 'none') {
      return {
        status: 'written',
        recovered: false,
        source: toSourceInfo(current, target),
        day: initial.added.day,
        created: initial.added.created,
        position: initial.added.position,
        operation_id: initial.added.operation_id,
      }
    }

    if (inspection.status === 'inconclusive') {
      return {
        status: 'attention',
        recovered: false,
        attention:
          'Google Drive changed while writing. The concurrent revision could not be identified safely; review the cloud-synced notes.',
        source: toSourceInfo(current, target),
        day: initial.added.day,
        created: initial.added.created,
        position: initial.added.position,
        operation_id: initial.added.operation_id,
      }
    }

    const concurrentContent = await downloadRevision(inspection.revisionId)
    const recovered = applyWrite(concurrentContent, input, current.modifiedTime)
    const recoveredUpload = await uploadFile(recovered.content)

    return {
      status: 'attention',
      recovered: true,
      attention:
        'Google Drive changed while writing. The note addition was replayed once against the concurrent revision.',
      source: toSourceInfo(recoveredUpload, target),
      day: recovered.added.day,
      created: recovered.added.created,
      position: recovered.added.position,
      operation_id: recovered.added.operation_id,
    }
  }

  return {
    read,
    addToDay: add,
  }
}
