import { getDay, listAllDays } from './dayRepository'
import { saveRollbackBackup, exportMarkdownFromDb } from './importExport'
import { getPendingEditorDayIds } from './pendingEditorSaves'
import { encodeNotebookDay, decodeNotebookDay, type DailyRemoteFile } from './notebookDays'
import { annotateLocalNotebook } from './oneDriveBlame'
import { mergeOneDriveNotebooksWithAuthors } from './oneDriveMerge'
import { markSyncLocalDirty } from './syncDirty'
import { hashSyncContent } from './syncHash'
import { SYNC_PROVIDER_LABELS, type SyncProviderId } from './syncState'
import { getDailyState, getDayChange, listDirtyDays, listDailyStateIds, listDailyErrors, commitDailyCheckpoint,
  getNotebookProgress, setNotebookProgress, targetKey, applyDailyDocument, writeDailyState, type DailyEvent, type DailyState, type NotebookTarget, type TargetGuard } from './dailySyncState'
import type { SyncPullOptions, SyncPushResult } from './sync'

const emptyBase = (id: string, title?: string) => encodeNotebookDay({ dayId: id, humanTitle: title ?? '', contentMd: '' })
// A successful write must return the exact revision of the submitted content.
// Providers that cannot confirm that guarantee must report a failed write;
// the engine keeps the pending upload and does not advance the checkpoint.
export type DailySyncDriver<File extends DailyRemoteFile> = {
  provider: SyncProviderId
  durablePending?: boolean
  protectChangedDeletion?: boolean
  findByRef?(folder: string, dayId: string, ref: string): Promise<File | null>
  isDeleteUncertain?(error: unknown): boolean
  assertTarget(target: NotebookTarget): Promise<void>
  assertTargetInDatabase: TargetGuard
  accountName(): Promise<string | null>
  updateSummary(dirty: boolean): Promise<unknown>
  inventory(folder: string): Promise<Map<string, File>>
  stat(folder: string, dayId: string): Promise<File | null>
  exists(ref: string): Promise<boolean>
  assertFolder(folder: string): Promise<void>
  download(file: File, dayId: string): Promise<string>
  prepareWrite(folder: string, dayId: string, current: File | null, createRef?: string): Promise<((content: string, beforeCommit: () => Promise<void>) => Promise<File>) & { createRef?: string }>
  recoverPending?(file: File, previousRevision: string, content: string): Promise<string>
  remove(file: File, beforeCommit: () => Promise<void>): Promise<void>
  isConflict(error: unknown): boolean
}

