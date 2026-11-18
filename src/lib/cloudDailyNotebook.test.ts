// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeStorage, createStorage, reopenStorage, type Storage } from '../test/helpers/storage'

vi.mock('./dropboxAuth', () => ({ authorizedDropboxFetch: (url: string, init?: RequestInit) => fetch(url, init) }))
vi.mock('./googleDriveAuth', () => ({ authorizedGoogleDriveFetch: (url: string, init?: RequestInit) => fetch(url, init) }))

const today = '2026-11-18'
const yesterday = '2026-11-17'
const day = (id: string, body: string) => `<!-- day:${id} -->\nNotebook\n---\n\n${body}`
const legacy = `${day(today, 'First')}\n\n${day(yesterday, 'History')}`
const json = (body: unknown, status = 200) => Response.json(body, { status })

type RecordFile = {
  id: string
  name: string
  parent?: string
  path?: string
  properties?: Record<string, string>
  revisions: { id: string; text: string; modifiedTime: string }[]
  trashed?: boolean
}
const makeCloud = (provider: 'dropbox' | 'google-drive') => {
  let tick = 0
  let race = false
  let loseReply = false
  let incomplete = false
  const files: RecordFile[] = []
  const updates: string[] = []
  const create = (name: string, parent?: string, path?: string, properties?: Record<string, string>) => {
    const file = { id: `id:${files.length}`, name, parent, path, properties, revisions: [] }
    files.push(file)
    return file
  }
  const revise = (file: RecordFile, text: string) => {
    const revision = { id: `rev-${++tick}`, text, modifiedTime: new Date(tick * 1000).toISOString() }
    file.revisions.push(revision)
    return revision
  }
  const root = create('rivolo')
  const original = create('inbox.md', root.id, '/inbox.md', { rivoloSync: 'primary' })
  revise(original, legacy)
  const version = (file: RecordFile) => file.revisions.at(-1)?.id
  const dropboxMeta = (file: RecordFile) => ({
    '.tag': file.revisions.length ? 'file' : 'folder', id: file.id,
    path_display: file.path, path_lower: file.path?.toLowerCase(), rev: version(file),
  })
  const driveMeta = (file: RecordFile) => ({
    id: file.id, name: file.name, parents: file.parent ? [file.parent] : [],
    mimeType: file.revisions.length ? 'text/markdown' : 'application/vnd.google-apps.folder',
    version: version(file), headRevisionId: version(file), trashed: file.trashed,
    appProperties: file.properties,
  })
  const find = (ref: string) => {
    const parent = files.find((file) => ref.startsWith(file.id + '/'))
    const path = parent ? parent.path + ref.slice(parent.id.length) : ref
    return files.find((file) => !file.trashed && (file.id === ref || file.path === path))
  }
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    if (provider === 'dropbox') {
      const action = url.pathname.split('/').at(-1)
      const body = (action === 'upload' || action === 'download')
        ? JSON.parse(new Headers(init.headers).get('Dropbox-API-Arg')!)
        : JSON.parse(String(init.body))
      const file = find(body.path)
      const missing = () => json({ error_summary: 'path/not_found/' }, 409)
      if (action === 'get_metadata') return file ? json(dropboxMeta(file)) : missing()
      if (action === 'create_folder_v2') return json({ metadata: dropboxMeta(create(body.path.split('/').at(-1), undefined, body.path)) })
      if (action === 'list_folder') return json({
        entries: files.filter((candidate) => !candidate.trashed && candidate.path?.startsWith(file!.path + '/')).map(dropboxMeta),
        has_more: false, cursor: 'done',
      })
      if (action === 'download') {
        const revision = files.flatMap((item) => item.revisions).find((item) => `rev:${item.id}` === body.path)
        return revision ? new Response(revision.text) : missing()
      }
      if (action === 'upload') {
        if (race && file) {
          race = false
          revise(file, day(today, 'Other device\n\nFirst'))
        }
        if (file && version(file) !== body.mode.update) return json({ error_summary: 'path/conflict/file/' }, 409)
        const written = file ?? create(body.path.split('/').at(-1), undefined, body.path)
        revise(written, String(init.body))
        updates.push(written.name)
        if (loseReply) { loseReply = false; throw new TypeError('Lost upload reply') }
        return json(dropboxMeta(written))
      }
      if (action === 'delete_v2' && file && version(file) === body.parent_rev) {
        file.trashed = true
        return json({ metadata: dropboxMeta(file) })
      }
      throw new Error(`Unhandled Dropbox operation ${action}`)
    }

    const [, , , , ref, revisions, revisionId] = url.pathname.replace('/upload', '').split('/')
    const file = ref ? find(decodeURIComponent(ref)) : undefined
    if (revisions === 'revisions' && file) {
      if (!revisionId) return json({ revisions: file.revisions })
      const revision = file.revisions.find((item) => item.id === revisionId)
      if (method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({ keepForever: true })
        return json(revision)
      }
      return new Response(revision?.text)
    }
    if (method === 'GET' && file) return url.searchParams.get('alt') === 'media'
      ? new Response(file.revisions.at(-1)?.text) : json(driveMeta(file))
    if (method === 'GET' && ref) return json({}, 404)
    if (method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      const parent = q.match(/'([^']+)' in parents/)?.[1]
      const dayId = q.match(/key='rivoloDay' and value='([^']+)'/)?.[1]
      if (incomplete && q.includes('rivoloNotebook')) return json({ files: [], incompleteSearch: true })
      return json({ files: files.filter((item) => !item.trashed && item.parent === parent &&
        (q.includes('rivoloDailySource') ? item.properties?.rivoloDailySource
          : q.includes('rivoloNotebook') ? item.properties?.rivoloNotebook && (!dayId || item.properties.rivoloDay === dayId)
            : item.properties?.rivoloSync === 'primary')).map(driveMeta) })
    }
    if (method === 'PATCH' && file && url.searchParams.has('uploadType')) {
      if (race) {
        race = false
        revise(file, day(today, 'Other device\n\nFirst'))
      }
      revise(file, String(init.body))
      updates.push(file.name)
      if (loseReply) { loseReply = false; throw new TypeError('Lost upload reply') }
      return json(driveMeta(file))
    }
    if (method === 'PATCH' && file) {
      const update = JSON.parse(String(init.body))
      if (update.appProperties) file.properties = { ...file.properties, ...update.appProperties }
      if (update.trashed) file.trashed = true
      return json(driveMeta(file))
    }
    if (method === 'POST' && url.searchParams.has('uploadType')) {
      const lines = String(init.body).split('\r\n')
      const meta = JSON.parse(lines[3])
      const file = create(meta.name, meta.parents[0], undefined, meta.appProperties)
      revise(file, lines.slice(7, -2).join('\r\n'))
      updates.push(file.name)
      return json(driveMeta(file))
    }
    if (method === 'POST') {
      const { name, parents, appProperties } = JSON.parse(String(init.body))
      return json(driveMeta(create(name, parents[0], undefined, appProperties)))
    }
    throw new Error(`Unhandled Drive operation ${method} ${url}`)
  })
  return {
    fetch, root, original, updates,
    changeOriginal: (content: string) => revise(original, content),
    race: () => { race = true },
    loseReply: () => { loseReply = true },
    incomplete: () => { incomplete = true },
    duplicate: (dayId: string, text: string) => {
      const existing = files.find((file) => file.name === `${dayId}.md`)!
      revise(create(existing.name, existing.parent, existing.path, existing.properties), text)
    },
    copies: (dayId: string) => files.filter((file) => !file.trashed && file.name === `${dayId}.md`).map((file) => file.revisions.at(-1)?.text),
    current: (id: string) => files.find((file) => !file.trashed && file.name === `${id}.md`)?.revisions.at(-1)?.text,
  }
}

