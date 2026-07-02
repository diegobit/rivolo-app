import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = new Map<string, unknown>()
const importMarkdownToDb = vi.fn()
const exportMarkdownFromDb = vi.fn()

vi.mock('./settingsRepository', () => ({
  getJsonSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
  setJsonSetting: vi.fn(async (key: string, value: unknown) => {
    settings.set(key, structuredClone(value))
  }),
}))

vi.mock('./importExport', () => ({ importMarkdownToDb, exportMarkdownFromDb }))
vi.mock('./googleDriveAuth', () => ({
  authorizedGoogleDriveFetch: (input: string, init?: RequestInit) => fetch(input, init),
  disconnectGoogleDriveAuth: vi.fn(),
}))

const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init)
const driveFolder = {
  id: 'folder-1',
  name: 'rivolo',
  mimeType: 'application/vnd.google-apps.folder',
  version: '1',
}
const driveFile = (version: string, parents = ['folder-1']) => ({
  id: 'file-1',
  name: 'inbox.md',
  mimeType: 'text/markdown',
  version,
  parents,
  capabilities: { canDownload: true, canEdit: true, canModifyContent: true },
})
const driveFileResponse = (
  version: string,
  parents = ['folder-1'],
  etag = `"drive-${version}"`,
  init: ResponseInit = {},
) => {
  const headers = new Headers(init.headers)
  headers.set('ETag', etag)
  return json(driveFile(version, parents), { ...init, headers })
}
const requestHeader = (init: RequestInit | undefined, name: string) => new Headers(init?.headers).get(name)
const connectedState = {
  connected: true,
  fileId: null,
  fileName: 'inbox.md',
  lastRemoteVersion: null,
  lastSyncAt: null,
  localDirty: true,
  localRevision: 1,
  accountId: 'account',
  accountEmail: 'person@example.com',
  accountName: 'Person',
}

