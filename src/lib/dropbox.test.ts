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

const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init)
const connectedState = {
  auth: {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
  },
  filePath: '/inbox.md',
  lastRemoteRev: 'rev-1',
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
    })
    expect(await getDropboxState()).toMatchObject({ localDirty: false, lastRemoteRev: 'rev-1' })
  })
})
