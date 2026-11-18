import { flushDatabaseSave, queryAll, queryOne, run, runAtomicDatabaseMutation } from './db'
import { executeSql, queryFirstRow, type RivoloDatabase } from './sqliteRuntime'
import { getPendingEditorDayIds } from './pendingEditorSaves'
import { decodeNotebookDay } from './notebookDays'
import { getJsonSetting, setJsonSetting } from './settingsRepository'
import { SYNC_PROVIDER_LABELS, type SyncProviderId } from './syncState'

export type NotebookTarget = {
  provider: SyncProviderId
  folder: string
  account: string | null
  generation: number
}
export type TargetGuard = (db: RivoloDatabase, target: NotebookTarget) => void
export type DailyState = {
  dayId: string; item: string | null; eTag: string | null; baseline: string | null
  uploadedHash: string | null; localRevision: number; deleted: boolean
  error?: string | null
  deleteUncertain?: true | { ref: string; revision: string }
  // Written before an upload: the hash sent and the local document it was
  // merged from. If the reply is lost, the next pass recognises its own upload.
  pending?: { hash: string; base: string; remoteRevision?: string; createRef?: string; applied?: { uploaded: string; previous: string; submitted: string } } | null
}
export type DayChange = { dayId: string; revision: number; deleted: boolean }
export const targetKey = (target: NotebookTarget) => JSON.stringify(
  target.provider === 'onedrive' ? [target.account, target.folder] : [target.provider, target.account, target.folder],
)
export const getDayChange = async (dayId: string): Promise<DayChange> => {
  const row = await queryOne<{ revision: number; deleted: number }>('SELECT revision, deleted FROM onedrive_day_changes WHERE day_id = ?', [dayId])
  return { dayId, revision: row?.revision ?? 0, deleted: Boolean(row?.deleted) }
}
export const getDailyState = async (target: NotebookTarget, dayId: string): Promise<DailyState | null> => {
  const row = await queryOne<{ value: string }>('SELECT value FROM onedrive_daily_state WHERE target = ? AND day_id = ?', [targetKey(target), dayId])
  return row ? JSON.parse(row.value) as DailyState : null
}
export const listDailyStateIds = async (target: NotebookTarget) =>
  (await queryAll<{ day_id: string }>('SELECT day_id FROM onedrive_daily_state WHERE target = ?', [targetKey(target)])).map((row) => row.day_id)
export const listDailyStates = async (target: NotebookTarget) => {
  const rows = await queryAll<{ value: string }>('SELECT value FROM onedrive_daily_state WHERE target = ?', [targetKey(target)])
  return rows.map((row) => JSON.parse(row.value) as DailyState)
}
export const writeDailyState = async (target: NotebookTarget, state: DailyState) => {
  await run('INSERT INTO onedrive_daily_state VALUES (?, ?, ?, ?, ?) ON CONFLICT(target, day_id) DO UPDATE SET revision = excluded.revision, value = excluded.value, error = excluded.error',
    [targetKey(target), state.dayId, state.localRevision, JSON.stringify(state), state.error ?? null])
}
export const listDailyErrors = async (target: NotebookTarget) =>
  (await queryAll<{ error: string }>('SELECT error FROM onedrive_daily_state WHERE target = ? AND error IS NOT NULL', [targetKey(target)])).map((row) => row.error)
export const listDirtyDays = async (target: NotebookTarget): Promise<DayChange[]> => {
  const rows = await queryAll<{ day_id: string; revision: number; deleted: number }>(`
    SELECT c.day_id, c.revision, c.deleted FROM onedrive_day_changes c
    LEFT JOIN onedrive_daily_state s ON s.day_id = c.day_id AND s.target = ?
    WHERE c.revision != COALESCE(s.revision, 0) ORDER BY c.day_id DESC`, [targetKey(target)])
  return rows.map((row) => ({ dayId: row.day_id, revision: row.revision, deleted: Boolean(row.deleted) }))
}
// completedOnce stays true after the first complete download of this notebook,
// while inventoryComplete drops to false during every later full check.
export type NotebookProgress = { inventoryComplete: boolean; loaded: number; total: number; lastReconciledAt: number | null; completedOnce?: boolean }
const progressKey = (target: NotebookTarget) => `${target.provider}.progress:${targetKey(target)}`

export const getNotebookProgress = async (target: NotebookTarget): Promise<NotebookProgress> => {
  const stored = await getJsonSetting<NotebookProgress>(progressKey(target)) ?? { inventoryComplete: false, loaded: 0, total: 0, lastReconciledAt: null }
  return { ...stored, completedOnce: Boolean(stored.completedOnce || stored.inventoryComplete) }
}
export const setNotebookProgress = async (target: NotebookTarget, progress: NotebookProgress) => {
  const value = { ...progress, completedOnce: progress.inventoryComplete || (await getNotebookProgress(target)).completedOnce }
  // Progress is a display hint rewritten per day during a full pull; saving the
  // whole database for each update would make large pulls much slower.
  await setJsonSetting(progressKey(target), value, { durable: false })
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(`rivolo:${target.provider}-progress`))
}

