import { exportMarkdownFromDb, importMarkdownToDb } from './importExport'
import {
  authorizedDropboxFetch,
  disconnectDropboxAuth,
  startDropboxAuth,
  completeDropboxAuth,
} from './dropboxAuth'
import { finalizeDropboxPullState, finalizeDropboxPushState, getDropboxState, updateDropboxState } from './dropboxState'
import type { DropboxState } from './dropboxState'
import { markSyncLocalDirty } from './syncDirty'
import { createCloudDailyNotebook } from './cloudDailyNotebook'
import { createDropboxDailyRemote } from './dropboxDailyRemote'
import { queryFirstRow } from './sqliteRuntime'
import { hashSyncContent } from './syncHash'
import type { SyncProvider, SyncPullOptions, SyncStatus } from './sync'

const DROPBOX_API = 'https://api.dropboxapi.com/2'
const DROPBOX_CONTENT = 'https://content.dropboxapi.com/2'

export const DEFAULT_DROPBOX_PATH = '/inbox.md'

// OAuth lives in dropboxAuth.ts now; re-export so existing importers are stable.
export { startDropboxAuth, completeDropboxAuth }

type DropboxMetadata = {
  rev: string
  server_modified: string
}

type DropboxError = {
  error_summary?: string
}

type DropboxUploadMode =
  | 'overwrite'
  | {
      '.tag': 'update'
      update: string
    }

const resolveDropboxPath = async (state: DropboxState) => {
  if (state.filePath?.trim()) {
    return state.filePath
  }
  const next = await updateDropboxState({ filePath: DEFAULT_DROPBOX_PATH })
  return next.filePath ?? DEFAULT_DROPBOX_PATH
}

const fetchMetadata = async (path: string) => {
  const response = await authorizedDropboxFetch(`${DROPBOX_API}/files/get_metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  })

  if (response.ok) {
    return (await response.json()) as DropboxMetadata
  }

  if (response.status === 409) {
    const payload = (await response.json().catch(() => null)) as DropboxError | null
    if (payload?.error_summary?.startsWith('path/not_found')) {
      return null
    }
  }

  throw new Error('Failed to fetch Dropbox metadata.')
}

const downloadFile = async (path: string) => {
  const response = await authorizedDropboxFetch(`${DROPBOX_CONTENT}/files/download`, {
    method: 'POST',
    headers: {
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  })

  if (!response.ok) {
    throw new Error('Failed to download Dropbox file.')
  }

  return response.text()
}

class DropboxUploadConflictError extends Error {
  constructor() {
    super('Dropbox file changed before upload.')
  }
}

const uploadFile = async (path: string, content: string, mode: DropboxUploadMode) => {
  const response = await authorizedDropboxFetch(`${DROPBOX_CONTENT}/files/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode,
        autorename: false,
        mute: false,
      }),
    },
    body: content,
  })

  if (!response.ok) {
    if (response.status === 409) {
      const payload = (await response.json().catch(() => null)) as DropboxError | null
      if (payload?.error_summary?.startsWith('path/conflict')) {
        throw new DropboxUploadConflictError()
      }
    }
    throw new Error('Failed to upload Dropbox file.')
  }

  return (await response.json()) as DropboxMetadata
}

const resolveUploadMode = (expectedRev: string | null, force: boolean): DropboxUploadMode => {
  if (force || !expectedRev) {
    return 'overwrite'
  }
  return {
    '.tag': 'update',
    update: expectedRev,
  }
}

const dropboxDailyRemote = createDropboxDailyRemote(authorizedDropboxFetch)

const dailyContext = (state: DropboxState) => ({
  ...state, localRevision: state.localRevision ?? 0, sourceKey: state.filePath?.trim() || DEFAULT_DROPBOX_PATH, lastRevision: state.lastRemoteRev,
})

const dailyDropbox = createCloudDailyNotebook({
  provider: 'dropbox',
  readContext: async () => dailyContext(await getDropboxState()),
  readContextInDatabase: (db) => {
    const row = queryFirstRow<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', ['dropbox.state'])
    return dailyContext(JSON.parse(row?.value ?? '{}') as DropboxState)
  },
  resolveSource: async ({ sourceKey }) => {
    const file = await fetchMetadata(sourceKey)
    return file ? { ref: sourceKey, revision: file.rev, download: () => dropboxDailyRemote.readDropboxRevision(sourceKey, file.rev) } : null
  },
  resolveFolder: ({ sourceKey }) => dropboxDailyRemote.prepareDropboxDailyFolder(sourceKey),
  updateSummary: (localDirty) => updateDropboxState({ localDirty, lastSyncAt: Date.now() }),
  remote: dropboxDailyRemote,
  migrationComplete: dropboxDailyRemote.migrationComplete,
  completeMigration: dropboxDailyRemote.completeMigration,
})

export const getDropboxDailyTarget = dailyDropbox.getTarget
export const startDropboxDailyEvents = dailyDropbox.startEvents

export const disconnectDropbox = async () => {
  await disconnectDropboxAuth()
  await updateDropboxState({
    connected: false,
    accountId: null,
    accountEmail: null,
    accountName: null,
    lastRemoteRev: null,
    lastPushedHash: null,
    lastSyncAt: null,
    lastPullAt: null,
    lastPushAt: null,
  })
}

