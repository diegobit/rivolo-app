import { isValidDayId } from './dates'
import { dayPath } from './notebookDays'

const API = 'https://api.dropboxapi.com/2/files'
const CONTENT = 'https://content.dropboxapi.com/2/files'

type Entry = {
  '.tag': string
  id: string
  path_display: string
  path_lower: string
  rev?: string
}
type File = { ref: string; revision: string; path: string }
class DropboxConflict extends Error {}

export const createDropboxDailyRemote = (authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>) => {
  const rpc = async <T>(method: string, body: object, missing = false): Promise<T | null> => {
    const response = await authorizedFetch(`${API}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (response.ok) return await response.json() as T
    const error = await response.json().catch(() => null) as { error_summary?: string } | null
    const detail = error?.error_summary ?? ''
    if (response.status === 409 && missing && detail.startsWith('path/not_found')) return null
    if (response.status === 409 && ['path/conflict', 'path_lookup/not_found', 'path_write/conflict', 'too_many_write_operations'].some((prefix) => detail.startsWith(prefix))) throw new DropboxConflict()
    throw new Error(`Dropbox ${method} failed (${response.status}). Check notebook access and retry.`)
  }

  // HTTP header values are byte strings. Escape Unicode file names in API arguments.
  const apiArg = (value: object) => JSON.stringify(value).replace(/[^\u0020-\u007e]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
  const metadata = (path: string) => rpc<Entry>('get_metadata', { path }, true)
  const asFile = (entry: Entry, path: string): File => {
    if (entry['.tag'] !== 'file' || !entry.id?.startsWith('id:') || !entry.rev || entry.path_lower !== path.toLowerCase()) {
      throw new Error('Dropbox returned a day with an invalid path or revision.')
    }
    return { ref: entry.id, revision: entry.rev, path }
  }

  const readDropboxRevision = async (path: string, revision: string) => {
    const response = await authorizedFetch(`${CONTENT}/download`, {
      method: 'POST', headers: { 'Dropbox-API-Arg': apiArg({ path: `rev:${revision}` }) },
    })
    if (!response.ok) throw new Error(`Dropbox could not read ${path} at its listed revision.`)
    return response.text()
  }

  const ensureFolder = async (path: string) => {
    let folder = await metadata(path)
    if (!folder) {
      try { folder = (await rpc<{ metadata: Entry }>('create_folder_v2', { path, autorename: false }))!.metadata }
      catch (error) {
        if (!(error instanceof DropboxConflict)) throw error
        folder = await metadata(path)
      }
    }
    if (folder?.['.tag'] !== 'folder' || !folder.id?.startsWith('id:')) throw new Error(`Dropbox notebook folder is unavailable at ${path}.`)
    return folder
  }

  const prepareDropboxDailyFolder = async (sourcePath: string) => {
    if (!/^\/(?:[^/]+\/)*[^/]+\.md$/i.test(sourcePath)) throw new Error('Set an absolute Dropbox Markdown path before upgrading.')
    const folder = await ensureFolder(`${sourcePath.slice(0, -3)}.rivolo-daily`)
    return folder.id
  }

  const requireFolder = async (ref: string) => {
    const folder = await metadata(ref)
    if (folder?.['.tag'] !== 'folder' || folder.id !== ref || !folder.path_display) throw new Error('Dropbox notebook folder is unavailable. Check its location and permissions.')
    return folder
  }

  const stat = async (folder: string, dayId: string) => {
    const root = await requireFolder(folder)
    const path = `${root.path_display}/${dayPath(dayId)}`
    const entry = await metadata(path)
    return entry ? asFile(entry, path) : null
  }

  const migrationMarker = (path: string) => `${path}/.rivolo-migrated`
  const migrationComplete = async (folder: string) => {
    const root = await requireFolder(folder)
    return (await metadata(migrationMarker(root.path_display)))?.['.tag'] === 'file'
  }
  const completeMigration = async (folder: string, guard: () => Promise<void>) => {
    const root = await requireFolder(folder)
    const path = migrationMarker(root.path_display)
    if ((await metadata(path))?.['.tag'] === 'file') return
    await guard()
    const response = await authorizedFetch(`${CONTENT}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': apiArg({ path, mode: 'add', autorename: false, strict_conflict: true }),
      },
      body: 'Rivolo daily sync\n',
    })
    if (!response.ok && !(response.status === 409 && (await metadata(path))?.['.tag'] === 'file')) {
      throw new Error('Dropbox could not record the daily sync upgrade. Retry sync.')
    }
  }

  type Page = { entries: Entry[]; has_more: boolean; cursor: string }
  return {
    prepareDropboxDailyFolder, readDropboxRevision, migrationComplete, completeMigration,
    stat,
    exists: async (ref: string) => Boolean(await metadata(ref)),
    assertFolder: async (folder: string) => { await requireFolder(folder) },
    inventory: async (folderId: string) => {
      const root = await requireFolder(folderId)
      const days = new Map<string, File>()
      let page = await rpc<Page>('list_folder', { path: folderId, recursive: true })
      const cursors = new Set<string>()
      for (;;) {
        if (!page || !Array.isArray(page.entries) || typeof page.has_more !== 'boolean') throw new Error('Dropbox inventory is incomplete.')
        for (const entry of page.entries) {
          const relative = entry.path_display?.slice(root.path_display.length + 1)
          const id = relative?.split('/').at(-1)?.slice(0, -3)
          if (isValidDayId(id ?? '') && relative === dayPath(id!)) {
            if (days.has(id!)) throw new Error('Dropbox returned a duplicate day path.')
            days.set(id!, asFile(entry, `${root.path_display}/${relative}`))
          }
        }
        if (!page.has_more) return days
        if (!page.cursor || cursors.has(page.cursor)) throw new Error('Dropbox returned an incomplete inventory cursor.')
        cursors.add(page.cursor)
        page = await rpc<Page>('list_folder/continue', { cursor: page.cursor })
      }
    },
    download: (file: File) => readDropboxRevision(file.path, file.revision),
    prepareWrite: async (folderId: string, id: string, current: File | null) => {
      let path = current?.path
      if (!path) {
        const root = (await requireFolder(folderId)).path_display
        const [year, month] = dayPath(id).split('/')
        await ensureFolder(`${root}/${year}`)
        await ensureFolder(`${root}/${year}/${month}`)
        path = `${root}/${dayPath(id)}`
      }
      const targetPath = path
      return async (content: string, guard: () => Promise<void>) => {
        await guard()
        const response = await authorizedFetch(`${CONTENT}/upload`, {
          method: 'POST', headers: {
            'Content-Type': 'application/octet-stream',
            'Dropbox-API-Arg': apiArg({
              path: targetPath, mode: current ? { '.tag': 'update', update: current.revision } : 'add',
              autorename: false, strict_conflict: true, mute: false,
            }),
          }, body: content,
        })
        if (response.status === 409) {
          const error = await response.json().catch(() => null) as { error_summary?: string } | null
          if (error?.error_summary?.startsWith('path/conflict')) throw new DropboxConflict()
        }
        if (!response.ok) throw new Error(`Dropbox could not upload ${id} (${response.status}).`)
        const entry = await response.json() as Omit<Entry, '.tag'>
        return asFile({ ...entry, '.tag': 'file' }, targetPath)
      }
    },
    remove: async (file: File, guard: () => Promise<void>) => {
      await guard()
      await rpc('delete_v2', { path: file.ref, parent_rev: file.revision })
    },
    isConflict: (error: unknown) => error instanceof DropboxConflict,
  }
}