export type DailyEvent = { type: 'day-changed'; dayId: string; item: string; revision: string } | { type: 'inventory-invalidated'; revision: string }
export type OutboxEntry = { context: string; folder: string; account: string | null; event: DailyEvent }
export const queueDailyEvent = async (target: NotebookTarget, event: DailyEvent) => {
  const entry: OutboxEntry = { context: targetKey(target), folder: target.folder, account: target.account, event }
  await run('INSERT INTO onedrive_outbox VALUES (?, ?, ?) ON CONFLICT(context, item) DO UPDATE SET value = excluded.value',
    [entry.context, event.type === 'day-changed' ? event.item : 'inventory', JSON.stringify(entry)])
}
export const readDailyOutbox = async (target: NotebookTarget) => {
  const rows = await queryAll<{ item: string; value: string }>('SELECT item, value FROM onedrive_outbox WHERE context = ?', [targetKey(target)])
  return rows.map((row) => ({ item: row.item, value: row.value, entry: JSON.parse(row.value) as OutboxEntry }))
}
export const acknowledgeDailyEvent = async (context: string, item: string, value: string) =>
  run('DELETE FROM onedrive_outbox WHERE context = ? AND item = ? AND value = ?', [context, item, value])
export const persistDailyCheckpoint = flushDatabaseSave

export const writeDailyStateInDatabase = (db: RivoloDatabase, target: NotebookTarget, state: DailyState) => {
  executeSql(db, 'INSERT INTO onedrive_daily_state VALUES (?, ?, ?, ?, ?) ON CONFLICT(target, day_id) DO UPDATE SET revision = excluded.revision, value = excluded.value, error = excluded.error',
    [targetKey(target), state.dayId, state.localRevision, JSON.stringify(state), state.error ?? null])
}
export const commitDailyCheckpoint = async (target: NotebookTarget, assertTargetInDatabase: TargetGuard, state: DailyState, event?: DailyEvent) => {
  await runAtomicDatabaseMutation((db) => {
    assertTargetInDatabase(db, target)
    writeDailyStateInDatabase(db, target, state)
    if (event) {
      const entry: OutboxEntry = { context: targetKey(target), folder: target.folder, account: target.account, event }
      executeSql(db, 'INSERT INTO onedrive_outbox VALUES (?, ?, ?) ON CONFLICT(context, item) DO UPDATE SET value = excluded.value',
        [entry.context, event.type === 'day-changed' ? event.item : 'inventory', JSON.stringify(entry)])
    }
  })
  await persistDailyCheckpoint()
}
export const writeDayInDatabase = (db: RivoloDatabase, id: string, content: string | null) => {
  if (content === null) executeSql(db, 'DELETE FROM days WHERE day_id = ?', [id])
  else {
    const day = decodeNotebookDay(content, id)
    executeSql(db, 'INSERT INTO days VALUES (?, ?, ?, ?, ?) ON CONFLICT(day_id) DO UPDATE SET human_title = excluded.human_title, content_md = excluded.content_md, updated_at = excluded.updated_at',
      [id, day.humanTitle, day.contentMd, Date.now(), Date.now()])
  }
  if (db.selectValue("SELECT name FROM sqlite_master WHERE name = 'days_fts'")) {
    executeSql(db, 'DELETE FROM days_fts WHERE day_id = ?', [id])
    if (content !== null) {
      const day = decodeNotebookDay(content, id)
      executeSql(db, 'INSERT INTO days_fts VALUES (?, ?, ?)', [id, day.humanTitle, day.contentMd])
    }
  }
}
export const applyDailyDocument = async (target: NotebookTarget, assertTargetInDatabase: TargetGuard, id: string, content: string | null, sourceRevision: number, checkpoint: DailyState) => {
  return runAtomicDatabaseMutation((db) => {
    assertTargetInDatabase(db, target)
    const change = queryFirstRow<{ revision: number }>(db, 'SELECT revision FROM onedrive_day_changes WHERE day_id = ?', [id])
    if (getPendingEditorDayIds().has(id) || (change?.revision ?? 0) !== sourceRevision) throw new Error(`${SYNC_PROVIDER_LABELS[target.provider]} ${id}: local edits are waiting to be reconciled.`)
    writeDayInDatabase(db, id, content)
    const revision = queryFirstRow<{ revision: number }>(db, 'SELECT revision FROM onedrive_day_changes WHERE day_id = ?', [id])?.revision ?? 0
    writeDailyStateInDatabase(db, target, { ...checkpoint, localRevision: revision, error: null })
    return revision
  })
}
