import { equivalentPermissions, canEstablishMigration, missingMigrationGrants, type Permission } from '../../functions/_lib/oneDrivePermissions'
import { isDedicatedNotebookFolder } from '../../functions/_lib/oneDriveNotebook'
import { authorizedOneDriveFetch } from './oneDriveAuth'
import { getOneDriveState, updateOneDriveState, runOneDriveStateExclusive, type OneDriveState } from './oneDriveState'
import { getJsonSetting, setJsonSetting } from './settingsRepository'
import { exportMarkdownFromDb, saveRollbackBackup } from './importExport'
import { listAllDays } from './dayRepository'
import { runAtomicDatabaseMutation } from './db'
import { executeSql, queryFirstRow } from './sqliteRuntime'
import { getPendingEditorDayIds } from './pendingEditorSaves'
import { splitNotebookDays, decodeNotebookDay, dayPath, encodeNotebookDay } from './notebookDays'
import { mergeOneDriveNotebooksWithAuthors } from './oneDriveMerge'
import { annotateLocalNotebook } from './oneDriveBlame'
import { notebookText } from './notebookMetadata'
import { markSyncLocalDirty } from './syncDirty'
import { hashSyncContent } from './syncHash'
import { writeDailyStateInDatabase, writeDayInDatabase, targetKey, persistDailyCheckpoint, type NotebookTarget } from './oneDriveDailyState'
import { childAtPath, downloadItem, ensureDayParent, ensureFolder, getItem, graphRequest, inventoryDays, itemAddress,
  requireFolder, resolveTarget, uploadDay, deleteItem, listChildren, DEFAULT_ONEDRIVE_PATH, type DriveItem } from './oneDriveGraph'

