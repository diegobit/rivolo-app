import { runAtomicDatabaseMutation, flushDatabaseSave } from './db'
import { listAllDays } from './dayRepository'
import { createDailySync, type DailySyncDriver } from './dailySync'
import { getDayChange, getNotebookProgress, listDirtyDays, writeDayInDatabase, writeDailyStateInDatabase, type NotebookTarget } from './dailySyncState'
import { exportMarkdownFromDb, saveRollbackBackup } from './importExport'
import { encodeNotebookDay, decodeNotebookDay, splitNotebookDays, type DailyRemoteFile } from './notebookDays'
import { mergeOneDriveNotebooksWithAuthors } from './oneDriveMerge'
import { flushDailyEvents, startCloudDailyEvents } from './oneDriveEvents'
import { annotateLocalNotebook } from './oneDriveBlame'
import { getPendingEditorDayIds } from './pendingEditorSaves'
import { executeSql, queryFirstRow, type RivoloDatabase } from './sqliteRuntime'
import { getJsonSetting } from './settingsRepository'
import { markSyncLocalDirty } from './syncDirty'
import { getSyncState, SYNC_PROVIDER_LABELS } from './syncState'
import type { SyncPullOptions } from './sync'

export type LegacySource = { ref: string; revision: string; download: () => Promise<string> }
type Provider = 'dropbox' | 'google-drive'
type Context = {
  connected: boolean
  accountId: string | null
  accountName: string | null
  localRevision: number
  sourceKey: string
  lastRevision: string | null
  localDirty: boolean
}
type Migration = { target: NotebookTarget; sourceKey: string; complete?: boolean; legacy: { ref: string; revision: string; content: string } | null }

type CloudNotebook<File extends DailyRemoteFile, State extends Context> = {
  provider: Provider
  readContext(): Promise<State>
  readContextInDatabase(db: RivoloDatabase): State
  resolveSource(context: State): Promise<LegacySource | null>
  resolveFolder(context: State, source: LegacySource | null): Promise<string>
  updateSummary(dirty: boolean): Promise<unknown>
  migrationComplete(folder: string): Promise<boolean>
  completeMigration(folder: string, guard: () => Promise<void>): Promise<void>
  remote: Omit<DailySyncDriver<File>, 'provider' | 'assertTarget' | 'assertTargetInDatabase' | 'accountName' | 'updateSummary'>
}