export const getDropboxStatus = async (): Promise<SyncStatus> => {
  const state = await getDropboxState()
  const daily = await dailyDropbox.readStatus(dailyContext(state))
  return {
    connected: state.connected,
    targetName: daily ? `${dailyContext(state).sourceKey.slice(0, -3)}.rivolo-daily` : state.filePath,
    lastRemoteVersion: state.lastRemoteRev,
    lastSyncAt: state.lastSyncAt,
    lastPullAt: state.lastPullAt,
    lastPushAt: state.lastPushAt,
    localDirty: state.localDirty,
    accountName: state.accountName,
    accountEmail: state.accountEmail,
    ...daily,
  }
}

export const pullFromDropbox = async (options: SyncPullOptions = {}) => {
  const state = await getDropboxState()
  const target = await dailyDropbox.getTarget(dailyContext(state))
  if (target) return dailyDropbox.pull(target, options)
  const path = await resolveDropboxPath(state)
  const force = options.force ?? false

  if (state.localDirty && !force) {
    console.info('[Dropbox] pull:dirty-noop', { filePath: path })
    return { status: 'noop' as const }
  }

  const metadata = await fetchMetadata(path)
  if (!metadata) {
    throw new Error('Dropbox file not found. Push to create it first.')
  }

  if (metadata.rev === state.lastRemoteRev && !(force && state.localDirty)) {
    console.info('[Dropbox] pull:noop', { filePath: path, rev: metadata.rev })
    // The remote was checked and matches, so this still counts as a pull.
    await updateDropboxState({ lastPullAt: Date.now() })
    return { status: 'noop' as const, metadata }
  }

  const content = await downloadFile(path)
  const result = await importMarkdownToDb(content, {
    replace: true,
    markDirty: false,
    allowUnsafeImport: options.allowUnsafeImport,
  })

  const contentHash = await hashSyncContent(content)
  await markSyncLocalDirty()
  await finalizeDropboxPullState(state.localRevision + 1, {
    lastRemoteRev: metadata.rev,
    // Remote content now equals local; record its hash so we do not immediately
    // re-push what we just pulled.
    lastPushedHash: contentHash,
    lastSyncAt: Date.now(),
    lastPullAt: Date.now(),
  })

  console.info('[Dropbox] pull:ok', { filePath: path, rev: metadata.rev })
  return { status: 'pulled' as const, metadata, result }
}

export const pushToDropbox = async (force = false) => {
  const state = await getDropboxState()
  const target = await dailyDropbox.getTarget(dailyContext(state))
  if (target) return dailyDropbox.push(target, force)
  const path = await resolveDropboxPath(state)

  const wantUpload = state.localDirty || force
  if (!wantUpload) {
    console.info('[Dropbox] push:clean', { filePath: path })
    return { status: 'clean' as const }
  }

  const metadata = await fetchMetadata(path)

  if (!force && state.lastRemoteRev && (!metadata || metadata.rev !== state.lastRemoteRev)) {
    const reason = metadata ? ('remote_changed' as const) : ('remote_missing' as const)
    console.warn('[Dropbox] push:blocked', {
      filePath: path,
      localRev: state.lastRemoteRev,
      remoteRev: metadata?.rev ?? 'missing',
      reason,
    })
    return { status: 'blocked' as const, reason, metadata }
  }
  if (!force && !state.lastRemoteRev && metadata && state.localDirty) {
    console.warn('[Dropbox] push:blocked', {
      filePath: path,
      localRev: 'untracked',
      remoteRev: metadata.rev,
      reason: 'remote_changed',
    })
    return { status: 'blocked' as const, reason: 'remote_changed' as const, metadata }
  }

  // Short-circuit the upload if the exported content is byte-identical to what
  // we last pushed and the remote is still at that revision — nothing to send.
  const content = await exportMarkdownFromDb()
  const contentHash = await hashSyncContent(content)
  if (
    !force &&
    contentHash === state.lastPushedHash &&
    metadata &&
    metadata.rev === state.lastRemoteRev
  ) {
    await finalizeDropboxPushState(metadata.rev, state.localRevision, contentHash)
    console.info('[Dropbox] push:unchanged', { filePath: path })
    return { status: 'clean' as const }
  }

  let upload: DropboxMetadata
  try {
    upload = await uploadFile(path, content, resolveUploadMode(state.lastRemoteRev, force))
  } catch (error) {
    if (error instanceof DropboxUploadConflictError) {
      console.warn('[Dropbox] push:conflict', { filePath: path })
      return { status: 'blocked' as const, reason: 'remote_changed' as const }
    }
    throw error
  }

  await finalizeDropboxPushState(upload.rev, state.localRevision, contentHash)

  console.info('[Dropbox] push:ok', { filePath: path, rev: upload.rev })
  return { status: 'pushed' as const, metadata: upload }
}

export const dropboxProvider = {
  id: 'dropbox',
  migrate: dailyDropbox.migrate,
  getStatus: getDropboxStatus,
  pull: pullFromDropbox,
  push: pushToDropbox,
  disconnect: disconnectDropbox,
} satisfies SyncProvider
