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
const connectedState = {
  connected: true,
  fileId: null,
  folderId: null,
  fileName: 'inbox.md',
  lastRemoteVersion: null,
  lastPushedHash: null,
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
      folderId: 'folder-1',
      lastRemoteVersion: '1',
      localDirty: false,
    })
    expect(await getGoogleDriveStatus()).toMatchObject({ targetName: '/rivolo/inbox.md' })
  })

  it('blocks a push when the remote version changed', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      folderId: 'folder-1',
      lastRemoteVersion: '1',
    })
    // Resolving the file by id is enough to see the changed version — no folder
    // lookup and no separate re-check fetch.
    const fetchMock = vi.fn().mockResolvedValueOnce(json(driveFile('2')))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')

    expect(await pushToGoogleDrive()).toEqual({ status: 'blocked', reason: 'remote_changed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
      folderId: 'folder-1',
      lastRemoteVersion: '1',
      localDirty: false,
    })
    importMarkdownToDb.mockResolvedValue({ imported: 1, warnings: [] })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(driveFile('2')))
      .mockResolvedValueOnce(new Response('# 2026-06-21\n\nremote text'))
    vi.stubGlobal('fetch', fetchMock)
    const { pullFromGoogleDrive } = await import('./googleDrive')
    const { getGoogleDriveState } = await import('./googleDriveState')
    const { getDropboxState } = await import('./dropboxState')

    expect(await pullFromGoogleDrive()).toEqual({ status: 'pulled' })
    expect(importMarkdownToDb).toHaveBeenCalledWith('# 2026-06-21\n\nremote text', {
      replace: true,
      markDirty: false,
      allowUnsafeImport: undefined,
    })
    expect(await getGoogleDriveState()).toMatchObject({ lastRemoteVersion: '2', localDirty: false })
    expect(await getDropboxState()).toMatchObject({ localDirty: true })
  })

  it('does not pull over dirty local notes without force', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      folderId: 'folder-1',
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
      folderId: 'folder-1',
      lastRemoteVersion: '1',
      localDirty: true,
    })
    importMarkdownToDb.mockResolvedValue({ imported: 1, warnings: [] })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(driveFile('1')))
      .mockResolvedValueOnce(new Response('# 2026-06-21\n\nremote text'))
    vi.stubGlobal('fetch', fetchMock)
    const { pullFromGoogleDrive } = await import('./googleDrive')
    const { getGoogleDriveState } = await import('./googleDriveState')

    expect(await pullFromGoogleDrive({ force: true })).toEqual({ status: 'pulled' })
    expect(importMarkdownToDb).toHaveBeenCalledWith('# 2026-06-21\n\nremote text', {
      replace: true,
      markDirty: false,
      allowUnsafeImport: undefined,
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
      .mockResolvedValueOnce(json(driveFile('1', ['root'])))
      .mockResolvedValueOnce(json({ files: [driveFolder] }))
      .mockResolvedValueOnce(json(driveFile('2', ['folder-1'])))
      .mockResolvedValueOnce(json(driveFile('3', ['folder-1'])))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')

    expect(await pushToGoogleDrive()).toEqual({ status: 'pushed' })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/files/file-1?fields=')
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('addParents=folder-1')
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('removeParents=root')
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain('uploadType=media')
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
      .mockResolvedValueOnce(json(driveFile('1', ['root'])))
      .mockResolvedValueOnce(json({ files: [driveFolder] }))
      .mockResolvedValueOnce(json(driveFile('2', ['folder-1'])))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')
    const { getGoogleDriveState } = await import('./googleDriveState')

    expect(await pushToGoogleDrive()).toEqual({ status: 'pushed' })
    expect(exportMarkdownFromDb).not.toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('addParents=folder-1')
    expect(await getGoogleDriveState()).toMatchObject({ lastRemoteVersion: '2', localDirty: false })
  })

  it('uploads a changed file via the cached folder in two round trips', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      folderId: 'folder-1',
      lastRemoteVersion: '1',
    })
    exportMarkdownFromDb.mockResolvedValue('# 2026-06-21\n\nlocal edit')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(driveFile('1')))
      .mockResolvedValueOnce(json(driveFile('2')))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')

    expect(await pushToGoogleDrive()).toEqual({ status: 'pushed' })
    // Fetch the file by id, then upload — no folder lookup, no re-check fetch.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/files/file-1?fields=')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('uploadType=media')
  })

  it('skips the upload when the content matches the last push', async () => {
    const { hashSyncContent } = await import('./syncHash')
    const content = '# 2026-06-21\n\nunchanged'
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      folderId: 'folder-1',
      lastRemoteVersion: '1',
      lastPushedHash: await hashSyncContent(content),
    })
    exportMarkdownFromDb.mockResolvedValue(content)
    const fetchMock = vi.fn().mockResolvedValueOnce(json(driveFile('1')))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')
    const { getGoogleDriveState } = await import('./googleDriveState')

    expect(await pushToGoogleDrive()).toEqual({ status: 'clean' })
    // Only the metadata fetch happens; the 130KB upload is skipped entirely.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await getGoogleDriveState()).toMatchObject({ localDirty: false, lastRemoteVersion: '1' })
  })

  it('force-uploads over a changed remote without blocking', async () => {
    settings.set('google-drive.state', {
      ...connectedState,
      fileId: 'file-1',
      folderId: 'folder-1',
      lastRemoteVersion: '1',
      localDirty: false,
    })
    exportMarkdownFromDb.mockResolvedValue('# 2026-06-21\n\nrestored local copy')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(driveFile('2')))
      .mockResolvedValueOnce(json(driveFile('3')))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToGoogleDrive } = await import('./googleDrive')

    expect(await pushToGoogleDrive(true)).toEqual({ status: 'pushed' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('uploadType=media')
  })
})
