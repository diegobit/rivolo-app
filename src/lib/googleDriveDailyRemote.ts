import { isValidDayId } from './dates'
import { decodeNotebookDay } from './notebookDays'
import { hashSyncContent } from './syncHash'
import { mergeOneDriveNotebooksWithAuthors } from './oneDriveMerge'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
const FIELDS = 'id,name,mimeType,parents,trashed,headRevisionId,appProperties,capabilities(canEdit)'

type Entry = {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  trashed?: boolean
  headRevisionId?: string
  appProperties?: Record<string, string>
  capabilities?: { canEdit?: boolean }
}
type File = { ref: string; revision: string; folder: string; dayId: string; duplicate?: boolean }
type Revision = { id: string; modifiedTime: string }

class DriveConflict extends Error {}

export const createGoogleDriveDailyRemote = (authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>) => {
  const quote = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
  const entryPath = (ref: string) => `/files/${encodeURIComponent(ref)}`
  const entry = async (ref: string) => {
    const response = await authorizedFetch(`${API}${entryPath(ref)}?fields=${encodeURIComponent(FIELDS)}`)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Google Drive could not verify file metadata (${response.status}).`)
    const file = await response.json() as Entry
    return file.trashed ? null : file
  }
  const readPages = async <T>(path: string, params: URLSearchParams, property: string) => {
    const seen = new Set<string>()
    const items: T[] = []
    for (;;) {
      const response = await authorizedFetch(`${API}${path}?${params}`)
      if (!response.ok) throw new Error(`Google Drive listing failed (${response.status}). Retry.`)
      const payload = await response.json() as Record<string, unknown>
      const page = payload[property]
      if (!Array.isArray(page) || payload.incompleteSearch) throw new Error('Google Drive returned an incomplete listing.')
      items.push(...page)
      const token = payload.nextPageToken
      if (!token) return items
      if (typeof token !== 'string' || seen.has(token)) throw new Error('Google Drive repeated a listing page.')
      seen.add(token)
      params.set('pageToken', token)
    }
  }
  const asFile = (file: Entry, folder: string, dayId: string): File => {
    if (!file.id || !file.headRevisionId || file.name !== `${dayId}.md` ||
        file.mimeType.startsWith('application/vnd.google-apps.') || !file.parents?.includes(folder) ||
        file.appProperties?.rivoloDay !== dayId || file.appProperties.rivoloNotebook !== folder) {
      throw new Error(`Google Drive ${dayId}: the day file moved or has invalid metadata.`)
    }
    return { ref: file.id, revision: file.headRevisionId, folder, dayId }
  }
  const listDays = (folder: string, dayId?: string) => readPages<Entry>('/files', new URLSearchParams({
    q: [
      `${quote(folder)} in parents`,
      'trashed=false',
      `appProperties has { key='rivoloNotebook' and value=${quote(folder)} }`,
      ...(dayId ? [`appProperties has { key='rivoloDay' and value=${quote(dayId)} }`] : []),
    ].join(' and '),
    fields: `nextPageToken,incompleteSearch,files(${FIELDS})`, spaces: 'drive', pageSize: '1000',
  }), 'files')

  const duplicate = (id: string) => new Error(`Google Drive has more than one file for ${id}. Both copies are in the notebook folder. Merge their contents and move the extra copy aside before retrying.`)
  const stat = async (folder: string, dayId: string) => {
    const files = await listDays(folder, dayId)
    if (files.length > 1) throw duplicate(dayId)
    return files[0] ? asFile(files[0], folder, dayId) : null
  }

  const inventory = async (folder: string) => {
    await requireGoogleDriveDailyFolder(folder)
    const days = new Map<string, File>()
    for (const file of await listDays(folder)) {
      const id = file.appProperties?.rivoloDay
      if (!id || !isValidDayId(id)) throw new Error('Google Drive returned invalid day metadata.')
      const current = days.get(id)
      days.set(id, current ? { ...current, revision: '', duplicate: true } : asFile(file, folder, id))
    }
    return days
  }

  const requireGoogleDriveDailyFolder = async (folder: string) => {
    const root = await entry(folder)
    if (root?.mimeType !== FOLDER || root.capabilities?.canEdit === false) {
      throw new Error('Google Drive notebook folder is unavailable. Check permissions and retry.')
    }
  }

  const prepareGoogleDriveDailyFolder = async (parent: string, fileName: string) => {
    const key = await hashSyncContent(fileName)
    const name = `${fileName.replace(/\.md$/i, '')}.rivolo-daily`
    const find = async () => {
      const folders = await readPages<Entry>('/files', new URLSearchParams({
        q: `${quote(parent)} in parents and trashed=false and mimeType=${quote(FOLDER)} and appProperties has { key='rivoloDailySource' and value=${quote(key)} }`,
        fields: `nextPageToken,incompleteSearch,files(${FIELDS})`,
      }), 'files')
      if (folders.length > 1) throw new Error('Google Drive found multiple daily notebook folders. Keep the intended folder and move the others aside before retrying.')
      return folders[0]?.id
    }
    const existing = await find()
    if (existing) return existing
    const response = await authorizedFetch(`${API}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent], appProperties: { rivoloDailySource: key } }),
    })
    if (!response.ok) throw new Error(`Google Drive could not create the daily notebook folder (${response.status}).`)
    const created = await response.json() as { id?: string }
    const verified = await find()
    if (!created.id || verified !== created.id) throw new Error('Google Drive is still indexing the new daily notebook folder. Retry the upgrade shortly.')
    return created.id
  }

  const currentFile = async (file: File) => {
    const current = await entry(file.ref)
    if (!current) throw new DriveConflict()
    return asFile(current, file.folder, file.dayId)
  }
  const assertCurrent = async (file: File) => {
    if ((await currentFile(file)).revision !== file.revision) throw new DriveConflict()
  }

  const download = async (file: File) => {
    if (file.duplicate) throw duplicate(file.dayId)
    const response = await authorizedFetch(`${API}${entryPath(file.ref)}?alt=media`)
    if (!response.ok) throw new Error(`Google Drive could not download ${file.dayId} (${response.status}).`)
    const text = await response.text()
    await assertCurrent(file)
    return text
  }

  const revisionPath = (file: File, id: string) => `${entryPath(file.ref)}/revisions/${encodeURIComponent(id)}`
  const downloadRetainedRevision = async (file: File, id: string) => {
    const path = revisionPath(file, id)
    const retain = await authorizedFetch(`${API}${path}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepForever: true }),
    })
    if (!retain.ok) throw new Error(`Google Drive could not retain a concurrent edit to ${file.dayId}.`)
    const response = await authorizedFetch(`${API}${path}?alt=media`)
    if (!response.ok) throw new Error(`Google Drive could not download a concurrent edit to ${file.dayId}.`)
    const text = await response.text()
    decodeNotebookDay(text, file.dayId)
    return text
  }

  // Drive does not document a conditional media upload. Verify that no content
  // revision was replaced between the observed head and the submitted revision.
  const intervening = async (file: File, expected: string) => {
    const revisions = await readPages<Revision>(`${entryPath(file.ref)}/revisions`, new URLSearchParams({
      fields: 'nextPageToken,revisions(id,modifiedTime)', pageSize: '1000',
    }), 'revisions')
    const before = revisions.find((revision) => revision.id === expected)
    const after = revisions.find((revision) => revision.id === file.revision)
    if (!before?.modifiedTime || !after?.modifiedTime || before.modifiedTime >= after.modifiedTime ||
        revisions.some((revision) => !revision.modifiedTime)) {
      throw new Error(`Google Drive could not verify the upload history for ${file.dayId}. The day is still pending.`)
    }
    return revisions.filter((revision) => revision.id !== before.id && revision.id !== after.id &&
      revision.modifiedTime >= before.modifiedTime && revision.modifiedTime <= after.modifiedTime)
      .sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime) || a.id.localeCompare(b.id))
  }

  const recoverPending = async (file: File, expected: string, content: string) => {
    const conflicts = await intervening(file, expected)
    if (!conflicts.length) return content
    const baseline = await downloadRetainedRevision(file, expected)
    let merged = content
    for (const revision of conflicts) {
      const concurrent = await downloadRetainedRevision(file, revision.id)
      merged = await mergeOneDriveNotebooksWithAuthors(baseline, merged, concurrent)
    }
    return merged
  }

  const prepareWrite = async (folder: string, dayId: string, current: File | null) =>
    async (content: string, guard: () => Promise<void>) => {
      if (current) await assertCurrent(current)
      else if (await stat(folder, dayId)) throw new DriveConflict()
      await guard()
      const params = new URLSearchParams({ fields: FIELDS, uploadType: current ? 'media' : 'multipart' })
      const boundary = `rivolo_${crypto.randomUUID()}`
      const metadata = JSON.stringify({
        name: `${dayId}.md`, mimeType: 'text/markdown', parents: [folder],
        appProperties: { rivoloNotebook: folder, rivoloDay: dayId },
      })
      const response = await authorizedFetch(`${UPLOAD}${current ? entryPath(current.ref) : '/files'}?${params}`, {
        method: current ? 'PATCH' : 'POST',
        headers: { 'Content-Type': current ? 'text/markdown; charset=UTF-8' : `multipart/related; boundary=${boundary}` },
        body: current ? content : [
          `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', metadata,
          `--${boundary}`, 'Content-Type: text/markdown; charset=UTF-8', '', content, `--${boundary}--`, '',
        ].join('\r\n'),
      })
      if (!response.ok) throw new Error(`Google Drive upload failed for ${dayId} (${response.status}).`)
      const uploaded = asFile(await response.json() as Entry, folder, dayId)
      if (current) {
        const conflicts = await intervening(uploaded, current.revision)
        if (conflicts.length) {
          // The pending write retains the previous head. The next pass merges
          // these retained revisions before treating this upload as settled.
          for (const conflict of conflicts) await downloadRetainedRevision(uploaded, conflict.id)
          throw new Error(`Google Drive changed during upload of ${dayId}. Sync will merge the concurrent revisions on retry.`)
        }
      } else if ((await stat(folder, dayId))?.ref !== uploaded.ref) throw new DriveConflict()
      return uploaded
    }

  const migrationComplete = async (folder: string) =>
    (await entry(folder))?.appProperties?.rivoloMigrated === 'true'
  const completeMigration = async (folder: string, guard: () => Promise<void>) => {
    if (await migrationComplete(folder)) return
    await guard()
    const response = await authorizedFetch(`${API}${entryPath(folder)}?fields=appProperties`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appProperties: { rivoloMigrated: 'true' } }),
    })
    if (!response.ok || (await response.json() as Entry).appProperties?.rivoloMigrated !== 'true') {
      throw new Error('Google Drive could not record the daily sync upgrade. Retry sync.')
    }
  }

  return {
    prepareGoogleDriveDailyFolder, migrationComplete, completeMigration,
    stat,
    exists: async (ref: string) => Boolean(await entry(ref)),
    assertFolder: requireGoogleDriveDailyFolder,
    inventory,
    download,
    prepareWrite,
    recoverPending,
    remove: async (file: File, guard: () => Promise<void>) => {
      await assertCurrent(file)
      await guard()
      // The trash keeps the exact file, including a concurrent edit that arrived
      // after the revision check. Drive does not document an atomic trash CAS.
      const response = await authorizedFetch(`${API}${entryPath(file.ref)}?fields=headRevisionId,trashed`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
      })
      if (!response.ok) throw new Error(`Google Drive could not move ${file.dayId} to the trash.`)
      const result = await response.json() as Entry
      if (!result.trashed || result.headRevisionId !== file.revision) {
        throw new Error(`Google Drive changed ${file.dayId} during deletion. The new version can be recovered from the Drive trash.`)
      }
    },
    isConflict: (error: unknown) => error instanceof DriveConflict,
  }
}
