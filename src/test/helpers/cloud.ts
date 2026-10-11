import { expect, vi } from 'vitest'
import type { Storage } from './storage'

export type CloudProvider = 'dropbox' | 'google-drive'
export const archive = (content: string) => `<!-- day:2026-06-21 -->\nRemote title\n---\n\n${content}`

// The external cloud is simulated; the app's authorization, archive parser,
// repository, provider state and IndexedDB writes are production implementations.
export const createCloud = async (provider: CloudProvider, storage: Storage) => {
  const cloud = {
    content: archive('remote text'), version: 1, exists: true,
    folderExists: true, parents: ['folder-1'],
    headBefore: undefined as string | undefined,
    headAfter: undefined as string | undefined,
    conflictContent: archive('concurrent remote edit'),
    revisions: [] as { id: string; modifiedTime: string }[],
    rejectBearerOnce: false, uploadConflict: false,
    beforeUpload: undefined as (() => Promise<void>) | undefined,
    uploads: [] as string[], tokens: 0,
    calls: [] as { url: URL; method: string; headers: Headers }[],
  }
  const stateKey = provider === 'dropbox' ? 'dropbox.state' : 'google-drive.state'
  const defaultState = {
    connected: true, filePath: '/inbox.md', fileName: 'inbox.md', fileId: 'file-1', folderId: 'folder-1',
    lastRemoteRev: 'rev-1', lastRemoteVersion: '1', lastPushedHash: null,
    lastSyncAt: null, lastPullAt: null, lastPushAt: null,
    localDirty: true, localRevision: 1, accountId: 'account', accountEmail: 'person@example.com', accountName: 'Person',
  }
  const state = async (updates: Record<string, unknown> = {}) => {
    const current = await storage.settings.getJsonSetting<Record<string, unknown>>(stateKey)
    await storage.settings.setJsonSetting(stateKey, { ...defaultState, ...current, ...updates })
  }
  await storage.settings.setJsonSetting(stateKey, defaultState)
  const driveFile = (head = cloud.headBefore) => ({
    id: 'file-1', name: 'inbox.md', mimeType: 'text/markdown', version: String(cloud.version),
    parents: cloud.parents, headRevisionId: head,
    capabilities: { canDownload: true, canEdit: true, canModifyContent: true },
  })
  const folder = () => ({ id: 'folder-1', name: 'rivolo', mimeType: 'application/vnd.google-apps.folder', version: '1' })
  const metadata = () => ({ rev: `rev-${cloud.version}`, server_modified: '2026-06-21T10:00:00Z' })
  const upload = async (body: string) => {
    await cloud.beforeUpload?.()
    cloud.uploads.push(body)
    cloud.content = body
    cloud.version++
    cloud.exists = true
  }
  const fetchMock = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(String(input), 'https://rivolo.test')
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    cloud.calls.push({ url, method, headers })
    if (url.origin === 'https://rivolo.test' && url.pathname === `/api/${provider}/token`) {
      expect(method).toBe('POST')
      expect(init.credentials).toBe('include')
      expect(headers.get('X-Requested-With')).toBe('XmlHttpRequest')
      cloud.tokens++
      return Response.json({ accessToken: `${provider}-token-${cloud.tokens}`, expiresAt: Date.now() + 3_600_000 })
    }
    expect(headers.get('Authorization')).toBe(`Bearer ${provider}-token-${cloud.tokens}`)
    if (cloud.rejectBearerOnce) {
      cloud.rejectBearerOnce = false
      return new Response('expired token', { status: 401 })
    }
    if (provider === 'dropbox') {
      if (url.href === 'https://api.dropboxapi.com/2/files/get_metadata') {
        expect(method).toBe('POST')
        expect(JSON.parse(String(init.body))).toEqual({ path: '/inbox.md' })
        return cloud.exists ? Response.json(metadata()) : Response.json({ error_summary: 'path/not_found/..' }, { status: 409 })
      }
      if (url.href === 'https://content.dropboxapi.com/2/files/download') {
        expect(method).toBe('POST')
        expect(JSON.parse(headers.get('Dropbox-API-Arg')!)).toEqual({ path: '/inbox.md' })
        return new Response(cloud.content)
      }
      if (url.href === 'https://content.dropboxapi.com/2/files/upload') {
        expect(method).toBe('POST')
        expect(headers.get('Content-Type')).toBe('application/octet-stream')
        const args = JSON.parse(headers.get('Dropbox-API-Arg')!)
        expect(args).toMatchObject({ path: '/inbox.md', autorename: false, mute: false })
        if (args.mode !== 'overwrite') expect(args.mode).toEqual({ '.tag': 'update', update: `rev-${cloud.version}` })
        if (cloud.uploadConflict && args.mode !== 'overwrite') return Response.json({ error_summary: 'path/conflict/file/..' }, { status: 409 })
        await upload(String(init.body))
        return Response.json(metadata())
      }
    } else if (url.origin === 'https://www.googleapis.com') {
      if (url.pathname === '/drive/v3/files' && method === 'GET') {
        const query = url.searchParams.get('q')!
        if (query.includes("mimeType='application/vnd.google-apps.folder'")) {
          return Response.json({ files: cloud.folderExists ? [folder()] : [] })
        }
        expect(query).toContain("'folder-1' in parents")
        return Response.json({ files: cloud.exists ? [driveFile()] : [] })
      }
      if (url.pathname === '/drive/v3/files' && method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ name: 'rivolo', mimeType: 'application/vnd.google-apps.folder', appProperties: { rivoloSync: 'folder' } })
        cloud.folderExists = true
        return Response.json(folder())
      }
      if (url.pathname === '/drive/v3/files/file-1/revisions') return Response.json({ revisions: cloud.revisions })
      if (url.pathname === '/drive/v3/files/file-1/revisions/remote-conflict') {
        expect(url.searchParams.get('alt')).toBe('media')
        return new Response(cloud.conflictContent)
      }
      if (url.pathname === '/drive/v3/files/file-1') {
        if (method === 'PATCH') {
          expect(url.searchParams.get('addParents')).toBe('folder-1')
          expect(url.searchParams.get('removeParents')).toBe(cloud.parents.join(','))
          cloud.parents = ['folder-1']; cloud.version++
          return Response.json(driveFile())
        }
        if (url.searchParams.get('alt') === 'media') return new Response(cloud.content)
        return cloud.exists ? Response.json(driveFile()) : new Response('not found', { status: 404 })
      }
      if (url.pathname === '/upload/drive/v3/files/file-1') {
        expect(method).toBe('PATCH')
        expect(url.searchParams.get('uploadType')).toBe('media')
        expect(headers.get('Content-Type')).toBe('text/markdown; charset=UTF-8')
        await upload(String(init.body))
        return Response.json(driveFile(cloud.headAfter))
      }
      if (url.pathname === '/upload/drive/v3/files') {
        expect(method).toBe('POST')
        expect(url.searchParams.get('uploadType')).toBe('multipart')
        const boundary = headers.get('Content-Type')!.split('boundary=')[1]
        const parts = String(init.body).split(`--${boundary}`)
        expect(JSON.parse(parts[1].split('\r\n\r\n')[1].trim())).toEqual({ name: 'inbox.md', mimeType: 'text/markdown', parents: ['folder-1'], appProperties: { rivoloSync: 'primary' } })
        await upload(parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''))
        return Response.json(driveFile(cloud.headAfter))
      }
    }
    throw new Error(`Unexpected ${provider} request: ${method} ${url.href}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  const module = provider === 'dropbox' ? await import('../../lib/dropbox') : await import('../../lib/googleDrive')
  const adapter = 'dropboxProvider' in module ? module.dropboxProvider : module.googleDriveProvider
  return { cloud, state, adapter, fetchMock }
}
