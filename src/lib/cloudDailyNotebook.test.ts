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
  let hideAfterLostReply = false
  let rejectWrite = false
  let hideSearch = false
  let hideDirect = false
  let raceDelete = false
  let loseTrash = false
  let advanceHead = false
  let rejectRetention = false
  let folderReplyLost = false
  let nextReservation = 0
  let incomplete = false
  const files: RecordFile[] = []
  const updates: string[] = []
  const create = (name: string, parent?: string, path?: string, properties?: Record<string, string>, id = `id:${files.length}`) => {
    const file = { id, name, parent, path, properties, revisions: [] }
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
    path_display: file.path, path_lower: file.path?.toLowerCase(), rev: version(file), server_modified: file.revisions.at(-1)?.modifiedTime,
  })
  const driveMeta = (file: RecordFile) => ({
    id: file.id, name: file.name, parents: file.parent ? [file.parent] : [],
    mimeType: file.revisions.length ? 'text/markdown' : 'application/vnd.google-apps.folder',
    version: version(file), headRevisionId: version(file), modifiedTime: file.revisions.at(-1)?.modifiedTime, trashed: file.trashed,
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
    if (ref === 'generateIds') return json({ ids: [`reserved-${++nextReservation}`] })
    const decoded = ref ? decodeURIComponent(ref) : undefined
    const file = decoded ? files.find((item) => item.id === decoded) : undefined
    if (revisions === 'revisions' && file) {
      if (!revisionId) {
        const listed = json({ revisions: file.revisions })
        if (advanceHead && file.revisions.length >= 3) {
          advanceHead = false
          const content = file.revisions.at(-1)!.text.trimEnd()
          revise(file, `${content}\n\nFollow-up`)
        }
        return listed
      }
      const revision = file.revisions.find((item) => item.id === revisionId)
      if (method === 'PATCH') {
        if (rejectRetention) {
          rejectRetention = false
          return json({}, 503)
        }
        expect(JSON.parse(String(init.body))).toEqual({ keepForever: true })
        return json(revision)
      }
      return new Response(revision?.text)
    }
    if (method === 'GET' && hideDirect && decoded?.startsWith('reserved-')) return json({}, 404)
    if (method === 'GET' && file) return url.searchParams.get('alt') === 'media'
      ? new Response(file.revisions.at(-1)?.text) : json(driveMeta(file))
    if (method === 'GET' && ref) return json({}, 404)
    if (method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      const parent = q.match(/'([^']+)' in parents/)?.[1]
      const dayId = q.match(/key='rivoloDay' and value='([^']+)'/)?.[1]
      if (hideSearch && (q.includes('rivoloDailySource') || q.includes('rivoloNotebook'))) return json({ files: [] })
      if (incomplete && q.includes('rivoloNotebook')) return json({ files: [], incompleteSearch: true })
      return json({ files: files.filter((item) => !item.trashed && item.parent === parent &&
        (q.includes('rivoloDailySource') ? item.properties?.rivoloDailySource
          : q.includes('rivoloNotebook') ? item.properties?.rivoloNotebook && (!dayId || item.properties.rivoloDay === dayId)
            : item.properties?.rivoloSync === 'primary')).map(driveMeta) })
    }
    if (method === 'PATCH' && file && url.searchParams.has('uploadType')) {
      if (rejectWrite) { rejectWrite = false; throw new TypeError('Request never reached Drive') }
      if (race) {
        race = false
        revise(file, day(today, 'Other device\n\nFirst'))
      }
      revise(file, String(init.body))
      updates.push(file.name)
      if (loseReply) {
      loseReply = false
      if (hideAfterLostReply) hideDirect = true
      throw new TypeError('Lost upload reply')
    }
      return json(driveMeta(file))
    }
    if (method === 'PATCH' && file) {
      const update = JSON.parse(String(init.body))
      if (update.appProperties) file.properties = { ...file.properties, ...update.appProperties }
      if (update.trashed && raceDelete) {
        raceDelete = false
        revise(file, day(today, 'Arrived during trash'))
      }
      if (typeof update.trashed === 'boolean') file.trashed = update.trashed
      if (update.trashed && loseTrash) { loseTrash = false; throw new TypeError('Lost trash reply') }
      return json(driveMeta(file))
    }
    if (method === 'POST' && url.searchParams.has('uploadType')) {
      const lines = String(init.body).split('\r\n')
      const meta = JSON.parse(lines[3])
      if (files.some((file) => file.id === meta.id)) return json({}, 409)
      const file = create(meta.name, meta.parents[0], undefined, meta.appProperties, meta.id)
      revise(file, lines.slice(7, -2).join('\r\n'))
      updates.push(file.name)
      if (loseReply) {
      loseReply = false
      if (hideAfterLostReply) hideDirect = true
      throw new TypeError('Lost upload reply')
    }
      return json(driveMeta(file))
    }
    if (method === 'POST') {
      const { id, name, parents, appProperties } = JSON.parse(String(init.body))
      if (files.some((file) => file.id === id)) return json({}, 409)
      const folder = create(name, parents[0], undefined, appProperties, id)
      if (folderReplyLost) {
        folderReplyLost = false
        hideDirect = true
        throw new TypeError('Lost folder reply')
      }
      return json(driveMeta(folder))
    }
    throw new Error(`Unhandled Drive operation ${method} ${url}`)
  })
  return {
    fetch, root, original, updates,
    changeOriginal: (content: string) => revise(original, content),
    race: () => { race = true },
    loseReply: (hideResult = false) => { loseReply = true; hideAfterLostReply = hideResult },
    rejectWrite: () => { rejectWrite = true },
    lag: (search: boolean, direct = false) => { hideSearch = search; hideDirect = direct },
    loseFolder: () => { folderReplyLost = true },
    folders: () => files.filter((file) => file.properties?.rivoloDailySource).length,
    raceDelete: () => { raceDelete = true },
    loseTrash: () => { loseTrash = true },
    advanceHead: () => { advanceHead = true },
    rejectRetention: () => { rejectRetention = true },
    trashDay: (id: string) => { files.find((file) => file.name === `${id}.md`)!.trashed = true },
    trashFolders: () => { for (const file of files) if (file.properties?.rivoloDailySource) file.trashed = true },
    reviseDay: (id: string, text: string) => revise(files.find((file) => file.name === `${id}.md`)!, text),
    incomplete: () => { incomplete = true },
    duplicate: (dayId: string, text: string) => {
      const existing = files.find((file) => file.name === `${dayId}.md`)!
      revise(create(existing.name, existing.parent, existing.path, existing.properties), text)
    },
    copies: (dayId: string) => files.filter((file) => !file.trashed && file.name === `${dayId}.md`).map((file) => file.revisions.at(-1)?.text),
    modifiedAt: (id: string) => Date.parse(files.find((file) => file.name === `${id}.md`)!.revisions.at(-1)!.modifiedTime),
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
    // Migration writes through the daily sync transaction and must share the
    // repository's date row IDs before the first local save.
    expect(await storage.db.queryAll('SELECT rowid, day_id FROM days_fts ORDER BY rowid')).toEqual([
      { rowid: 20261117, day_id: yesterday },
      { rowid: 20261118, day_id: today },
    ])
    expect(cloud.current(today)).toContain('First')
    expect(cloud.current(yesterday)).toContain('History')
    expect(cloud.original.revisions).toHaveLength(1)

    await storage.repository.saveDay(today, 'First\n\nMine', 'Notebook')
    expect((await storage.repository.searchDays('Mine')).map(({ day }) => day.dayId)).toEqual([today])
    cloud.updates.length = 0
    cloud.race()
    await sync.pushToSync()
    expect(cloud.current(today)).toContain('Other device')
    expect(cloud.current(today)).toContain('Mine')
    expect(cloud.updates.every((name) => name === `${today}.md`)).toBe(true)

    await storage.repository.saveDay(today, 'Other device\n\nFirst\n\nMine\n\nAfter retry', 'Notebook')
    cloud.loseReply()
    if (provider === 'dropbox') await expect(sync.pushToSync()).rejects.toThrow('Lost upload reply')
    else await sync.pushToSync()
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
    expect(targeted.days[0].updatedAt).toBeGreaterThan(0)
    expect(targeted.days[0].updatedAt).toBe(cloud.modifiedAt(yesterday))
    await hosted.add({ day_id: yesterday, content_md: 'From Agent access', operation_id: 'fixture-operation' })
    expect(cloud.current(yesterday)).toContain('From Agent access')
    expect(cloud.original.revisions.at(-1)?.text).not.toContain('From Agent access')

    await storage.repository.deleteDay(today)
    await sync.pushToSync()
    expect(cloud.current(today)).toBeUndefined()
    expect(cloud.current(yesterday)).toContain('History')

    const lateDay = '2026-11-20'
    cloud.changeOriginal([day(today, 'First'), day(yesterday, 'History\n\nAn edit from the old client'), day(lateDay, 'Synced from the old client after cutover')].join('\n\n'))
    closeStorage(storage)
    storage = await createStorage()
    await storage.settings.setJsonSetting('sync.state', { activeProvider: provider })
    await storage.settings.setJsonSetting(`${provider}.state`, {
      connected: true, accountId: 'alice', accountName: 'Alice',
      filePath: '/inbox.md', fileName: 'inbox.md', fileId: cloud.original.id, folderId: cloud.root.id,
    })
    vi.stubGlobal('fetch', cloud.fetch)
    await storage.repository.saveDay(lateDay, 'Synced from the old client after cutover', 'Notebook')
    await storage.repository.saveDay(yesterday, 'History\n\nAn edit from the old client', 'Notebook')
    await (await import('./sync')).migrateActiveNotebook()
    expect((await storage.repository.getDay(today))?.contentMd).toBeUndefined()
    expect((await storage.repository.getDay(yesterday))?.contentMd).toContain('From Agent access')
    expect((await storage.repository.getDay(yesterday))?.contentMd).toContain('An edit from the old client')
    expect(cloud.current(yesterday)).toContain('An edit from the old client')
    expect(cloud.current(today)).toBeUndefined()
    expect(cloud.current(lateDay)).toContain('Synced from the old client after cutover')
    expect((await storage.repository.getDay(lateDay))?.contentMd).toContain('Synced from the old client after cutover')
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

const startDrive = async (cloud: ReturnType<typeof makeCloud>) => {
  vi.stubGlobal('fetch', cloud.fetch)
  await storage.settings.setJsonSetting('sync.state', { activeProvider: 'google-drive' })
  await storage.settings.setJsonSetting('google-drive.state', {
    connected: true, accountId: 'alice', fileName: 'inbox.md', fileId: cloud.original.id, folderId: cloud.root.id,
  })
  return import('./sync')
}

// Routed Drive and the actual pending journal own recovery for commits whose
// HTTP reply or search result is missing. No retry can allocate another ID.
it('reuses folder and day IDs after lost create replies while search is stale', async () => {
  const cloud = makeCloud('google-drive')
  let sync = await startDrive(cloud)
  cloud.loseFolder()
  cloud.lag(true)
  await expect(sync.migrateActiveNotebook()).rejects.toThrow('Lost folder reply')

  storage = await reopenStorage(storage)
  sync = await import('./sync')
  cloud.lag(true)
  await sync.migrateActiveNotebook()
  expect(cloud.folders()).toBe(1)
  expect(cloud.copies(today)).toHaveLength(1)

  const next = '2026-11-19'
  await storage.repository.saveDay(next, 'Only once', 'Notebook')
  cloud.loseReply()
  cloud.lag(true, true)
  await expect(sync.pushToSync()).rejects.toThrow('Lost upload reply')
  storage = await reopenStorage(storage)
  sync = await import('./sync')
  // Both lookup routes are stale. A replay of the reserved ID gets 409.
  await expect(sync.pushToSync()).rejects.toThrow('reserved file')
  expect(cloud.copies(next)).toHaveLength(1)
  cloud.lag(true)
  await sync.pushToSync()
  expect(cloud.copies(next)).toHaveLength(1)
  expect(cloud.current(next)).toContain('Only once')
})

// The browser owns recognition of an applied pending upload. A failed
// request must not cause old remote revisions to be treated as conflicts.
it('keeps a later cloud deletion of text when the pending upload never landed', async () => {
  const cloud = makeCloud('google-drive')
  const sync = await startDrive(cloud)
  await sync.migrateActiveNotebook()
  await storage.repository.saveDay(today, 'First\n\nMine', 'Notebook')
  cloud.rejectWrite()
  await expect(sync.pushToSync()).rejects.toThrow('never reached Drive')
  cloud.reviseDay(today, day(today, 'First\n\nCall Bob'))
  cloud.reviseDay(today, day(today, 'First\n\nDone'))
  await sync.pushToSync()
  expect(cloud.current(today)).toContain('Done')
  expect(cloud.current(today)).toContain('Mine')
  expect(cloud.current(today)).not.toContain('Call Bob')
})

// The hosted writer owns repairs after its own append already took effect.
it('merges a concurrent Drive edit before acknowledging a single hosted append', async () => {
  const cloud = makeCloud('google-drive')
  const sync = await startDrive(cloud)
  await sync.migrateActiveNotebook()
  const { createHostedDailyNotes } = await import('../../mcp/hostedDailyNotes')
  const hosted = createHostedDailyNotes('google-drive', (await sync.getActiveProviderStatus()).notebookChannel!, cloud.fetch)
  cloud.race()
  await hosted.add({ day_id: today, content_md: 'Agent entry', operation_id: 'hosted-race' })
  expect(cloud.current(today)).toContain('Other device')
  expect(cloud.current(today)?.match(/Agent entry/g)).toHaveLength(1)
})

// A Drive trash race is recoverable and remains visible across auto retry.
it('restores a concurrently edited Drive day and keeps the deletion warning', async () => {
  const cloud = makeCloud('google-drive')
  const sync = await startDrive(cloud)
  await sync.migrateActiveNotebook()
  await storage.repository.deleteDay(today)
  cloud.raceDelete()
  await expect(sync.pushToSync()).rejects.toThrow('restored for review')
  expect(cloud.current(today)).toContain('Arrived during trash')
  await expect(sync.pushToSync()).rejects.toThrow('restored for review')
  expect(cloud.current(today)).toContain('Arrived during trash')
})

it('repairs a browser Drive upload even if the head has moved again', async () => {
  const cloud = makeCloud('google-drive')
  const sync = await startDrive(cloud)
  await sync.migrateActiveNotebook()
  await storage.repository.saveDay(today, 'First\n\nMine', 'Notebook')
  cloud.race()
  cloud.advanceHead()
  await sync.pushToSync()
  const text = cloud.current(today)
  expect(text).toContain('Other device')
  expect(text).toContain('Follow-up')
  expect(text?.match(/Mine/g)).toHaveLength(1)
  expect((await storage.repository.getDay(today))?.contentMd).toContain('Follow-up')
})

it('confirms an already completed Drive deletion after a lost reply', async () => {
  const cloud = makeCloud('google-drive')
  const sync = await startDrive(cloud)
  await sync.migrateActiveNotebook()
  await storage.repository.deleteDay(today)
  cloud.loseTrash()
  await expect(sync.pushToSync()).rejects.toThrow('could not verify deletion')
  expect(cloud.current(today)).toBeUndefined()
  await sync.pushToSync()
  expect(await sync.getActiveProviderStatus()).toMatchObject({ localDirty: false })
})

it('retires a trashed Drive reservation for a folder or day', async () => {
  const cloud = makeCloud('google-drive')
  const sync = await startDrive(cloud)
  cloud.loseFolder()
  cloud.lag(true)
  await expect(sync.migrateActiveNotebook()).rejects.toThrow('Lost folder reply')
  cloud.trashFolders()
  cloud.lag(true)
  await sync.migrateActiveNotebook()

  const next = '2026-11-19'
  await storage.repository.saveDay(next, 'Keep this edit', 'Notebook')
  cloud.loseReply()
  cloud.lag(true, true)
  await expect(sync.pushToSync()).rejects.toThrow('Lost upload reply')
  cloud.trashDay(next)
  cloud.lag(true)
  await sync.pushToSync()
  expect(cloud.copies(next)).toHaveLength(1)
  expect(cloud.current(next)).toContain('Keep this edit')
})

it('replays a confirmed browser race after restart without replaying unrelated revisions', async () => {
  const cloud = makeCloud('google-drive')
  let sync = await startDrive(cloud)
  await sync.migrateActiveNotebook()
  await storage.repository.saveDay(today, 'First\n\nMine', 'Notebook')
  cloud.race()
  cloud.rejectRetention()
  await expect(sync.pushToSync()).rejects.toThrow('could not retain')

  cloud.reviseDay(today, day(today, 'First\n\nMine\n\nFollow-up'))
  storage = await reopenStorage(storage)
  sync = await import('./sync')
  await sync.pushToSync()
  const text = cloud.current(today)
  expect(text).toContain('Other device')
  expect(text).toContain('Follow-up')
  expect(text?.match(/Mine/g)).toHaveLength(1)
})

it.each(['existing', 'created'] as const)('confirms the exact trashed Drive revision after losing the upload reply for a day that was %s', async (kind) => {
  const cloud = makeCloud('google-drive')
  const sync = await startDrive(cloud)
  await sync.migrateActiveNotebook()
  const id = kind === 'existing' ? today : '2026-11-19'
  await storage.repository.saveDay(id, 'Uploaded edit', 'Notebook')
  cloud.loseReply(true)
  await expect(sync.pushToSync()).rejects.toThrow('Lost upload reply')
  cloud.lag(false)
  await storage.repository.deleteDay(id)
  cloud.loseTrash()
  await expect(sync.pushToSync()).rejects.toThrow('could not verify deletion')
  expect(cloud.current(id)).toBeUndefined()
  await sync.pushToSync()
  expect(await sync.getActiveProviderStatus()).toMatchObject({ localDirty: false })
})

// The Drive retry owns recognizing the submitted bytes in history when the
// original reply and the first direct lookup could not identify the upload.
it('repairs a lost Drive upload reply after another device advances its head', async () => {
  const cloud = makeCloud('google-drive')
  let sync = await startDrive(cloud)
  await sync.migrateActiveNotebook()
  await storage.repository.saveDay(today, 'First\n\nMine', 'Notebook')
  cloud.race()
  cloud.loseReply(true)
  await expect(sync.pushToSync()).rejects.toThrow('Lost upload reply')
  cloud.lag(false)
  cloud.reviseDay(today, day(today, 'First\n\nMine\n\nFollow-up'))

  storage = await reopenStorage(storage)
  sync = await import('./sync')
  await sync.pushToSync()
  const text = cloud.current(today)
  expect(text).toContain('Other device')
  expect(text).toContain('Follow-up')
  expect(text?.match(/Mine/g)).toHaveLength(1)
  expect(await sync.getActiveProviderStatus()).toMatchObject({ localDirty: false })
})

it.each(['dropbox', 'google-drive'] as const)('preserves post-cutover legacy edits after a daily deletion on %s', async (provider) => {
  const cloud = makeCloud(provider)
  const connect = async () => {
    vi.stubGlobal('fetch', cloud.fetch)
    await storage.settings.setJsonSetting('sync.state', { activeProvider: provider })
    await storage.settings.setJsonSetting(`${provider}.state`, {
      connected: true, accountId: 'alice', filePath: '/inbox.md', fileName: 'inbox.md',
      fileId: cloud.original.id, folderId: cloud.root.id,
    })
    return import('./sync')
  }
  let sync = await connect()
  await sync.migrateActiveNotebook()
  await storage.repository.deleteDay(today)
  await sync.pushToSync()
  expect(cloud.current(today)).toBeUndefined()

  cloud.changeOriginal([day(today, 'First\n\nActual legacy edit'), day(yesterday, 'History')].join('\n\n'))
  closeStorage(storage)
  storage = await createStorage()
  sync = await connect()
  await storage.repository.saveDay(today, 'First', 'Notebook')
  await sync.migrateActiveNotebook()
  expect((await storage.repository.getDay(today))?.contentMd).toBe('First\n\nActual legacy edit')
  expect(cloud.current(today)).toContain('Actual legacy edit')
})
