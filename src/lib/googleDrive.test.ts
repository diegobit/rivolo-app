// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeStorage, createStorage, reopenStorage, type Storage } from '../test/helpers/storage'
import { createCloud } from '../test/helpers/cloud'

let storage: Storage
beforeEach(async () => { storage = await createStorage() })
afterEach(() => { closeStorage(storage) })

describe('Google Drive folder and revision protocol', () => {
  it('creates the managed folder and a valid multipart archive on first push', async () => {
    await storage.repository.saveDay('2026-06-21', 'first local note')
    const { adapter, cloud, state } = await createCloud('google-drive', storage)
    cloud.exists = false; cloud.folderExists = false
    await state({ fileId: null, folderId: null, lastRemoteVersion: null })
    expect(await adapter.push()).toEqual({ status: 'pushed' })
    expect(cloud.parents).toEqual(['folder-1'])
    expect(cloud.content).toContain('<!-- day:2026-06-21 -->')
    expect(cloud.content).toContain('first local note')
    expect(await adapter.getStatus()).toMatchObject({ targetName: '/rivolo/inbox.md' })
    storage = await reopenStorage(storage)
    expect(await storage.settings.getJsonSetting('google-drive.state')).toMatchObject({ fileId: 'file-1', folderId: 'folder-1', lastRemoteVersion: '2', localDirty: false })
  })

  it.each([true, false])('moves a tracked root file before a manual push (dirty=%s)', async (localDirty) => {
    await storage.repository.saveDay('2026-06-21', 'local note')
    const { adapter, cloud, state } = await createCloud('google-drive', storage)
    cloud.parents = ['root']
    await state({ folderId: null, localDirty })
    expect(await adapter.push()).toEqual({ status: 'pushed' })
    expect(cloud.parents).toEqual(['folder-1'])
    expect(cloud.uploads).toHaveLength(localDirty ? 1 : 0)
    expect(await storage.settings.getJsonSetting('google-drive.state')).toMatchObject({ lastRemoteVersion: localDirty ? '3' : '2', localDirty: false })
  })

  it('uses cached folder membership without discovery round trips on an ordinary push', async () => {
    await storage.repository.saveDay('2026-06-21', 'changed content')
    const { adapter, cloud } = await createCloud('google-drive', storage)
    expect(await adapter.push()).toEqual({ status: 'pushed' })
    expect(cloud.calls.filter((call) => call.url.origin === 'https://www.googleapis.com').map((call) => [call.method, call.url.pathname])).toEqual([
      ['GET', '/drive/v3/files/file-1'], ['PATCH', '/upload/drive/v3/files/file-1'],
    ])
  })

  it.each([false, true])('distinguishes a normal next revision from a concurrent edit (concurrent=%s)', async (concurrent) => {
    await storage.repository.saveDay('2026-06-21', 'local upload')
    const { adapter, cloud } = await createCloud('google-drive', storage)
    cloud.headBefore = 'head-before'; cloud.headAfter = 'head-after'
    cloud.revisions = [
      { id: 'head-before', modifiedTime: '2026-07-11T10:00:00Z' },
      ...(concurrent ? [{ id: 'remote-conflict', modifiedTime: '2026-07-11T10:01:00Z' }] : []),
      { id: 'head-after', modifiedTime: '2026-07-11T10:02:00Z' },
    ]
    const result = await adapter.push()
    if (concurrent) {
      expect(result).toEqual({ status: 'pushed', attention: 'Google Drive changed while uploading. A local backup of the remote conflict was saved.' })
      storage = await reopenStorage(storage)
      expect((await storage.importer.listRollbackBackups())[0].contentMd).toContain('concurrent remote edit')
    } else {
      expect(result).toEqual({ status: 'pushed' })
      expect(await storage.importer.listRollbackBackups()).toEqual([])
    }
    expect(cloud.uploads).toHaveLength(1)
    expect(cloud.content).toContain('local upload')
  })
})
