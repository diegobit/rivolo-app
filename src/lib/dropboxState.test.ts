import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = new Map<string, unknown>()

vi.mock('./settingsRepository', () => ({
  getJsonSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
  setJsonSetting: vi.fn(async (key: string, value: unknown) => {
    settings.set(key, structuredClone(value))
  }),
}))

describe('Dropbox revision tracking', () => {
  beforeEach(() => {
    settings.clear()
    vi.resetModules()
  })

  it('keeps local changes made while a push is in flight dirty', async () => {
    const { finalizeDropboxPushState, getDropboxState, markDropboxLocalDirty } = await import('./dropboxState')

    await markDropboxLocalDirty()
    const pushedRevision = (await getDropboxState()).localRevision
    await markDropboxLocalDirty()
    await finalizeDropboxPushState('remote-rev-2', pushedRevision)

    expect(await getDropboxState()).toMatchObject({
      lastRemoteRev: 'remote-rev-2',
      localDirty: true,
      localRevision: pushedRevision + 1,
    })
  })

  it('marks the provider clean when no newer local edit exists', async () => {
    const { finalizeDropboxPushState, getDropboxState, markDropboxLocalDirty } = await import('./dropboxState')

    await markDropboxLocalDirty()
    const pushedRevision = (await getDropboxState()).localRevision
    await finalizeDropboxPushState('remote-rev-1', pushedRevision)

    expect(await getDropboxState()).toMatchObject({
      lastRemoteRev: 'remote-rev-1',
      localDirty: false,
      localRevision: pushedRevision,
    })
  })
})
