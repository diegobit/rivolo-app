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
vi.mock('./dropboxAuth', () => ({
  authorizedDropboxFetch: (input: string, init?: RequestInit) => fetch(input, init),
  disconnectDropboxAuth: vi.fn(),
  startDropboxAuth: vi.fn(),
  completeDropboxAuth: vi.fn(),
}))

const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init)
const connectedState = {
  connected: true,
  filePath: '/inbox.md',
  lastRemoteRev: 'rev-1',
  lastPushedHash: null,
  lastSyncAt: null,
  localDirty: true,
  localRevision: 1,
  accountId: 'account',
  accountEmail: 'person@example.com',
  accountName: 'Person',
}

describe('Dropbox sync provider', () => {
  beforeEach(() => {
    settings.clear()
    settings.set('dropbox.state', structuredClone(connectedState))
    importMarkdownToDb.mockReset()
    exportMarkdownFromDb.mockReset()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('does not pull over dirty local notes without force', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { pullFromDropbox } = await import('./dropbox')
    const { getDropboxState } = await import('./dropboxState')

    expect(await pullFromDropbox()).toEqual({ status: 'noop' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(importMarkdownToDb).not.toHaveBeenCalled()
    expect(await getDropboxState()).toMatchObject({ localDirty: true, lastRemoteRev: 'rev-1' })
  })

  it('pulls over dirty local notes when forced', async () => {
    importMarkdownToDb.mockResolvedValue({ imported: 1, warnings: [] })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ rev: 'rev-1', server_modified: '2026-06-21T10:00:00Z' }))
      .mockResolvedValueOnce(new Response('# 2026-06-21\n\nremote text'))
    vi.stubGlobal('fetch', fetchMock)
    const { pullFromDropbox } = await import('./dropbox')
    const { getDropboxState } = await import('./dropboxState')

    expect(await pullFromDropbox({ force: true })).toMatchObject({ status: 'pulled' })
    expect(importMarkdownToDb).toHaveBeenCalledWith('# 2026-06-21\n\nremote text', {
      replace: true,
      markDirty: false,
      allowUnsafeImport: undefined,
    })
    expect(await getDropboxState()).toMatchObject({ localDirty: false, lastRemoteRev: 'rev-1' })
  })

  it('blocks a dirty first push onto an existing remote file', async () => {
    settings.set('dropbox.state', { ...structuredClone(connectedState), lastRemoteRev: null })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ rev: 'rev-9', server_modified: '2026-06-21T10:00:00Z' }))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToDropbox } = await import('./dropbox')

    expect(await pushToDropbox()).toMatchObject({ status: 'blocked', reason: 'remote_changed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(exportMarkdownFromDb).not.toHaveBeenCalled()
  })

  it('maps a Dropbox upload conflict to remote_changed', async () => {
    exportMarkdownFromDb.mockResolvedValue('# 2026-06-21\n\nlocal edit')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ rev: 'rev-1', server_modified: '2026-06-21T10:00:00Z' }))
      .mockResolvedValueOnce(json({ error_summary: 'path/conflict/file/..' }, { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToDropbox } = await import('./dropbox')
    const { getDropboxState } = await import('./dropboxState')

    expect(await pushToDropbox()).toEqual({ status: 'blocked', reason: 'remote_changed' })
    expect(await getDropboxState()).toMatchObject({ localDirty: true, lastRemoteRev: 'rev-1' })
  })

  it('skips the upload when the content matches the last push', async () => {
    const { hashSyncContent } = await import('./syncHash')
    const content = '# 2026-06-21\n\nunchanged'
    settings.set('dropbox.state', {
      ...structuredClone(connectedState),
      lastPushedHash: await hashSyncContent(content),
    })
    exportMarkdownFromDb.mockResolvedValue(content)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ rev: 'rev-1', server_modified: '2026-06-21T10:00:00Z' }))
    vi.stubGlobal('fetch', fetchMock)
    const { pushToDropbox } = await import('./dropbox')
    const { getDropboxState } = await import('./dropboxState')

    expect(await pushToDropbox()).toEqual({ status: 'clean' })
    // Only the metadata fetch happens; the upload is skipped.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await getDropboxState()).toMatchObject({ localDirty: false, lastRemoteRev: 'rev-1' })
  })
})

describe('checkDropboxRemote', () => {
  beforeEach(() => {
    settings.clear()
    settings.set('dropbox.state', structuredClone(connectedState))
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('reports unchanged when the remote rev still matches, fetching metadata only', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ rev: 'rev-1', server_modified: 'x' }))
    vi.stubGlobal('fetch', fetchMock)
    const { checkDropboxRemote } = await import('./dropbox')

    expect(await checkDropboxRemote()).toEqual({ status: 'unchanged' })
    expect(fetchMock).toHaveBeenCalledTimes(1) // metadata only, no download
  })

  it('reports remote_changed when the remote rev advanced', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ rev: 'rev-2', server_modified: 'x' }))
    vi.stubGlobal('fetch', fetchMock)
    const { checkDropboxRemote } = await import('./dropbox')

    expect(await checkDropboxRemote()).toEqual({ status: 'changed', reason: 'remote_changed' })
  })

  it('reports remote_missing when the remote file is gone', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error_summary: 'path/not_found/..' }, { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)
    const { checkDropboxRemote } = await import('./dropbox')

    expect(await checkDropboxRemote()).toEqual({ status: 'changed', reason: 'remote_missing' })
  })

  it('reports unknown without any network call when nothing has synced yet', async () => {
    settings.set('dropbox.state', { ...structuredClone(connectedState), lastRemoteRev: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { checkDropboxRemote } = await import('./dropbox')

    expect(await checkDropboxRemote()).toEqual({ status: 'unknown' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
