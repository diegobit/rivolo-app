import { formatDayTitle } from '../../src/lib/dates.js'
import { exportMarkdown, parseMarkdown } from '../../src/lib/markdown.js'
import {
  addToDay as applyAddToDay,
  type AddToDayInput,
  type AddToDayResult,
} from '../../src/lib/noteWrites.js'
import { sortDaysDescending, type Day } from '../../src/lib/notesCore.js'
import type { NotesSnapshot } from '../readTools.js'

const DROPBOX_CONTENT = 'https://content.dropboxapi.com/2'
const DEFAULT_CONFLICT_RETRIES = 2

export type AuthorizedDropboxFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export type DropboxNotesSource = {
  provider: 'dropbox'
  path: string
  rev: string
  sizeBytes: number
  modifiedAt: string
  contentHash?: string
}

export type DropboxNotesSnapshot = NotesSnapshot & {
  source: DropboxNotesSource
}

export type DropboxAddToDayResult = Pick<
  AddToDayResult,
  'day' | 'created' | 'position' | 'operation_id'
> & {
  source: DropboxNotesSource
  warnings: string[]
  conflictRetries: number
}

export type DropboxNotesAdapter = {
  loadNotes: () => Promise<DropboxNotesSnapshot>
  addToDay: (input: AddToDayInput) => Promise<DropboxAddToDayResult>
}

export type DropboxNotesAdapterOptions = {
  authorizedFetch: AuthorizedDropboxFetch
  path: string
  maxConflictRetries?: number
  now?: () => number
}

type DropboxFileMetadata = {
  rev: string
  server_modified: string
  size: number
  content_hash?: string
}

type DropboxError = {
  error_summary?: string
}

type DownloadedNotes = {
  content: string
  metadata: DropboxFileMetadata
}

class DropboxConflictError extends Error {
  constructor() {
    super('Dropbox notes changed before the update completed.')
  }
}

const validatePath = (path: string) => {
  const trimmed = path.trim()
  if (!trimmed.startsWith('/') || trimmed === '/') {
    throw new Error('Dropbox notes path must be an absolute file path.')
  }
  return trimmed
}

const validateRetries = (value: number | undefined) => {
  const retries = value ?? DEFAULT_CONFLICT_RETRIES
  if (!Number.isInteger(retries) || retries < 0) {
    throw new Error('maxConflictRetries must be a non-negative integer.')
  }
  return retries
}

const parseMetadata = (value: unknown): DropboxFileMetadata => {
  if (!value || typeof value !== 'object') {
    throw new Error('Dropbox returned invalid file metadata.')
  }

  const metadata = value as Partial<DropboxFileMetadata>
  if (
    typeof metadata.rev !== 'string'
    || typeof metadata.server_modified !== 'string'
    || typeof metadata.size !== 'number'
  ) {
    throw new Error('Dropbox returned invalid file metadata.')
  }

  return {
    rev: metadata.rev,
    server_modified: metadata.server_modified,
    size: metadata.size,
    ...(typeof metadata.content_hash === 'string'
      ? { content_hash: metadata.content_hash }
      : {}),
  }
}

const readDropboxError = async (response: Response) =>
  (await response.json().catch(() => null)) as DropboxError | null

const isPathError = (payload: DropboxError | null, kind: 'not_found' | 'conflict') =>
  payload?.error_summary?.startsWith(`path/${kind}`) ?? false

const metadataFromDownload = (response: Response) => {
  const header = response.headers.get('Dropbox-API-Result')
  if (!header) {
    throw new Error('Dropbox did not return download metadata.')
  }

  try {
    return parseMetadata(JSON.parse(header))
  } catch {
    throw new Error('Dropbox returned invalid download metadata.')
  }
}