export const createDailySync = <File extends DailyRemoteFile>(driver: DailySyncDriver<File>) => {
  const label = SYNC_PROVIDER_LABELS[driver.provider]
  const assertTarget = driver.assertTarget
  const deferredByTarget = new Map<string, Set<string>>()
  const deferredFor = (target: NotebookTarget) => {
    const key = targetKey(target)
    if (!deferredByTarget.has(key)) deferredByTarget.set(key, new Set())
    return deferredByTarget.get(key)!
  }
  const freshState = (id: string): DailyState => ({ dayId: id, item: null, eTag: null, baseline: null, uploadedHash: null, localRevision: 0, deleted: false })
  const assertDayUnchanged = async (target: NotebookTarget, id: string, revision: number) => {
    await assertTarget(target)
    if (getPendingEditorDayIds().has(id) || (await getDayChange(id)).revision !== revision) {
      throw new Error(`${label} ${id}: local edits are waiting to be reconciled.`)
    }
  }
  // One whole-notebook backup per sync pass, taken before the first day is
  // replaced. Restoring a backup replaces every note, so a backup holding a
  // single day would be unsafe to restore, and one per day would push the
  // earlier backups out of the retained list.
  type PassBackup = () => Promise<void>
  const createPassBackup = (): PassBackup => {
    let saved: Promise<void> | null = null
    return () => saved ??= (async () => { await saveRollbackBackup(await exportMarkdownFromDb()) })()
  }
  const applyDay = async (target: NotebookTarget, id: string, content: string | null, revision: number, state: DailyState, backup: PassBackup) => {
    const current = await getDay(id)
    if (current) await backup()
    await assertDayUnchanged(target, id, revision)
    const nextRevision = await applyDailyDocument(target, driver.assertTargetInDatabase, id, content, revision, state)
    await markSyncLocalDirty([id], { excludeProvider: driver.provider })
    return nextRevision
  }
  const readRemote = async (item: File, id: string) => {
    const text = await driver.download(item, id)
    decodeNotebookDay(text, id)
    return text
  }
  const checkpoint = async (target: NotebookTarget, state: DailyState, event?: DailyEvent) => {
    await commitDailyCheckpoint(target, driver.assertTargetInDatabase, { ...state, error: null, pending: null, deleteUncertain: undefined }, event)
  }
  const recordFailure = async (target: NotebookTarget, id: string, error: unknown) => {
    await assertTarget(target)
    const state = await getDailyState(target, id) ?? freshState(id)
    await commitDailyCheckpoint(target, driver.assertTargetInDatabase, { ...state, error: error instanceof Error ? error.message : `${label} daily sync failed.`,
      ...(driver.isDeleteUncertain?.(error) ? { deleteUncertain: true } : {}) })
  }

  const reconcileDay = async (target: NotebookTarget, id: string, mode: 'pull' | 'push', force = false, known?: File | null, backup: PassBackup = createPassBackup()) => {
    const deferred = deferredFor(target)
    if (getPendingEditorDayIds().has(id)) { deferred.add(id); return { uploaded: false, applied: false } }
    deferred.delete(id)
    const stored = await getDailyState(target, id) ?? freshState(id)
    // Reaching a point with nothing left to do means an earlier failure for
    // this day is resolved, even though no checkpoint is otherwise written.
    const settled = async () => {
      if (stored.error) await commitDailyCheckpoint(target, driver.assertTargetInDatabase, { ...stored, error: null })
      return { uploaded: false, applied: false }
    }
    const change = await getDayChange(id)
    const local = await getDay(id)
    let uploaded = false
    let applied = false
    let appliedRevision = change.revision
    let observedMissing = false
    for (let attempt = 0; attempt < 3; attempt++) {
      await assertTarget(target)
      let remote = attempt === 0 && known !== undefined ? known : await driver.stat(target.folder, id)
      const createRef = stored.pending?.createRef
      if (createRef && remote?.ref !== createRef) {
        const reserved = await driver.findByRef?.(target.folder, id, createRef)
        if (reserved && remote) throw new Error(`${label} has more than one file for ${id}. Keep the merged copy and move the extra file out of the notebook.`)
        remote ??= reserved ?? null
      }
      if (!remote && stored.item && !stored.deleted) {
        remote = await driver.findByRef?.(target.folder, id, stored.item) ?? null
      }
      if (!remote) observedMissing = true
      if (stored.item && remote && remote.ref !== stored.item) {
        // A replacement at the same valid path is reconciled from its content.
        if (await driver.exists(stored.item)) throw new Error(`${label} ${id}: the original file moved. Check the notebook folder.`)
      }
      if (!remote && stored.item && !stored.deleted) {
        const old = await driver.exists(stored.item)
        if (old) throw new Error(`${label} ${id}: file moved or renamed. Restore its path before syncing.`)
      }
      const dirty = change.revision !== stored.localRevision
      // A day this device never synced may hold a collaborator's notes it has
      // not seen. Deleting the local copy must not delete that file: it is
      // downloaded below instead, like any other unknown remote day.
      const unknownRemote = Boolean(remote) && !stored.item && !stored.baseline
      if (change.deleted && dirty && !(force && mode === 'pull') && !unknownRemote) {
        if (!force && stored.deleteUncertain) throw new Error(stored.error ?? `${label} could not verify the deletion of ${id}.`)
        if (!force && driver.protectChangedDeletion && remote && remote.revision !== stored.eTag) {
          throw new Error(`${label} ${id} changed after you last synced. Review the cloud copy before retrying the deletion.`)
        }
        if (remote) {
          // Fetch and validate before deletion; a local explicit deletion wins
          // against an edit but never removes an unrelated or malformed document.
          await readRemote(remote, id)
          try { await driver.remove(remote, () => assertDayUnchanged(target, id, change.revision)) }
          catch (error) { if (driver.isConflict(error)) continue; throw error }
          uploaded = true
        }
        await checkpoint(target, { ...stored, item: remote ? remote.ref : stored.item, eTag: null, baseline: null, uploadedHash: null, localRevision: change.revision, deleted: true },
          uploaded ? { type: 'inventory-invalidated', revision: crypto.randomUUID() } : undefined)
        return { uploaded, applied }
      }
      if (!remote) {
        if (stored.item && !dirty || force && mode === 'pull') {
          // Already recorded as deleted: nothing to apply or save again.
          if (!local && !dirty && stored.deleted && !stored.eTag && !stored.baseline) return settled()
          if (local) {
            // Both lookups answer "not found" when the notebook folder itself
            // was deleted or access was revoked. Confirm the folder is still
            // there before treating this as one deleted day.
            await driver.assertFolder(target.folder)
            appliedRevision = await applyDay(target, id, null, change.revision, { ...stored, baseline: null, eTag: null, deleted: true }, backup)
            applied = true
          }
          await checkpoint(target, { ...stored, eTag: null, baseline: null, localRevision: appliedRevision, deleted: true })
          return { uploaded, applied }
        }
        if (!local || mode === 'pull' && !dirty || stored.deleted && !dirty) return settled()
        // A local edit against a confirmed remote deletion recreates only that day.
      }
      if (!local && !remote) return settled()
      if (remote && remote.revision === stored.eTag && !stored.pending && !dirty && stored.baseline && !(force && mode === 'pull')) return settled()
      const observedText = remote ? (remote.revision === stored.eTag && stored.baseline && stored.uploadedHash === await hashSyncContent(stored.baseline)
        ? stored.baseline : await readRemote(remote, id)) : null
      // The remote file is this device's own upload whose reply or checkpoint
      // was lost: merge from the local document that upload was built from, so
      // lines it already contains are not added a second time.
      const recoveredUpload = stored.pending && observedText && stored.pending.hash === await hashSyncContent(observedText)
      let remoteText = observedText
      if (recoveredUpload && remote && stored.pending?.remoteRevision && remote.revision !== stored.pending.remoteRevision) {
        remoteText = await driver.recoverPending?.(remote, stored.pending.remoteRevision, observedText!) ?? observedText
      }
      const baseline = recoveredUpload ? stored.pending!.base : stored.baseline
      if (!force && !baseline && !observedMissing && local && remoteText) {
        const cloud = decodeNotebookDay(remoteText, id)
        // On a device that already downloaded the whole notebook, a day without
        // a baseline was created on both sides since: combine them from an empty
        // base. A first sync against unknown notes still needs an explicit choice.
        if ((cloud.contentMd !== local.contentMd || cloud.humanTitle !== local.humanTitle) && !(await getNotebookProgress(target)).completedOnce) {
          throw new Error(`${label} ${id}: this folder contains different notes without a shared baseline. Choose the cloud version or keep this device's days in ${label} settings.`)
        }
      }
      const localText = local ? await annotateLocalNotebook(encodeNotebookDay(local), baseline ?? emptyBase(id, local.humanTitle), await driver.accountName(), local.updatedAt) : null
      let merged = remoteText ?? localText!
      if (force) merged = mode === 'pull' ? remoteText! : localText ?? remoteText!
      else if (localText && remoteText) merged = await mergeOneDriveNotebooksWithAuthors(baseline ?? emptyBase(id), localText, remoteText)
      else if (mode === 'pull' && remoteText) merged = remoteText
      decodeNotebookDay(merged, id)
      if (observedText !== merged && (mode === 'push' || dirty)) {
        const write = await driver.prepareWrite(target.folder, id, remote, stored.pending?.createRef)
        const hash = await hashSyncContent(merged)
        await assertTarget(target)
        const pendingState = {
          ...(await getDailyState(target, id) ?? stored),
          pending: { hash, base: localText ?? merged, ...(driver.recoverPending && remote ? { remoteRevision: remote.revision } : {}),
            ...(write.createRef ? { createRef: write.createRef } : {}) },
        }
        if (driver.durablePending) await commitDailyCheckpoint(target, driver.assertTargetInDatabase, pendingState)
        else await writeDailyState(target, pendingState)
        let result: File
        try { result = await write(merged, () => assertTarget(target)) }
        catch (error) { if (driver.isConflict(error)) continue; throw error }
        uploaded = true
        // Until additions reach the editor, the baseline remains its captured
        // local document. The uploaded hash makes the next pass fetch the remote.
        await checkpoint(target, { ...stored, item: result.ref, eTag: result.revision, baseline: localText ?? merged,
          uploadedHash: hash, localRevision: localText === merged ? change.revision : stored.localRevision, deleted: false },
          { type: 'day-changed', dayId: id, item: result.ref, revision: result.revision })
        try {
          await assertDayUnchanged(target, id, change.revision)
          if (!local || decodeNotebookDay(merged, id).contentMd !== local.contentMd || decodeNotebookDay(merged, id).humanTitle !== local.humanTitle) {
            appliedRevision = await applyDay(target, id, merged, change.revision, { ...stored, item: result.ref, eTag: result.revision, baseline: merged, uploadedHash: hash, deleted: false, pending: null }, backup)
            applied = true
          }
          await checkpoint(target, { ...stored, item: result.ref, eTag: result.revision, baseline: merged, uploadedHash: hash,
            localRevision: appliedRevision, deleted: false })
        } catch (error) {
          deferred.add(id)
          await recordFailure(target, id, error)
        }
        return { uploaded, applied }
      }
      // Applying a download is guarded per day, so a draft in another day does
      // not stop catch-up or overwrite its editor.
      await assertDayUnchanged(target, id, change.revision)
      if (!local || decodeNotebookDay(merged, id).contentMd !== local.contentMd || decodeNotebookDay(merged, id).humanTitle !== local.humanTitle) {
        appliedRevision = await applyDay(target, id, merged, change.revision, { ...stored, item: remote ? remote.ref : stored.item, eTag: remote?.revision ?? stored.eTag, baseline: merged, uploadedHash: await hashSyncContent(merged), deleted: false, pending: null }, backup)
        applied = true
      }
      await checkpoint(target, { ...stored, item: remote ? remote.ref : stored.item, eTag: remote?.revision ?? stored.eTag,
        baseline: merged, uploadedHash: await hashSyncContent(merged), localRevision: appliedRevision, deleted: false })
      return { uploaded, applied }
    }
    throw new Error(`${label} ${id}: other writers are still updating this day. Sync will retry.`)
  }

  const refreshDailySummary = async (target: NotebookTarget) => {
    await assertTarget(target)
    const dirty = await listDirtyDays(target)
    const errors = await listDailyErrors(target)
    await driver.updateSummary(dirty.length > 0)
    return errors.join(' ')
  }
  const pushDailyNotebook = async (target: NotebookTarget, force = false): Promise<SyncPushResult> => {
    const deferred = deferredFor(target)
    const dirty = await listDirtyDays(target)
    const ids = new Set([...dirty.map((day) => day.dayId), ...deferred])
    if (force) for (const day of await listAllDays()) if (day.contentMd || await getDailyState(target, day.dayId)) ids.add(day.dayId)
    let uploaded = false, applied = false
    const backup = createPassBackup()
    for (const id of ids) {
      try {
        const result = await reconcileDay(target, id, 'push', force, undefined, backup)
        uploaded ||= result.uploaded
        applied ||= result.applied
      } catch (error) { await recordFailure(target, id, error) }
    }
    const attention = await refreshDailySummary(target)
    if (attention && !uploaded && !applied) throw new Error(attention)
    return uploaded || applied ? { status: 'pushed', ...(applied ? { localUpdated: true } : {}), ...(attention ? { attention } : {}) } : { status: 'clean' }
  }
  const pullDailyNotebook = async (target: NotebookTarget, options: SyncPullOptions = {}) => {
    const deferred = deferredFor(target)
    const ids = options.dayIds
    // Days deferred earlier are looked up too: a day absent from this map is
    // treated as missing from the remote inventory.
    const inventory = ids ? new Map(await Promise.all([...new Set([...ids, ...deferred])].map(async (id) => [id, await driver.stat(target.folder, id)] as const))) : await driver.inventory(target.folder)
    const stored = new Set(ids ? [] : await listDailyStateIds(target))
    // Missing entries are checked individually by ID inside reconcileDay. This
    // only runs once every page of the inventory has been acquired successfully.
    const work = new Set([...inventory.keys(), ...stored, ...deferred])
    const sorted = [...work].sort((a, b) => b.localeCompare(a))
    let applied = false, loaded = 0
    const failures: string[] = []
    if (!ids) await setNotebookProgress(target, { inventoryComplete: false, loaded: 0, total: sorted.length, lastReconciledAt: null })
    const backup = createPassBackup()
    if (options.force && !ids) await backup()
    for (const id of sorted) {
      try {
        const result = await reconcileDay(target, id, 'pull', options.force, inventory.get(id) ?? null, backup)
        applied ||= result.applied
        if (!getPendingEditorDayIds().has(id)) loaded++
        if (!ids) await setNotebookProgress(target, { inventoryComplete: false, loaded, total: sorted.length, lastReconciledAt: null })
      } catch (error) {
        await recordFailure(target, id, error)
        failures.push(error instanceof Error ? error.message : `${label} download failed.`)
      }
    }
    if (options.force && !ids && !failures.length) {
      for (const local of await listAllDays()) {
        if (inventory.has(local.dayId) || stored.has(local.dayId)) continue
        const change = await getDayChange(local.dayId)
        if (getPendingEditorDayIds().has(local.dayId)) { deferred.add(local.dayId); continue }
        const appliedRevision = await applyDay(target, local.dayId, null, change.revision, { ...freshState(local.dayId), deleted: true }, backup)
        await checkpoint(target, { ...freshState(local.dayId), deleted: true, localRevision: appliedRevision })
        applied = true
      }
    }
    if (!ids) await setNotebookProgress(target, { inventoryComplete: !failures.length && loaded === sorted.length, loaded, total: sorted.length, lastReconciledAt: Date.now() })
    const attention = await refreshDailySummary(target)
    if (attention) throw new Error(attention)
    return { status: applied ? 'pulled' as const : 'noop' as const, ...(deferred.size ? { deferredDayIds: [...deferred] } : {}) }
  }

  return { pullDailyNotebook, pushDailyNotebook }
}