export function createCloudDailyNotebook<File extends DailyRemoteFile, State extends Context>(config: CloudNotebook<File, State>) {
  const { provider } = config
  const key = `${provider}.dailyNotebook`
  const label = SYNC_PROVIDER_LABELS[provider]
  const contextError = () => new Error(`${label} account or notebook changed during sync. The previous operation was stopped.`)
  const matches = (context: Context, migration: Migration | null) =>
    Boolean(context.connected && context.accountId && migration?.target.account === context.accountId && migration.sourceKey === context.sourceKey)
  const readMigration = () => getJsonSetting<Migration>(key)
  const readMigrationInDatabase = (db: RivoloDatabase) => {
    const row = queryFirstRow<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', [key])
    return row ? JSON.parse(row.value) as Migration : null
  }
  const sameTarget = (migration: Migration | null, target: NotebookTarget) =>
    migration?.target.provider === target.provider && migration.target.folder === target.folder &&
    migration.target.account === target.account && migration.target.generation === target.generation
  const assertTarget = async (target: NotebookTarget) => {
    const [context, migration, sync] = await Promise.all([config.readContext(), readMigration(), getSyncState()])
    if (sync.activeProvider !== provider || !matches(context, migration) || !sameTarget(migration, target)) throw contextError()
  }
  const assertTargetInDatabase = (db: RivoloDatabase, target: NotebookTarget) => {
    const context = config.readContextInDatabase(db)
    const migration = readMigrationInDatabase(db)
    const sync = queryFirstRow<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', ['sync.state'])
    if (!sync || JSON.parse(sync.value).activeProvider !== provider ||
      !matches(context, migration) || !sameTarget(migration, target)) throw contextError()
  }
  const engine = createDailySync({
    ...config.remote, provider, assertTarget, assertTargetInDatabase,
    accountName: async () => (await config.readContext()).accountName,
    updateSummary: config.updateSummary,
    durablePending: true,
  })
  const getTarget = async (context?: Context) => {
    const [current, migration] = await Promise.all([context ?? config.readContext(), readMigration()])
    return matches(current, migration) ? migration!.target : null
  }
  const readStatus = async (context: Context) => {
    const target = await getTarget(context)
    if (!target) return null
    const [dirty, progress] = await Promise.all([listDirtyDays(target), getNotebookProgress(target)])
    return { daily: true as const, localDirty: dirty.length > 0, offlineReady: progress.inventoryComplete, notebookChannel: target.folder }
  }
  const writeMigration = (db: RivoloDatabase, migration: Migration) =>
    executeSql(db, 'INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(migration)])
  const assertSourceSnapshot = (before: Context, after: Context) => {
    if (!after.connected || before.accountId !== after.accountId || before.sourceKey !== after.sourceKey) throw contextError()
    if (before.localRevision !== after.localRevision || getPendingEditorDayIds().size) {
      throw new Error(`${label} sync is waiting for your local edits to finish. Try again after saving.`)
    }
  }
  const readLegacy = async (source: LegacySource | null) => source ? {
    ref: source.ref, revision: source.revision, content: await source.download(),
  } : null
  const splitLegacy = (source: Migration['legacy']) => source?.content.trim()
    ? splitNotebookDays(source.content)
    : Promise.resolve(new Map<string, string>())

  const migrate = async () => {
    const context = await config.readContext()
    const previous = await readMigration()
    if (matches(context, previous)) return
    if (!context.connected || !context.accountId || (await getSyncState()).activeProvider !== provider) throw contextError()
    assertSourceSnapshot(context, context)
    const source = await config.resolveSource(context)
    const legacy = await readLegacy(source)
    const remoteDays = await splitLegacy(legacy)
    const folder = await config.resolveFolder(context, source)
    await config.remote.assertFolder(folder)
    const remoteComplete = await config.migrationComplete(folder)
    const inventory = await config.remote.inventory(folder)
    const localDays = new Map((await listAllDays()).map((day) => [day.dayId, day]))
    const target: NotebookTarget = { provider, folder, account: context.accountId, generation: (previous?.target.generation ?? 0) + 1 }
    const changes = await Promise.all([...new Set([...localDays.keys(), ...remoteDays.keys()])].map(async (id) => {
      const local = localDays.get(id)
      const remote = remoteDays.get(id)
      // Existing daily documents win over the retained source. A local edit
      // remains dirty and the normal engine reconciles it with that document.
      if (inventory.has(id)) {
        if (!remote) return null
        const current = await getDayChange(id)
        const parsed = decodeNotebookDay(remote, id)
        const unchanged = !local || parsed.contentMd === local.contentMd && parsed.humanTitle === local.humanTitle
        return { id, baseline: remote, revision: unchanged ? current.revision : 0 }
      }
      if (!remote) return null
      if (remoteComplete) {
        const parsed = decodeNotebookDay(remote, id)
        const unchanged = local && parsed.contentMd === local.contentMd && parsed.humanTitle === local.humanTitle
        return unchanged ? { id, remove: true as const } : null
      }
      const remembered = source?.revision === context.lastRevision
      if (!local && remembered && (await getDayChange(id)).deleted) return null
      if (!local) return { id, content: remote }
      if (remembered && context.localDirty) return null
      if (!context.localDirty) return { id, content: remote }
      const localText = await annotateLocalNotebook(encodeNotebookDay(local), '', context.accountName, local.updatedAt)
      return { id, content: await mergeOneDriveNotebooksWithAuthors(encodeNotebookDay({ dayId: id, humanTitle: '', contentMd: '' }), localText, remote) }
    }))
    if (changes.some(Boolean) && localDays.size) await saveRollbackBackup(await exportMarkdownFromDb())
    const latest = await config.resolveSource(context)
    if (latest?.ref !== source?.ref || latest?.revision !== source?.revision) throw new Error(`${label} changed during migration. Retry to include those edits.`)
    await runAtomicDatabaseMutation((db) => {
      assertSourceSnapshot(context, config.readContextInDatabase(db))
      const sync = queryFirstRow<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', ['sync.state'])
      if (!sync || JSON.parse(sync.value).activeProvider !== provider) throw contextError()
      for (const change of changes) {
        if (!change) continue
        if (change.remove) {
          writeDayInDatabase(db, change.id, null)
          continue
        }
        if (change.content) writeDayInDatabase(db, change.id, change.content)
        // Preserve imported attribution while marking the day for upload.
        writeDailyStateInDatabase(db, target, {
          dayId: change.id, item: null, eTag: null, baseline: change.baseline ?? change.content ?? null,
          uploadedHash: null, localRevision: change.revision ?? 0, deleted: false,
        })
      }
      writeMigration(db, { target, sourceKey: context.sourceKey, complete: remoteComplete, legacy })
    })
    if (changes.some((change) => change?.content || change?.remove)) await markSyncLocalDirty(undefined, { excludeProvider: provider })
    await flushDatabaseSave()
  }

  const importLegacyEdits = async (target: NotebookTarget) => {
    const migration = await readMigration()
    const context = await config.readContext()
    await assertTarget(target)
    const source = await config.resolveSource(context)
    // An absent legacy file is never treated as deletion of a daily notebook.
    if (!source || source.revision === migration?.legacy?.revision && source.ref === migration.legacy.ref) return
    const legacy = await readLegacy(source)
    const [before, after] = await Promise.all([splitLegacy(migration?.legacy ?? null), splitLegacy(legacy)])
    const local = new Map((await listAllDays()).map((day) => [day.dayId, day]))
    const changes = await Promise.all([...after].filter(([id, text]) => before.get(id) !== text).map(async ([id, text]) => {
      const day = local.get(id)
      const base = before.get(id) ?? encodeNotebookDay({ dayId: id, humanTitle: '', contentMd: '' })
      if (!day) {
        // An old client must not resurrect a day explicitly deleted here.
        if ((await getDayChange(id)).deleted) return null
        return { id, content: text }
      }
      const localText = await annotateLocalNotebook(encodeNotebookDay(day), base, context.accountName, day.updatedAt)
      const content = await mergeOneDriveNotebooksWithAuthors(base, localText, text)
      const parsed = decodeNotebookDay(content, id)
      return parsed.contentMd === day.contentMd && parsed.humanTitle === day.humanTitle ? null : { id, content }
    }))
    if (changes.some(Boolean)) await saveRollbackBackup(await exportMarkdownFromDb())
    await runAtomicDatabaseMutation((db) => {
      assertTargetInDatabase(db, target)
      assertSourceSnapshot(context, config.readContextInDatabase(db))
      for (const change of changes) {
        if (change) writeDayInDatabase(db, change.id, change.content)
      }
      writeMigration(db, { ...migration!, legacy })
    })
    if (changes.some(Boolean)) await markSyncLocalDirty(undefined, { excludeProvider: provider })
    await flushDatabaseSave()
    return changes.some(Boolean)
  }

  return {
    getTarget, readStatus, migrate,
    startEvents: (target: NotebookTarget, onChanged: Parameters<typeof startCloudDailyEvents>[2],
      onError: (message: string) => void, onReady: () => void) => startCloudDailyEvents(target, assertTarget, onChanged, onError, onReady),
    pull: async (target: NotebookTarget, options: SyncPullOptions) => {
      const imported = !options.dayIds && !options.force && await importLegacyEdits(target)
      const result = await engine.pullDailyNotebook(target, options)
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') void flushDailyEvents(target, assertTarget)
      return imported ? { ...result, status: 'pulled' as const } : result
    },
    push: async (target: NotebookTarget, force: boolean) => {
      const result = await engine.pushDailyNotebook(target, force)
      const migration = await readMigration()
      if (!migration?.complete && (await getNotebookProgress(target)).completedOnce && !(await listDirtyDays(target)).length &&
          !(result.status === 'pushed' && result.attention)) {
        await config.completeMigration(target.folder, () => assertTarget(target))
        await runAtomicDatabaseMutation((db) => {
          assertTargetInDatabase(db, target)
          writeMigration(db, { ...readMigrationInDatabase(db)!, complete: true })
        })
        await flushDatabaseSave()
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') void flushDailyEvents(target, assertTarget)
      return result
    },
  }
}