const downloadNotes = async (
  authorizedFetch: AuthorizedDropboxFetch,
  path: string,
) => {
  let response: Response
  try {
    response = await authorizedFetch(`${DROPBOX_CONTENT}/files/download`, {
      method: 'POST',
      headers: {
        'Dropbox-API-Arg': JSON.stringify({ path }),
      },
    })
  } catch {
    throw new Error('Dropbox download request failed.')
  }

  if (!response.ok) {
    if (response.status === 409 && isPathError(await readDropboxError(response), 'not_found')) {
      throw new Error('Dropbox notes file was not found.')
    }
    throw new Error(`Dropbox download request failed with status ${response.status}.`)
  }

  return {
    content: await response.text(),
    metadata: metadataFromDownload(response),
  }
}

const uploadNotes = async (
  authorizedFetch: AuthorizedDropboxFetch,
  path: string,
  content: string,
  expectedRev: string,
) => {
  let response: Response
  try {
    response = await authorizedFetch(`${DROPBOX_CONTENT}/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path,
          mode: {
            '.tag': 'update',
            update: expectedRev,
          },
          autorename: false,
          mute: false,
        }),
      },
      body: content,
    })
  } catch {
    throw new Error('Dropbox upload request failed.')
  }

  if (!response.ok) {
    if (response.status === 409 && isPathError(await readDropboxError(response), 'conflict')) {
      throw new DropboxConflictError()
    }
    throw new Error(`Dropbox upload request failed with status ${response.status}.`)
  }

  return parseMetadata(await response.json().catch(() => null))
}

const toSource = (path: string, metadata: DropboxFileMetadata): DropboxNotesSource => ({
  provider: 'dropbox',
  path,
  rev: metadata.rev,
  sizeBytes: metadata.size,
  modifiedAt: metadata.server_modified,
  ...(metadata.content_hash ? { contentHash: metadata.content_hash } : {}),
})

const parseNotes = (
  path: string,
  downloaded: DownloadedNotes,
): DropboxNotesSnapshot => {
  const parsed = parseMarkdown(downloaded.content)
  const timestamp = Date.parse(downloaded.metadata.server_modified)
  if (!Number.isFinite(timestamp)) {
    throw new Error('Dropbox returned an invalid modification timestamp.')
  }

  const days: Day[] = parsed.days.map((day) => ({
    dayId: day.dayId,
    humanTitle: day.humanTitle || formatDayTitle(day.dayId),
    contentMd: day.contentMd,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))

  return {
    source: toSource(path, downloaded.metadata),
    warnings: parsed.warnings,
    days: sortDaysDescending(days),
  }
}

export const createDropboxNotesAdapter = (
  options: DropboxNotesAdapterOptions,
): DropboxNotesAdapter => {
  const path = validatePath(options.path)
  const maxConflictRetries = validateRetries(options.maxConflictRetries)
  const now = options.now ?? Date.now

  const loadNotes = async () => {
    const downloaded = await downloadNotes(options.authorizedFetch, path)
    return parseNotes(path, downloaded)
  }

  const addToDay = async (input: AddToDayInput): Promise<DropboxAddToDayResult> => {
    for (let conflictRetries = 0; conflictRetries <= maxConflictRetries; conflictRetries += 1) {
      const snapshot = await loadNotes()
      const mutation = applyAddToDay(snapshot.days, input, { now: now() })
      const content = exportMarkdown(mutation.days)

      try {
        const metadata = await uploadNotes(
          options.authorizedFetch,
          path,
          content,
          snapshot.source.rev,
        )

        return {
          source: toSource(path, metadata),
          warnings: snapshot.warnings,
          day: mutation.day,
          created: mutation.created,
          position: mutation.position,
          operation_id: mutation.operation_id,
          conflictRetries,
        }
      } catch (error) {
        if (error instanceof DropboxConflictError && conflictRetries < maxConflictRetries) {
          continue
        }
        if (error instanceof DropboxConflictError) {
          throw new Error('Dropbox notes changed repeatedly; retry the operation.')
        }
        throw error
      }
    }

    throw new Error('Dropbox notes update failed.')
  }

  return { loadNotes, addToDay }
}
