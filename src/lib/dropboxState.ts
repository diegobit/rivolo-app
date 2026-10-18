import { getJsonSetting, updateJsonSetting } from './settingsRepository'
import { executeSql, queryFirstRow, type RivoloDatabase } from './sqliteRuntime'

export type DropboxState = {
  connected: boolean
  filePath: string | null
  lastRemoteRev: string | null
  lastPushedHash: string | null
  lastSyncAt: number | null
  lastPullAt: number | null
  lastPushAt: number | null
  localDirty: boolean
  localRevision: number
  accountId: string | null
  accountEmail: string | null
  accountName: string | null
}

const DEFAULT_STATE: DropboxState = {
  connected: false,
  filePath: null,
  lastRemoteRev: null,
  lastPushedHash: null,
  lastSyncAt: null,
  lastPullAt: null,
  lastPushAt: null,
  localDirty: false,
  localRevision: 0,
  accountId: null,
  accountEmail: null,
  accountName: null,
}

export const markDropboxLocalDirtyInDatabase = (db: RivoloDatabase) => {
  const row = queryFirstRow<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ? LIMIT 1', [
    'dropbox.state',
  ])
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = row ? JSON.parse(row.value) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      stored = parsed as Record<string, unknown>
    }
  } catch {
    stored = {}
  }
  delete stored.auth
  const state = { ...DEFAULT_STATE, ...stored } as DropboxState
  const next = {
    ...state,
    localDirty: true,
    localRevision: (Number.isSafeInteger(state.localRevision) ? state.localRevision : 0) + 1,
  }
  executeSql(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    'dropbox.state',
    JSON.stringify(next),
  ])
}

let writeQueue: Promise<void> = Promise.resolve()

// Legacy state kept the refresh token in `auth`. That token now lives only in
// an HttpOnly cookie, so strip any leftover copy from client storage; users
// with a legacy token simply reconnect once.
const readDropboxState = async () => {
  const stored = await getJsonSetting<DropboxState & { auth?: unknown }>('dropbox.state')
  const merged = { ...DEFAULT_STATE, ...stored }
  if ('auth' in merged) {
    delete (merged as { auth?: unknown }).auth
  }
  return merged as DropboxState
}

const enqueueDropboxStateWrite = async <T>(
  mutator: (current: DropboxState) => { next: DropboxState; result: T },
) => {
  const run = async () => {
    let result!: T
    await updateJsonSetting<unknown>('dropbox.state', (stored) => {
      const current = { ...DEFAULT_STATE, ...(stored && typeof stored === 'object' ? stored : {}) } as DropboxState
      const { next, result: nextResult } = mutator(current)
      result = nextResult
      const persisted = { ...next } as DropboxState & { auth?: unknown }
      delete persisted.auth
      return persisted
    })
    return result
  }

  const queuedRun = writeQueue.then(run, run)
  writeQueue = queuedRun.then(
    () => undefined,
    () => undefined,
  )
  return queuedRun
}

export const getDropboxState = async () => {
  await writeQueue
  return readDropboxState()
}

export const updateDropboxState = async (updates: Partial<DropboxState>) => {
  return enqueueDropboxStateWrite((current) => {
    const next = { ...current, ...updates }
    return { next, result: next }
  })
}

export const updateDropboxFilePath = async (filePath: string) => {
  return enqueueDropboxStateWrite((current) => {
    const pathChanged = current.filePath !== filePath
    const next = {
      ...current,
      filePath,
      lastRemoteRev: pathChanged ? null : current.lastRemoteRev,
      lastPushedHash: pathChanged ? null : current.lastPushedHash,
      lastSyncAt: pathChanged ? null : current.lastSyncAt,
      lastPullAt: pathChanged ? null : current.lastPullAt,
      lastPushAt: pathChanged ? null : current.lastPushAt,
    }

    return { next, result: next }
  })
}

export const markDropboxLocalDirty = async () => {
  await enqueueDropboxStateWrite((current) => {
    const next = {
      ...current,
      localDirty: true,
      localRevision: current.localRevision + 1,
    }

    return { next, result: next }
  })
}

export const finalizeDropboxPushState = async (
  remoteRev: string,
  sourceRevision: number,
  pushedHash?: string | null,
) => {
  await enqueueDropboxStateWrite((current) => {
    const next = {
      ...current,
      lastRemoteRev: remoteRev,
      lastPushedHash: pushedHash === undefined ? current.lastPushedHash : pushedHash,
      lastSyncAt: Date.now(),
      lastPushAt: Date.now(),
      localDirty: current.localRevision === sourceRevision ? false : current.localDirty,
    }

    return { next, result: next }
  })
}