let storage: Storage
beforeEach(async () => { storage = await createStorage() })
afterEach(() => closeStorage(storage))

// Provider HTTP adapters and the real SQLite repository own migration,
// competing writes, lost replies, incremental writes, and reconnect recovery.
describe.each(['dropbox', 'google-drive'] as const)('%s daily sync', (provider) => {
  it('migrates safely, preserves the original, reconciles old and concurrent writers, and removes a single day', async () => {
    const cloud = makeCloud(provider)
    vi.stubGlobal('fetch', cloud.fetch)
    await storage.settings.setJsonSetting('sync.state', { activeProvider: provider })
    await storage.settings.setJsonSetting(`${provider}.state`, {
      connected: true, accountId: 'alice', accountName: 'Alice',
      filePath: '/inbox.md', fileName: 'inbox.md', fileId: cloud.original.id, folderId: cloud.root.id,
    })
    let sync = await import('./sync')
    await sync.migrateActiveNotebook()
    expect(await sync.getActiveProviderStatus()).toMatchObject({ daily: true, localDirty: false })
    expect(cloud.current(today)).toContain('First')
    expect(cloud.current(yesterday)).toContain('History')
    expect(cloud.original.revisions).toHaveLength(1)

    await storage.repository.saveDay(today, 'First\n\nMine', 'Notebook')
    cloud.updates.length = 0
    cloud.race()
    if (provider === 'google-drive') await expect(sync.pushToSync()).rejects.toThrow('changed during upload')
    await sync.pushToSync()
    expect(cloud.current(today)).toContain('Other device')
    expect(cloud.current(today)).toContain('Mine')
    const { readNotebookAttribution } = await import('./oneDriveBlame')
    const attribution = (await readNotebookAttribution(cloud.current(today)!, today)).get(today)
    expect(attribution?.at(-1)?.author).toBe('Alice')
    expect(cloud.updates.every((name) => name === `${today}.md`)).toBe(true)

    await storage.repository.saveDay(today, 'Other device\n\nFirst\n\nMine\n\nAfter retry', 'Notebook')
    cloud.loseReply()
    await expect(sync.pushToSync()).rejects.toThrow('Lost upload reply')
    storage = await reopenStorage(storage)
    sync = await import('./sync')
    await sync.pushToSync()
    expect(cloud.current(today)?.match(/After retry/g)).toHaveLength(1)

    cloud.changeOriginal(`${day(today, 'First\n\nFrom an older client')}\n\n${day(yesterday, 'History')}`)
    await sync.pullFromSync()
    expect((await storage.repository.getDay(today))?.contentMd).toContain('From an older client')
    expect(cloud.current(today)).toContain('From an older client')
    expect(cloud.current(today)).toContain('After retry')

    // Hosted tools address the same daily target and preserve the legacy file.
    const { createHostedDailyNotes } = await import('../../mcp/hostedDailyNotes')
    const folder = (await sync.getActiveProviderStatus()).notebookChannel!
    const hosted = createHostedDailyNotes(provider, folder, cloud.fetch)
    const targeted = await hosted.loadNotes({ dateFrom: yesterday, dateTo: yesterday })
    expect(targeted.days.map((note) => note.dayId)).toEqual([yesterday])
    await hosted.add({ day_id: yesterday, content_md: 'From Agent access', operation_id: 'fixture-operation' })
    expect(cloud.current(yesterday)).toContain('From Agent access')
    expect(cloud.original.revisions.at(-1)?.text).not.toContain('From Agent access')

    await storage.repository.deleteDay(today)
    await sync.pushToSync()
    expect(cloud.current(today)).toBeUndefined()
    expect(cloud.current(yesterday)).toContain('History')

    closeStorage(storage)
    storage = await createStorage()
    await storage.settings.setJsonSetting('sync.state', { activeProvider: provider })
    await storage.settings.setJsonSetting(`${provider}.state`, {
      connected: true, accountId: 'alice', accountName: 'Alice',
      filePath: '/inbox.md', fileName: 'inbox.md', fileId: cloud.original.id, folderId: cloud.root.id,
    })
    vi.stubGlobal('fetch', cloud.fetch)
    await (await import('./sync')).migrateActiveNotebook()
    expect((await storage.repository.getDay(today))?.contentMd).toBeUndefined()
    expect((await storage.repository.getDay(yesterday))?.contentMd).toContain('From Agent access')
    expect(cloud.current(today)).toBeUndefined()
  })
})

it('preserves both Drive copies and local days when the inventory is ambiguous', async () => {
  const cloud = makeCloud('google-drive')
  vi.stubGlobal('fetch', cloud.fetch)
  await storage.settings.setJsonSetting('sync.state', { activeProvider: 'google-drive' })
  await storage.settings.setJsonSetting('google-drive.state', {
    connected: true, accountId: 'alice', fileName: 'inbox.md', fileId: cloud.original.id, folderId: cloud.root.id,
  })
  const sync = await import('./sync')
  await sync.migrateActiveNotebook()
  cloud.duplicate(today, day(today, 'Other device copy'))
  await expect(sync.pullFromSync()).rejects.toThrow('more than one file')
  expect(cloud.copies(today)).toHaveLength(2)
  expect(cloud.copies(today)[1]).toContain('Other device copy')
  expect((await storage.repository.getDay(today))?.contentMd).toContain('First')

  cloud.incomplete()
  await expect(sync.pullFromSync()).rejects.toThrow('incomplete listing')
  expect((await storage.repository.getDay(yesterday))?.contentMd).toBe('History')
})