describe('Google Drive sync provider', () => {
  beforeEach(() => {
    settings.clear()
    settings.set('google-drive.state', structuredClone(connectedState))
    importMarkdownToDb.mockReset()
    exportMarkdownFromDb.mockReset()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('creates the managed folder and Markdown file on the first dirty push', async () => {
    exportMarkdownFromDb.mockResolvedValue('# 2026-06-21\n\nhello')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json(driveFolder))
      .mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json(driveFile('1')))
    vi.stubGlobal('fetch', fetchMock)
    const { getGoogleDriveStatus, pushToGoogleDrive } = await import('./googleDrive')
    const { getGoogleDriveState } = await import('./googleDriveState')

    expect(await pushToGoogleDrive()).toEqual({ status: 'pushed' })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      name: 'rivolo',
      mimeType: 'application/vnd.google-apps.folder',
    })
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("%27folder-1%27+in+parents")
    expect(String(fetchMock.mock.calls[3]?.[1]?.body)).toContain('"parents":["folder-1"]')
    expect(String(fetchMock.mock.calls[3]?.[1]?.body)).toContain('# 2026-06-21')
    expect(await getGoogleDriveState()).toMatchObject({
      fileId: 'file-1',
      lastRemoteVersion: '1',
      localDirty: false,
    })
    expect(await getGoogleDriveStatus()).toMatchObject({ targetName: '/rivolo/inbox.md' })
  })

  it('blocks a push when the remote version changed', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      lastRemoteVersion: '1',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(json({ files: [driveFolder] })).mockResolvedValueOnce(driveFileResponse('2')),
    )
    const { pushToGoogleDrive } = await import('./googleDrive')

    expect(await pushToGoogleDrive()).toEqual({ status: 'blocked', reason: 'remote_changed' })
    expect(exportMarkdownFromDb).not.toHaveBeenCalled()
  })

  it('keeps an edit made during upload dirty', async () => {
    exportMarkdownFromDb.mockImplementation(async () => {
      const { markGoogleDriveLocalDirty } = await import('./googleDriveState')
      await markGoogleDriveLocalDirty()
      return '# 2026-06-21\n\nfirst version'
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json(driveFolder))
      .mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json(driveFile('1')))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')
    const { getGoogleDriveState } = await import('./googleDriveState')

    await pushToGoogleDrive()
    expect(await getGoogleDriveState()).toMatchObject({ localRevision: 2, localDirty: true })
  })

  it('pulls a newer remote file and marks the other provider stale', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      lastRemoteVersion: '1',
      localDirty: false,
    })
    importMarkdownToDb.mockResolvedValue({ imported: 1, warnings: [] })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [driveFolder] }))
      .mockResolvedValueOnce(driveFileResponse('2'))
      .mockResolvedValueOnce(new Response('# 2026-06-21\n\nremote text'))
    vi.stubGlobal('fetch', fetchMock)
    const { pullFromGoogleDrive } = await import('./googleDrive')
    const { getGoogleDriveState } = await import('./googleDriveState')
    const { getDropboxState } = await import('./dropboxState')

    expect(await pullFromGoogleDrive()).toEqual({ status: 'pulled' })
    expect(importMarkdownToDb).toHaveBeenCalledWith('# 2026-06-21\n\nremote text', {
      replace: true,
      markDirty: false,
      allowDestructiveReplace: undefined,
    })
    expect(await getGoogleDriveState()).toMatchObject({ lastRemoteVersion: '2', localDirty: false })
    expect(await getDropboxState()).toMatchObject({ localDirty: true })
  })

  it('does not pull over dirty local notes without force', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      lastRemoteVersion: '1',
      localDirty: true,
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { pullFromGoogleDrive } = await import('./googleDrive')
    const { getGoogleDriveState } = await import('./googleDriveState')

    expect(await pullFromGoogleDrive()).toEqual({ status: 'noop' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(importMarkdownToDb).not.toHaveBeenCalled()
    expect(await getGoogleDriveState()).toMatchObject({ localDirty: true, lastRemoteVersion: '1' })
  })

  it('pulls over dirty local notes when forced', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      lastRemoteVersion: '1',
      localDirty: true,
    })
    importMarkdownToDb.mockResolvedValue({ imported: 1, warnings: [] })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [driveFolder] }))
      .mockResolvedValueOnce(json(driveFile('1')))
      .mockResolvedValueOnce(new Response('# 2026-06-21\n\nremote text'))
    vi.stubGlobal('fetch', fetchMock)
    const { pullFromGoogleDrive } = await import('./googleDrive')
    const { getGoogleDriveState } = await import('./googleDriveState')

    expect(await pullFromGoogleDrive({ force: true })).toEqual({ status: 'pulled' })
    expect(importMarkdownToDb).toHaveBeenCalledWith('# 2026-06-21\n\nremote text', {
      replace: true,
      markDirty: false,
    })
    expect(await getGoogleDriveState()).toMatchObject({ localDirty: false, lastRemoteVersion: '1' })
  })

  it('moves a previously tracked root file into the managed folder before uploading', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      lastRemoteVersion: '1',
    })
    exportMarkdownFromDb.mockResolvedValue('# 2026-06-21\n\nhello')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [driveFolder] }))
      .mockResolvedValueOnce(driveFileResponse('1', ['root'], '"drive-1"'))
      .mockResolvedValueOnce(driveFileResponse('2', ['folder-1'], '"drive-2"'))
      .mockResolvedValueOnce(driveFileResponse('3', ['folder-1'], '"drive-3"'))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')

    expect(await pushToGoogleDrive()).toEqual({ status: 'pushed' })
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('addParents=folder-1')
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('removeParents=root')
    expect(requestHeader(fetchMock.mock.calls[2]?.[1], 'If-Match')).toBe('"drive-1"')
    expect(requestHeader(fetchMock.mock.calls[3]?.[1], 'If-Match')).toBe('"drive-2"')
  })

  it('moves an unchanged tracked root file on a manual push', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      lastRemoteVersion: '1',
      localDirty: false,
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [driveFolder] }))
      .mockResolvedValueOnce(driveFileResponse('1', ['root'], '"drive-1"'))
      .mockResolvedValueOnce(driveFileResponse('2', ['folder-1'], '"drive-2"'))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')
    const { getGoogleDriveState } = await import('./googleDriveState')

    expect(await pushToGoogleDrive()).toEqual({ status: 'pushed' })
    expect(exportMarkdownFromDb).not.toHaveBeenCalled()
    expect(requestHeader(fetchMock.mock.calls[2]?.[1], 'If-Match')).toBe('"drive-1"')
    expect(await getGoogleDriveState()).toMatchObject({ lastRemoteVersion: '2', localDirty: false })
  })

  it('uses If-Match when uploading over a tracked Google Drive file', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      lastRemoteVersion: '1',
    })
    exportMarkdownFromDb.mockResolvedValue('# 2026-06-21\n\nlocal edit')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [driveFolder] }))
      .mockResolvedValueOnce(driveFileResponse('1', ['folder-1'], '"drive-1"'))
      .mockResolvedValueOnce(driveFileResponse('2', ['folder-1'], '"drive-2"'))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')

    expect(await pushToGoogleDrive()).toEqual({ status: 'pushed' })
    expect(requestHeader(fetchMock.mock.calls[2]?.[1], 'If-Match')).toBe('"drive-1"')
  })

  it('maps a Google Drive conditional upload failure to remote_changed', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      lastRemoteVersion: '1',
    })
    exportMarkdownFromDb.mockResolvedValue('# 2026-06-21\n\nlocal edit')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [driveFolder] }))
      .mockResolvedValueOnce(driveFileResponse('1', ['folder-1'], '"drive-1"'))
      .mockResolvedValueOnce(json({ error: { message: 'Precondition failed.' } }, { status: 412 }))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')
    const { getGoogleDriveState } = await import('./googleDriveState')

    expect(await pushToGoogleDrive()).toEqual({ status: 'blocked', reason: 'remote_changed' })
    expect(requestHeader(fetchMock.mock.calls[2]?.[1], 'If-Match')).toBe('"drive-1"')
    expect(await getGoogleDriveState()).toMatchObject({
      lastRemoteVersion: '1',
      localDirty: true,
    })
  })

  it('falls back to a version re-check when metadata has no ETag', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      lastRemoteVersion: '1',
    })
    exportMarkdownFromDb.mockResolvedValue('# 2026-06-21\n\nlocal edit')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [driveFolder] }))
      .mockResolvedValueOnce(json(driveFile('1')))
      .mockResolvedValueOnce(json(driveFile('1')))
      .mockResolvedValueOnce(json(driveFile('2')))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')

    expect(await pushToGoogleDrive()).toEqual({ status: 'pushed' })
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/files/file-1?fields=')
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain('uploadType=media')
    expect(requestHeader(fetchMock.mock.calls[3]?.[1], 'If-Match')).toBeNull()
  })

  it('blocks a no-ETag push when the version re-check detects a remote change', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      lastRemoteVersion: '1',
    })
    exportMarkdownFromDb.mockResolvedValue('# 2026-06-21\n\nlocal edit')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [driveFolder] }))
      .mockResolvedValueOnce(json(driveFile('1')))
      .mockResolvedValueOnce(json(driveFile('2')))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')
    const { getGoogleDriveState } = await import('./googleDriveState')

    expect(await pushToGoogleDrive()).toEqual({ status: 'blocked', reason: 'remote_changed' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(await getGoogleDriveState()).toMatchObject({ lastRemoteVersion: '1', localDirty: true })
  })

  it('skips the version re-check on force uploads without an ETag', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      lastRemoteVersion: '1',
      localDirty: false,
    })
    exportMarkdownFromDb.mockResolvedValue('# 2026-06-21\n\nrestored local copy')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [driveFolder] }))
      .mockResolvedValueOnce(json(driveFile('2')))
      .mockResolvedValueOnce(json(driveFile('3')))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')

    expect(await pushToGoogleDrive(true)).toEqual({ status: 'pushed' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('uploadType=media')
  })

  it('omits If-Match on force uploads', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      lastRemoteVersion: '1',
      localDirty: false,
    })
    exportMarkdownFromDb.mockResolvedValue('# 2026-06-21\n\nrestored local copy')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [driveFolder] }))
      .mockResolvedValueOnce(driveFileResponse('2', ['folder-1'], '"drive-2"'))
      .mockResolvedValueOnce(driveFileResponse('3', ['folder-1'], '"drive-3"'))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')

    expect(await pushToGoogleDrive(true)).toEqual({ status: 'pushed' })
    expect(requestHeader(fetchMock.mock.calls[2]?.[1], 'If-Match')).toBeNull()
  })
})