const REGISTRY = '/api/onedrive/migration'
type Registration = { destination?: string; status?: 'running' | 'complete'; generation?: number; lease?: string; expires?: number }
type Journal = { source: string; destination: string | null; snapshot: string; sourceETag: string; generation: number | null; lease: string | null; complete: boolean }
const journalKey = (account: string | null, source: string) => `onedrive.migration:${JSON.stringify([account, source])}`
const folderName = (source: DriveItem) => `Rivolo-${source.name.replace(/\.md$/i, '').replace(/["*:<>?\\|/]/g, '-').slice(0, 70)}-${encodeURIComponent(source.id).slice(0, 100)}`
const registryRequest = async (source: string, action: 'lookup' | 'claim' | 'complete' | 'renew', destination?: string, generation?: number, lease?: string) => {
  const response = await authorizedOneDriveFetch(REGISTRY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XmlHttpRequest' },
    body: JSON.stringify({ source, action, destination, generation, lease }) })
  if (!response.ok) {
    const message = (await response.json().catch(() => null) as { message?: string } | null)?.message
    throw new Error(message ?? 'OneDrive migration registry is unavailable. Sync waits; local notes remain available.')
  }
  return await response.json() as Registration
}
const assertContext = async (captured: OneDriveState) => {
  const state = await getOneDriveState()
  if (!state.connected || state.accountId !== captured.accountId || state.targetGeneration !== captured.targetGeneration || state.filePath !== captured.filePath) {
    throw new Error('OneDrive account or target changed during migration. The previous attempt was stopped.')
  }
}
const permissions = async (address: string) => {
  const result: Permission[] = []
  let next: string | undefined = `${address}/permissions`
  const seen = new Set<string>()
  while (next) {
    if (seen.has(next)) throw new Error('OneDrive permissions are incomplete. Ask the owner to check the folder sharing settings.')
    seen.add(next)
    const response = await graphRequest(next)
    const body = await response!.json() as { value: Permission[]; '@odata.nextLink'?: string }
    if (!Array.isArray(body.value)) throw new Error('OneDrive permissions could not be verified.')
    result.push(...body.value)
    next = body['@odata.nextLink']
  }
  return result
}
const assertMigrationAuthority = async (state: OneDriveState, sourceItem: DriveItem) => {
  let personalOwner = false
  try {
    const drive = await graphRequest('/me/drive?$select=id')
    personalOwner = (await drive!.json() as { id: string }).id === sourceItem.parentReference?.driveId
  } catch { /* An owner of a SharePoint library need not have a personal drive. */ }
  if (!personalOwner) {
    const drive = await graphRequest(`/drives/${encodeURIComponent(sourceItem.parentReference!.driveId)}?$select=driveType`)
    const type = (await drive!.json() as { driveType: string }).driveType
    if (!canEstablishMigration(await permissions(itemAddress(sourceItem)), state.accountId ?? '', type)) {
      throw new Error('OneDrive migration needs verified owner access, or explicit edit access in the original SharePoint library. Check access to the original file and its parent folder; local notes remain available.')
    }
  }
  await assertContext(state)
}
const verifyMigrationPermissions = async (state: OneDriveState, sourceItem: DriveItem, destination: string) => {
  const source = itemAddress(sourceItem)
  const [before, after] = await Promise.all([permissions(source), permissions(destination)])
  if (equivalentPermissions(before, after)) return
  const grants = missingMigrationGrants(before, after)
  if (grants && (grants.users.length || grants.organizationLinks.length)) {
    await assertMigrationAuthority(state, sourceItem)
    for (const grant of grants.users) {
      await assertContext(state)
      // Graph's invite endpoint with sendInvitation=false grants permission
      // directly; it does not send an invitation or create a public link.
      await graphRequest(`${destination}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: [{ objectId: grant.objectId }], roles: grant.roles, requireSignIn: true, sendInvitation: false, retainInheritedPermissions: true }) })
    }
    for (const type of grants.organizationLinks) {
      await assertContext(state)
      // Reproduce only an organization link already present on the source.
      // Never use this as a fallback for a users-only source.
      await graphRequest(`${destination}/createLink`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, scope: 'organization', retainInheritedPermissions: true }) })
    }
    if (equivalentPermissions(await permissions(source), await permissions(destination))) return
  }
  throw new Error('Migration needs the owner to give the dedicated Rivolo folder the same recipients and edit permissions as the original file. Check sharing settings and retry; access will not be widened automatically.')
}
const folderSharingLink = async (folder: string) => {
  try {
    const entries = await permissions(folder)
    return entries.find((entry) => entry.link?.type === 'edit' && ['users', 'organization'].includes(entry.link.scope ?? ''))?.link?.webUrl ?? null
  } catch { return null }
}
const equalNotes = (a: string, b: string) => notebookText(a).trimEnd() === notebookText(b).trimEnd()
const prepareSnapshot = async (state: OneDriveState, source: string, local: string, choice: 'local' | 'cloud' | undefined, editedAt: Map<string, number>) => {
  if (choice === 'cloud') return source
  const annotated = await annotateLocalNotebook(local, state.mergeBaseContent, state.accountName, editedAt)
  if (choice === 'local') return annotated
  if (!local.trim()) return source
  if (state.mergeBaseContent) return mergeOneDriveNotebooksWithAuthors(state.mergeBaseContent, annotated, source)
  if (equalNotes(local, source)) return source
  await saveRollbackBackup(local)
  await saveRollbackBackup(source)
  throw new Error('OneDrive migration found different notes without a shared baseline. Both copies are backed up. Choose the cloud version or keep this device’s notes in OneDrive settings.')
}

export const migrateOneDriveFile = async (state: OneDriveState, sourceItem: DriveItem, choice?: 'local' | 'cloud', selectedFolder?: DriveItem) => {
  const source = itemAddress(sourceItem)
  const baselineKey = `${journalKey(state.accountId, source)}:baseline`
  if (state.mergeBaseContent) {
    await setJsonSetting(baselineKey, state.mergeBaseContent)
    await persistDailyCheckpoint()
  }
  const migrationBase = state.mergeBaseContent ?? await getJsonSetting<string>(baselineKey)
  const snapshotState = { ...state, mergeBaseContent: migrationBase }
  await updateOneDriveState({ migrationSource: source, migrationStatus: 'running', migrationMessage: 'Migrating the notebook to daily files…' })
  const key = journalKey(state.accountId, source)
  let journal = await getJsonSetting<Journal>(key)
  let registration = await registryRequest(source, 'lookup') // Never create a divergent folder if the registry is unavailable.
  const editedAt = new Map((await listAllDays()).map((day) => [day.dayId, day.updatedAt]))
  const localText = await exportMarkdownFromDb()
  const remoteText = await downloadItem(sourceItem)
  const snapshot = await prepareSnapshot(snapshotState, remoteText, localText, choice, editedAt)
  if (!journal) {
    await saveRollbackBackup(localText)
    await saveRollbackBackup(remoteText)
    journal = { source, destination: registration.destination ?? null, snapshot, sourceETag: sourceItem.eTag, generation: null, lease: null, complete: false }
    await setJsonSetting(key, journal)
    await persistDailyCheckpoint()
  }
  let folder: DriveItem
  if (registration.destination) {
    if (selectedFolder && itemAddress(selectedFolder) !== registration.destination &&
      !(selectedFolder.id === sourceItem.parentReference?.id && selectedFolder.parentReference?.driveId === sourceItem.parentReference.driveId)) throw new Error('This notebook already has an assigned migration folder. Use that folder so all devices stay together.')
    folder = requireFolder((await getItem(registration.destination))!)
  }
  else {
    // Authority is checked before creating anything beside the source.
    await assertMigrationAuthority(state, sourceItem)
    if (!sourceItem.parentReference?.id) throw new Error('The original notebook parent folder could not be verified.')
    if (selectedFolder) {
      folder = requireFolder(selectedFolder)
      if (folder.id === sourceItem.parentReference.id && folder.parentReference?.driveId === sourceItem.parentReference.driveId) {
        folder = await ensureFolder(itemAddress(folder), folderName(sourceItem))
      } else if (folder.parentReference?.driveId !== sourceItem.parentReference.driveId || folder.parentReference.id !== sourceItem.parentReference.id) {
        throw new Error('Choose a dedicated Rivolo folder beside the original Markdown file, in the same drive.')
      }
    } else folder = await ensureFolder(`/drives/${encodeURIComponent(sourceItem.parentReference.driveId)}/items/${encodeURIComponent(sourceItem.parentReference.id)}`, folderName(sourceItem))
  }
  const destination = itemAddress(folder)
  await assertContext(state)
  if (registration.status !== 'complete') {
    if (!await isDedicatedNotebookFolder(folder, (item) => listChildren(itemAddress(item)))) throw new Error('Choose a folder dedicated to Rivolo, empty or containing only year/month/day Markdown files.')
    await verifyMigrationPermissions(state, sourceItem, destination)
    if (journal.lease && registration.generation === journal.generation && (registration.expires ?? 0) > Date.now()) {
      registration = await registryRequest(source, 'renew', destination, journal.generation!, journal.lease)
    } else registration = await registryRequest(source, 'claim', destination)
    journal = { ...journal, destination, lease: registration.lease ?? null, generation: registration.generation ?? null }
    await setJsonSetting(key, journal)
  }
  const completedElsewhere = registration.status === 'complete'
  const desired = await splitNotebookDays(snapshot)
  const legacyBase = migrationBase ? await splitNotebookDays(migrationBase) : new Map<string, string>()
  const localDays = localText.trim() ? await splitNotebookDays(localText) : new Map<string, string>()
  const inventory = await inventoryDays(destination)
  const final = new Map<string, { content: string; item: DriveItem }>()
  const localRevision = state.localRevision
  const assertSnapshot = async () => {
    await assertContext(state)
    if ((await getOneDriveState()).localRevision !== localRevision || getPendingEditorDayIds().size) {
      throw new Error('Notes changed during migration. The next sync will resume with your latest edits.')
    }
  }
  const allIds = new Set([...desired.keys(), ...inventory.keys(), ...legacyBase.keys()])
  for (const id of [...allIds].sort((a, b) => b.localeCompare(a))) {
    await assertSnapshot()
    if (!completedElsewhere && (registration.expires ?? 0) - Date.now() < 20_000) {
      registration = await registryRequest(source, 'renew', destination, journal.generation!, journal.lease!)
    }
    let existing = inventory.get(id) ?? null
    let remote = existing ? await downloadItem(existing) : null
    if (remote) decodeNotebookDay(remote, id)
    const base = legacyBase.get(id)
    let next = desired.get(id) ?? null
    if (completedElsewhere) {
      // A late/offline client transports only its changes since the old base;
      // unchanged legacy days cannot resurrect deletions in the daily folder.
      const ours = localDays.get(id)
      if (choice === 'cloud' || base && ours && equalNotes(ours, base) || !migrationBase && equalNotes(localText, remoteText)) next = remote
      else if (base && !ours) {
        if (existing) await deleteItem(existing, assertSnapshot)
        inventory.delete(id)
        next = null
      }
      else if (!ours) next = remote
      else if (remote) next = await mergeOneDriveNotebooksWithAuthors(base ?? encodeNotebookDay({ dayId: id, humanTitle: '', contentMd: '' }),
        await annotateLocalNotebook(ours, base ?? null, state.accountName, editedAt), remote)
      else next = base && equalNotes(ours, base) ? null : ours
    }
    if (!next) {
      if (!completedElsewhere && base && !desired.has(id) && existing) {
        await deleteItem(existing, assertSnapshot)
        inventory.delete(id)
      } else if (existing && remote) final.set(id, { content: remote, item: existing })
      continue
    }
    const copied = await getJsonSetting<{ content: string }>(`${key}:day:${id}`)
    if (!completedElsewhere && remote && !equalNotes(next, remote)) {
      next = await mergeOneDriveNotebooksWithAuthors(copied?.content ?? encodeNotebookDay({ dayId: id, humanTitle: '', contentMd: '' }), next, remote)
    }
    if (!remote || !equalNotes(remote, next)) {
      const parent = await ensureDayParent(destination, id)
      existing = await uploadDay(parent, id, existing, next, assertSnapshot)
      remote = next
    }
    const check = await getItem(childAtPath(destination, dayPath(id)))
    if (!check || check.eTag !== existing!.eTag || !equalNotes(await downloadItem(check), next)) throw new Error(`Migration verification failed for ${id}. Sync will resume without removing the original file.`)
    await setJsonSetting(`${key}:day:${id}`, { content: next, eTag: check.eTag })
    await persistDailyCheckpoint()
    final.set(id, { content: next, item: check })
  }
  await assertSnapshot()
  const latestSource = await getItem(source)
  if (latestSource?.eTag !== sourceItem.eTag) throw new Error('The original OneDrive file changed during migration. Sync will reconcile it before completing.')
  const finalInventory = await inventoryDays(destination)
  if (finalInventory.size !== final.size || [...finalInventory].some(([id, item]) => final.get(id)?.item.eTag !== item.eTag)) throw new Error('The migration folder changed during verification. Sync will resume.')
  if (!completedElsewhere) await registryRequest(source, 'complete', destination, journal.generation!, journal.lease!)
  const link = await folderSharingLink(destination)
  await assertSnapshot()
  const target: NotebookTarget = { provider: 'onedrive', folder: destination, account: state.accountId, generation: state.targetGeneration + 1 }
  const prepared = await Promise.all([...final].map(async ([id, result]) => ({ id, ...result, hash: await hashSyncContent(result.content) })))
  const currentDays = await listAllDays()
  await runOneDriveStateExclusive(() => runAtomicDatabaseMutation((db) => {
    const row = queryFirstRow<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', ['onedrive.state'])
    const current = JSON.parse(row?.value ?? '{}') as OneDriveState
    if (!current.connected || current.accountId !== state.accountId || current.filePath !== state.filePath || current.targetGeneration !== state.targetGeneration ||
        current.localRevision !== localRevision || getPendingEditorDayIds().size) throw new Error('Notes or OneDrive target changed during migration. Retry to keep the latest edits.')
    for (const local of currentDays) if (!final.has(local.dayId)) writeDayInDatabase(db, local.dayId, null)
    for (const result of prepared) {
      writeDayInDatabase(db, result.id, result.content)
      const revision = queryFirstRow<{ revision: number }>(db, 'SELECT revision FROM onedrive_day_changes WHERE day_id = ?', [result.id])?.revision ?? 0
      writeDailyStateInDatabase(db, target, { dayId: result.id, item: itemAddress(result.item), eTag: result.item.eTag, baseline: result.content,
        uploadedHash: result.hash, localRevision: revision, deleted: false })
    }
    for (const id of new Set([...localDays.keys(), ...legacyBase.keys()])) if (!final.has(id)) {
      const revision = queryFirstRow<{ revision: number }>(db, 'SELECT revision FROM onedrive_day_changes WHERE day_id = ?', [id])?.revision ?? 0
      writeDailyStateInDatabase(db, target, { dayId: id, item: null, eTag: null, baseline: null, uploadedHash: null, localRevision: revision, deleted: true })
    }
    const setting = (key: string, value: unknown) => executeSql(db, 'INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)])
    setting(`onedrive.progress:${targetKey(target)}`, { inventoryComplete: true, loaded: final.size, total: final.size, lastReconciledAt: Date.now() })
    setting(key, { ...journal, complete: true })
    setting('onedrive.state', { ...current, filePath: link ?? destination, folderId: destination, targetGeneration: target.generation,
      migrationStatus: 'complete', migrationMessage: null, migrationSource: source, lastRemoteRev: null, lastPushedHash: null,
      mergeBaseContent: null, lastSyncAt: Date.now(), localDirty: false })
  }))
  await markSyncLocalDirty(undefined, { excludeProvider: 'onedrive' })
  await persistDailyCheckpoint()
  return target
}

let preparing: Promise<NotebookTarget> | null = null
export const prepareOneDriveNotebook = (choice?: 'local' | 'cloud') => {
  if (preparing) return preparing
  preparing = (async (): Promise<NotebookTarget> => {
    let state = await getOneDriveState()
    if (!state.connected) throw new Error('Connect OneDrive before syncing.')
    if (!state.accountId) {
      const response = await graphRequest('/me?$select=id,displayName,mail,userPrincipalName')
      const account = await response!.json() as { id: string; displayName?: string; mail?: string; userPrincipalName?: string }
      if (!account.id) throw new Error('OneDrive account identity is unavailable. Reconnect OneDrive before syncing.')
      await assertContext(state)
      await updateOneDriveState({ accountId: account.id, accountName: account.displayName ?? null, accountEmail: account.mail ?? account.userPrincipalName ?? null })
      state = await getOneDriveState()
    }
    if (state.folderId && state.migrationStatus === 'complete') return { provider: 'onedrive', folder: state.folderId, account: state.accountId, generation: state.targetGeneration }
    if (getPendingEditorDayIds().size) throw new Error('OneDrive is waiting for your drafts to be saved before preparing the notebook.')
    try {
      const target = state.filePath || DEFAULT_ONEDRIVE_PATH
      let item = await resolveTarget(target)
      if (!item && target.toLowerCase().endsWith('.md')) {
        // No legacy file exists: initialize a new dedicated daily notebook.
        item = await resolveTarget(DEFAULT_ONEDRIVE_PATH)
        if (!item) item = await ensureFolder('/me/drive/root', 'Rivolo')
      } else if (!item && !target.startsWith('https://')) {
        const parts = target.slice(1).split('/')
        let parent = '/me/drive/root'
        for (const part of parts) { item = await ensureFolder(parent, part); parent = itemAddress(item) }
      }
      if (!item) throw new Error('OneDrive notebook not found. Check the folder link or ask its owner for access.')
      if (item.file) return await migrateOneDriveFile(state, item, choice)
      requireFolder(item)
      // If a blocked migration's folder is pasted, complete the source mapping
      // and verification first; this cannot bypass the migration barrier.
      if (state.migrationSource && state.migrationStatus !== 'complete') {
        const source = await getItem(state.migrationSource)
        if (source?.file) return await migrateOneDriveFile(state, source, choice, item)
      }
      const folder = itemAddress(item)
      await assertContext(state)
      await updateOneDriveState({ folderId: folder, migrationStatus: 'complete', migrationMessage: null, lastRemoteRev: null })
      return { provider: 'onedrive', folder, account: state.accountId, generation: state.targetGeneration }
    } catch (error) {
      await assertContext(state)
      await updateOneDriveState({ migrationStatus: 'blocked', migrationMessage: error instanceof Error ? error.message : 'OneDrive migration is waiting. Local notes remain available.' })
      throw error
    }
  })().finally(() => { preparing = null })
  return preparing
}
