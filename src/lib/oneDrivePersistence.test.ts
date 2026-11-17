// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeStorage, createStorage, reopenStorage, type Storage } from '../test/helpers/storage'

// OneDrive sync against upstream's durable persistence layer: real SQLite,
// real draft registry and real IndexedDB snapshots.
let storage: Storage
beforeEach(async () => { storage = await createStorage() })
afterEach(() => { closeStorage(storage) })

const dayId = '2026-10-01'
const target = { provider: 'onedrive' as const, folder: '/drives/owner/items/notebook', account: 'alice', generation: 1 }
const connect = () => storage.settings.setJsonSetting('onedrive.state', {
  connected: true, accountId: target.account, folderId: target.folder, targetGeneration: target.generation,
  localDirty: false, localRevision: 0,
})
const oneDriveState = async () => storage.settings.getJsonSetting<{ localDirty: boolean; localRevision: number }>('onedrive.state')
const checkpoint = (localRevision: number) => ({
  dayId, item: null, eTag: null, baseline: null, uploadedHash: null, localRevision, deleted: false,
})
const remoteDocument = (contentMd: string) => `<!-- day:${dayId} -->\nThursday\n---\n\n${contentMd}`

describe('OneDrive with durable note persistence', () => {
  it('marks OneDrive dirty in the same transaction as a note save, so it survives a reopen', async () => {
    await connect()
    await storage.repository.saveDay(dayId, 'Typed')
    expect(await oneDriveState()).toMatchObject({ localDirty: true, localRevision: 1 })

    storage = await reopenStorage(storage)
    expect(await oneDriveState()).toMatchObject({ localDirty: true, localRevision: 1 })
    const daily = await import('./dailySyncState')
    expect((await daily.getDayChange(dayId)).revision).toBe(1)
  })

  it('refuses a remote day while its editor draft is only registered, and after the draft is written', async () => {
    await connect()
    const { assertTargetInDatabase } = await import('./oneDriveDailyState')
    await storage.repository.saveDay(dayId, 'Saved')
    const daily = await import('./dailySyncState')
    const { getPendingEditorDayIds } = await import('./pendingEditorSaves')
    const sourceRevision = (await daily.getDayChange(dayId)).revision

    const generation = storage.db.registerPendingDayDraft(dayId, 'Saved and still typing', storage.repository.commitDayDraftInDatabase)
    expect(generation).toBeGreaterThan(0)
    expect(getPendingEditorDayIds().has(dayId)).toBe(true)
    await expect(daily.applyDailyDocument(target, assertTargetInDatabase, dayId, remoteDocument('Remote'), sourceRevision, checkpoint(sourceRevision)))
      .rejects.toThrow('local edits are waiting')

    // Persisting writes the draft, which advances the day's change revision.
    await storage.db.flushDatabaseSave()
    expect(getPendingEditorDayIds().has(dayId)).toBe(false)
    expect((await daily.getDayChange(dayId)).revision).toBeGreaterThan(sourceRevision)
    await expect(daily.applyDailyDocument(target, assertTargetInDatabase, dayId, remoteDocument('Remote'), sourceRevision, checkpoint(sourceRevision)))
      .rejects.toThrow('local edits are waiting')
    expect((await storage.repository.getDay(dayId))?.contentMd).toBe('Saved and still typing')
  })

  // The SQLite repository owns compatibility with existing OneDrive rows.
  it('reopens pre-extraction checkpoints and outbox entries without sharing them across providers', async () => {
    await connect()
    await storage.repository.saveDay(dayId, 'Saved')
    const legacyKey = '["alice","/drives/owner/items/notebook"]'
    const baseline = remoteDocument('Earlier')
    const state = { ...checkpoint(0), baseline, pending: { hash: 'pending-hash', base: baseline } }
    const event = { type: 'day-changed', dayId, item: '/drives/owner/items/day', revision: 'version-1' }
    const entry = { context: legacyKey, folder: target.folder, account: target.account, event }
    await storage.db.run('INSERT INTO onedrive_daily_state VALUES (?, ?, ?, ?, ?)',
      [legacyKey, dayId, 0, JSON.stringify(state), null])
    await storage.db.run('INSERT INTO onedrive_outbox VALUES (?, ?, ?)',
      [legacyKey, event.item, JSON.stringify(entry)])
    await storage.settings.setJsonSetting(`onedrive.progress:${legacyKey}`, {
      inventoryComplete: true, loaded: 1, total: 1, lastReconciledAt: 42,
    })

    storage = await reopenStorage(storage)
    const daily = await import('./dailySyncState')
    expect(await daily.getDailyState(target, dayId)).toEqual(state)
    expect(await daily.listDirtyDays(target)).toMatchObject([{ dayId }])
    expect(await daily.getNotebookProgress(target)).toMatchObject({ completedOnce: true, loaded: 1 })
    expect(await daily.readDailyOutbox(target)).toMatchObject([{ entry }])

    const other = { ...target, provider: 'dropbox' as const }
    expect(await daily.getDailyState(other, dayId)).toBeNull()
    expect(await daily.getNotebookProgress(other)).toMatchObject({ completedOnce: false, loaded: 0 })
    expect(await daily.readDailyOutbox(other)).toEqual([])
  })

  it('applies a remote day when no local edit is pending', async () => {
    await connect()
    const { assertTargetInDatabase } = await import('./oneDriveDailyState')
    await storage.repository.saveDay(dayId, 'Saved')
    const daily = await import('./dailySyncState')
    const sourceRevision = (await daily.getDayChange(dayId)).revision

    await daily.applyDailyDocument(target, assertTargetInDatabase, dayId, remoteDocument('Remote'), sourceRevision, checkpoint(sourceRevision))
    storage = await reopenStorage(storage)
    expect((await storage.repository.getDay(dayId))?.contentMd).toBe('Remote')
  })
})
