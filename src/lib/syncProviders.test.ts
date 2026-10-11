// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeStorage, createStorage, reopenStorage, type Storage } from '../test/helpers/storage'
import { archive, createCloud } from '../test/helpers/cloud'

let storage: Storage
beforeEach(async () => { storage = await createStorage() })
afterEach(() => { closeStorage(storage) })

// Shared sync contracts have one parameterized owner, with both protocols
// independently routed and validated by the HTTP fixture.
describe.each(['dropbox', 'google-drive'] as const)('%s persisted sync boundary', (provider) => {
  it('does not download or overwrite dirty local notes without force', async () => {
    await storage.repository.saveDay('2026-06-21', 'local unsynced')
    const { adapter, cloud } = await createCloud(provider, storage)
    expect(await adapter.pull()).toMatchObject({ status: 'noop' })
    expect(cloud.calls).toEqual([])
    expect((await storage.repository.getDay('2026-06-21'))?.contentMd).toBe('local unsynced')
  })

  it('force-pulls valid archive content, persists it and preserves a recoverable local rollback', async () => {
    await storage.repository.saveDay('2026-06-21', 'local before pull')
    const { adapter } = await createCloud(provider, storage)
    expect(await adapter.pull({ force: true })).toMatchObject({ status: 'pulled' })
    storage = await reopenStorage(storage)
    expect((await storage.repository.getDay('2026-06-21'))?.contentMd).toBe('remote text')
    expect((await storage.importer.listRollbackBackups())[0].contentMd).toContain('local before pull')
    expect(await storage.settings.getJsonSetting(`${provider}.state`)).toMatchObject({ localDirty: false, lastPullAt: expect.any(Number), lastPushAt: null })
    const other = provider === 'dropbox' ? 'google-drive' : 'dropbox'
    expect(await storage.settings.getJsonSetting(`${other}.state`)).toMatchObject({ localDirty: true })
  })

  it('pulls a newer clean remote through the real importer and updates its tracked version', async () => {
    await storage.repository.saveDay('2026-06-21', 'previous local copy')
    const { adapter, cloud, state } = await createCloud(provider, storage)
    cloud.version = 2
    await state({ localDirty: false })
    expect(await adapter.pull()).toMatchObject({ status: 'pulled' })
    expect((await storage.repository.getDay('2026-06-21'))?.contentMd).toBe('remote text')
    expect(await storage.settings.getJsonSetting(`${provider}.state`)).toMatchObject({
      localDirty: false,
      ...(provider === 'dropbox' ? { lastRemoteRev: 'rev-2' } : { lastRemoteVersion: '2' }),
    })
  })

  it('refuses an invalid forced remote replacement and leaves local notes and sync revision unchanged', async () => {
    await storage.repository.saveDay('2026-06-21', 'keep me')
    const { adapter, cloud } = await createCloud(provider, storage)
    cloud.content = '# 2026-06-21\n\nmarker-free remote'
    cloud.version = 2
    await expect(adapter.pull({ force: true })).rejects.toMatchObject({ name: 'ImportSafetyError', reasons: ['no-day-markers'] })
    expect((await storage.repository.getDay('2026-06-21'))?.contentMd).toBe('keep me')
    expect(await storage.settings.getJsonSetting(`${provider}.state`)).toMatchObject({ localDirty: true, lastPullAt: null })
    expect(await storage.importer.listRollbackBackups()).toEqual([])
  })

  it('records an unchanged remote check without a download or local replacement', async () => {
    const { adapter, cloud, state } = await createCloud(provider, storage)
    await state({ localDirty: false })
    expect(await adapter.pull()).toMatchObject({ status: 'noop' })
    expect(cloud.calls.filter((call) => call.url.pathname.endsWith('/download') || call.url.searchParams.get('alt') === 'media')).toEqual([])
    expect(await storage.settings.getJsonSetting(`${provider}.state`)).toMatchObject({ lastPullAt: expect.any(Number), lastPushAt: null })
  })

  it.each(['changed', 'missing', 'untracked'] as const)('blocks a %s remote before uploading local notes', async (mode) => {
    await storage.repository.saveDay('2026-06-21', 'local edit')
    const { adapter, cloud, state } = await createCloud(provider, storage)
    if (mode === 'changed') cloud.version = 2
    if (mode === 'missing') cloud.exists = false
    if (mode === 'untracked') await state({ lastRemoteRev: null, lastRemoteVersion: null })
    expect(await adapter.push()).toMatchObject({ status: 'blocked', reason: mode === 'missing' ? 'remote_missing' : 'remote_changed' })
    expect(cloud.uploads).toEqual([])
    expect(await storage.settings.getJsonSetting(`${provider}.state`)).toMatchObject({ localDirty: true })
  })

  it('delivers the provider-specific bearer token and refreshes once after a real 401', async () => {
    await storage.repository.saveDay('2026-06-21', 'local edit')
    const { adapter, cloud } = await createCloud(provider, storage)
    cloud.rejectBearerOnce = true
    expect(await adapter.push()).toMatchObject({ status: 'pushed' })
    expect(cloud.tokens).toBe(2)
    const requests = cloud.calls.filter((call) => call.url.origin !== 'https://rivolo.test')
    expect(requests[0].headers.get('Authorization')).toBe(`Bearer ${provider}-token-1`)
    expect(requests[1].headers.get('Authorization')).toBe(`Bearer ${provider}-token-2`)
    expect(cloud.uploads[0]).toContain('local edit')
    if (provider === 'dropbox') {
      const upload = cloud.calls.find((call) => call.url.pathname.endsWith('/upload'))!
      expect(JSON.parse(upload.headers.get('Dropbox-API-Arg')!).mode).toEqual({ '.tag': 'update', update: 'rev-1' })
    }
  })

  it('keeps an edit during upload dirty and sends it on the next push', async () => {
    await storage.repository.saveDay('2026-06-21', 'first version')
    const { adapter, cloud } = await createCloud(provider, storage)
    cloud.beforeUpload = async () => {
      cloud.beforeUpload = undefined
      await storage.repository.saveDay('2026-06-21', 'edited during upload')
    }
    expect(await adapter.push()).toMatchObject({ status: 'pushed' })
    expect(cloud.uploads[0]).toContain('first version')
    expect(cloud.uploads[0]).not.toContain('edited during upload')
    expect(await storage.settings.getJsonSetting(`${provider}.state`)).toMatchObject({ localDirty: true, localRevision: 2 })
    expect(await adapter.push()).toMatchObject({ status: 'pushed' })
    expect(cloud.uploads[1]).toContain('edited during upload')
    storage = await reopenStorage(storage)
    expect(await storage.settings.getJsonSetting(`${provider}.state`)).toMatchObject({ localDirty: false })
    expect((await storage.repository.getDay('2026-06-21'))?.contentMd).toBe('edited during upload')
  })

  it('skips a byte-identical second upload after dirty state is raised again', async () => {
    await storage.repository.saveDay('2026-06-21', 'same content')
    const { adapter, cloud, state } = await createCloud(provider, storage)
    await adapter.push()
    await state({ localDirty: true })
    expect(await adapter.push()).toMatchObject({ status: 'clean' })
    expect(cloud.uploads).toHaveLength(1)
    expect(await storage.settings.getJsonSetting(`${provider}.state`)).toMatchObject({ localDirty: false, lastPushAt: expect.any(Number) })
  })

  it('explicitly force-uploads the local copy over a changed remote', async () => {
    await storage.repository.saveDay('2026-06-21', 'chosen local copy')
    const { adapter, cloud, state } = await createCloud(provider, storage)
    cloud.version = 2
    await state({ localDirty: false })
    expect(await adapter.push(true)).toMatchObject({ status: 'pushed' })
    expect(cloud.content).toContain('chosen local copy')
    expect(cloud.content).not.toBe(archive('remote text'))
    if (provider === 'dropbox') {
      const upload = cloud.calls.find((call) => call.url.pathname.endsWith('/upload'))!
      expect(JSON.parse(upload.headers.get('Dropbox-API-Arg')!).mode).toBe('overwrite')
    }
  })
})

describe('Dropbox protocol-specific conflict', () => {
  it('maps an upload CAS conflict to remote_changed without cleaning the local copy', async () => {
    await storage.repository.saveDay('2026-06-21', 'local conflict')
    const { adapter, cloud } = await createCloud('dropbox', storage)
    cloud.uploadConflict = true
    expect(await adapter.push()).toEqual({ status: 'blocked', reason: 'remote_changed' })
    expect(cloud.uploads).toEqual([])
    expect(await storage.settings.getJsonSetting('dropbox.state')).toMatchObject({ localDirty: true, lastRemoteRev: 'rev-1' })
  })
})
