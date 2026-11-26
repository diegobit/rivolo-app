// Microsoft Graph access for daily OneDrive notebooks. This module has no
// browser dependencies, so the app and the hosted MCP Worker share it.
import { dayPath } from './notebookDays'
import { isValidDayId } from './dates'

export const GRAPH = 'https://graph.microsoft.com/v1.0'
export const DEFAULT_ONEDRIVE_PATH = '/Rivolo'
export type DriveItem = {
  id: string; name: string; eTag: string; file?: object; folder?: object
  parentReference?: { driveId: string; id?: string }
  remoteItem?: DriveItem; webUrl?: string
  lastModifiedDateTime?: string
  '@microsoft.graph.downloadUrl'?: string
}
export const itemAddress = (item: DriveItem) => {
  if (!item.id || !item.parentReference?.driveId) throw new Error('OneDrive returned an invalid item reference.')
  return `/drives/${encodeURIComponent(item.parentReference.driveId)}/items/${encodeURIComponent(item.id)}`
}
export const validItemAddress = (value: unknown): boolean => typeof value === 'string' &&
  /^\/drives\/[A-Za-z0-9!_%.-]+\/items\/[A-Za-z0-9!_%.-]+$/.test(value) && value.length < 1024
export const validateOneDriveTarget = (value: string) => {
  const target = value.trim() || DEFAULT_ONEDRIVE_PATH
  if (validItemAddress(target)) return target
  if (target.startsWith('https://')) {
    const url = new URL(target)
    if (url.username || url.password) throw new Error('Use a OneDrive sharing link without credentials.')
    return target
  }
  if (!target.startsWith('/') || target === '/' || target.split('/').slice(1).some((part) =>
    !part || part === '.' || part === '..' || /["*:<>?\\|]/.test(part)) || /\.[^/]+$/.test(target) && !target.toLowerCase().endsWith('.md')) {
    throw new Error('Enter a OneDrive folder sharing link or an absolute folder path, such as /Rivolo.')
  }
  return target
}
const shareId = (url: string) => {
  let binary = ''
  for (const byte of new TextEncoder().encode(url)) binary += String.fromCharCode(byte)
  return `u!${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}
const encodedPath = (path: string) => path.split('/').map(encodeURIComponent).join('/')
export class GraphConflict extends Error {
  readonly status: number
  constructor(message = 'OneDrive changed while syncing. Retry to merge the newer copy.', status = 412) { super(message); this.status = status }
}
export class GraphError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
export const requireFolder = (item: DriveItem) => {
  if (!item.folder) throw new Error('Choose a OneDrive notebook folder shared with permission to edit.')
  itemAddress(item)
  return item
}
export const childAtPath = (folder: string, path: string) => `${folder}:/${encodedPath(path)}`
// Month folders are listed a few at a time: one request each, so a notebook
// spanning years would otherwise wait on dozens of sequential round trips.
const INVENTORY_CONCURRENCY = 4
const mapLimited = async <T, R>(values: T[], task: (value: T) => Promise<R>) => {
  const results = new Array<R>(values.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(INVENTORY_CONCURRENCY, values.length) }, async () => {
    while (next < values.length) { const index = next++; results[index] = await task(values[index]) }
  }))
  return results
}
const contentPath = (parent: string, name: string) => `${childAtPath(parent, name)}:/content?@microsoft.graph.conflictBehavior=fail`

// Workers supports no-store, though its RequestInit declaration omits cache.
type GraphRequestInit = Omit<RequestInit, 'cache'> & { cache?: 'no-store' }
type Fetch = (input: string, init?: GraphRequestInit) => Promise<Response>
export type OneDriveGraphOptions = {
  // Adds the Microsoft bearer token. Used only for Graph URLs.
  authorizedFetch: Fetch
  // Identifies the signed-in account for cached per-drive checks.
  accountKey: () => Promise<string | null>
  // Plain fetch for preauthenticated download and upload-session URLs, which
  // must never receive Graph credentials. Defaults to the global fetch.
  fetch?: Fetch
}

// Throttling and per-drive verification state belong to one instance, so each
// account or Worker request keeps its own.
export const createOneDriveGraph = (options: OneDriveGraphOptions) => {
  const plainFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init))
  let retryAfterAt = 0
  const driveTypes = new Map<string, string>()
  const verifiedContentConditions = new Set<string>()

  const graphRequest = async (address: string, init: GraphRequestInit = {}, missing = false) => {
    if (Date.now() < retryAfterAt) throw new Error('OneDrive is busy. Sync will retry automatically shortly.')
    const url = address.startsWith(GRAPH + '/') ? address : GRAPH + address
    if (!url.startsWith(GRAPH + '/')) throw new Error('Invalid OneDrive Graph URL.')
    const response = await options.authorizedFetch(url, { cache: 'no-store', ...init })
    if (missing && response.status === 404) return null
    if (response.status === 409 || response.status === 412) throw new GraphConflict(undefined, response.status)
    if (!response.ok) {
      if (response.status === 429 || response.status === 503) {
        const retry = response.headers.get('Retry-After')
        retryAfterAt = Date.now() + (retry && Number.isFinite(Number(retry)) ? Math.max(1, Number(retry)) * 1000 : Math.max(60_000, Date.parse(retry ?? '') - Date.now() || 0))
      }
      throw new GraphError(response.status === 403 ? 'OneDrive access denied. Ask the owner for edit access to the notebook folder.' :
        response.status === 429 ? 'OneDrive is busy. Sync will retry later.' : `OneDrive request failed (${response.status}). Retry or check folder access.`, response.status)
    }
    return response
  }
  const getItem = async (address: string, missing = false) => {
    const response = await graphRequest(address, {}, missing)
    return response ? await response.json() as DriveItem : null
  }
  const resolveTarget = async (target: string): Promise<DriveItem | null> => {
    validateOneDriveTarget(target)
    const shared = target.startsWith('https://')
    const address = shared ? `/shares/${shareId(target)}/driveItem` : validItemAddress(target) ? target : `/me/drive/root:${encodedPath(target)}`
    const response = await graphRequest(address, shared ? { headers: { Prefer: 'redeemSharingLink' } } : {}, !shared)
    if (!response) return null
    let item = await response.json() as DriveItem
    if (item.remoteItem) item = (await getItem(itemAddress(item.remoteItem)))!
    itemAddress(item)
    return item
  }
  const downloadItem = async (item: DriveItem) => {
    const url = item['@microsoft.graph.downloadUrl']
    if (!url?.startsWith('https://')) throw new Error('OneDrive did not provide a download URL.')
    const response = await plainFetch(url, { cache: 'no-store' })
    if (!response.ok) throw new GraphError(`OneDrive download failed (${response.status}). Retry.`, response.status)
    return response.text()
  }
  const ensureFolder = async (parent: string, name: string) => {
    const existing = await getItem(childAtPath(parent, name), true)
    if (existing) return requireFolder(existing)
    try {
      const response = await graphRequest(`${parent}/children`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) })
      return requireFolder(await response!.json() as DriveItem)
    } catch (error) {
      if (!(error instanceof GraphConflict)) throw error
      return requireFolder((await getItem(childAtPath(parent, name)))!)
    }
  }
  const listChildren = async (folder: string) => {
    const items: DriveItem[] = []
    let next: string | undefined = `${folder}/children?$top=200`
    const seen = new Set<string>()
    while (next) {
      if (seen.has(next)) throw new Error('OneDrive returned a repeated inventory page. Retry.')
      seen.add(next)
      if (next.startsWith('https://') && !next.startsWith(GRAPH + '/')) throw new Error('Invalid OneDrive inventory page.')
      const response = await graphRequest(next)
      const page = await response!.json() as { value: DriveItem[]; '@odata.nextLink'?: string }
      if (!Array.isArray(page.value)) throw new Error('OneDrive inventory is incomplete. Retry.')
      items.push(...page.value)
      next = page['@odata.nextLink']
    }
    return items
  }
  const inventoryDays = async (folder: string) => {
    const result = new Map<string, DriveItem>()
    const years = (await listChildren(folder)).filter((year) => year.folder && /^\d{4}$/.test(year.name))
    const months = (await mapLimited(years, async (year) => (await listChildren(itemAddress(year)))
      .filter((month) => month.folder && /^(0[1-9]|1[0-2])$/.test(month.name)).map((month) => ({ year, month })))).flat()
    const listings = await mapLimited(months, async ({ year, month }) => ({ year, month, files: await listChildren(itemAddress(month)) }))
    for (const { year, month, files } of listings) {
      for (const file of files) {
        if (!file.file || !/^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) continue
        const id = file.name.slice(0, -3)
        // A file with an impossible date, or in another month's folder, is not a
        // notebook day. Like any other foreign file it is left alone, so it
        // cannot stop every other day from downloading.
        if (!isValidDayId(id) || dayPath(id) !== `${year.name}/${month.name}/${file.name}`) {
          console.warn('[OneDrive] inventory:ignored-file', { name: file.name, folder: `${year.name}/${month.name}` })
          continue
        }
        result.set(id, file)
      }
    }
    return result
  }
  const ensureDayParent = async (folder: string, dayId: string) => {
    dayPath(dayId)
    const year = await ensureFolder(folder, dayId.slice(0, 4))
    return itemAddress(await ensureFolder(itemAddress(year), dayId.slice(5, 7)))
  }

  const putContent = async (address: string, content: string, condition: Record<string, string>) => {
    const response = await graphRequest(address, { method: 'PUT', headers: { 'Content-Type': 'text/markdown; charset=utf-8', ...condition }, body: content })
    return await response!.json() as DriveItem
  }
  const verifyContentConditions = async (parent: string, key: string, guard: () => Promise<void>) => {
    if (verifiedContentConditions.has(key)) return
    const name = `.rivolo-condition-${crypto.randomUUID()}.txt`
    const path = contentPath(parent, name)
    let probe: DriveItem | null = null
    const unsupported = () => new Error('This OneDrive/SharePoint drive did not verify conditional file writes. Notes were not uploaded. Retry or check the account’s Graph support.')
    const expectCondition = async (operation: () => Promise<DriveItem>, statuses = [412]) => {
      try { probe = await operation() } catch (error) {
        if (error instanceof GraphConflict && statuses.includes(error.status)) return
        throw error
      }
      throw unsupported()
    }
    try {
      await guard()
      probe = await putContent(path, 'Rivolo conditional upload check', { 'If-None-Match': '*' })
      if (!probe.file || probe.name !== name || !probe.eTag) throw unsupported()
      const original = probe.eTag
      await expectCondition(() => putContent(`${itemAddress(probe!)}/content`, 'Rejected revision check', { 'If-Match': `"${crypto.randomUUID()}"` }))
      await guard()
      probe = await putContent(`${itemAddress(probe)}/content`, 'Rivolo verified update', { 'If-Match': original })
      if (!probe.eTag || probe.eTag === original) throw unsupported()
      await expectCondition(() => putContent(`${itemAddress(probe!)}/content`, 'Rejected stale revision', { 'If-Match': original }))
      await expectCondition(() => putContent(path, 'Rejected duplicate creation', { 'If-None-Match': '*' }), [409, 412])
      await guard()
    } finally {
      // This is an app-created probe containing no notes, never a user's file.
      // Re-read its revision before cleanup in case a failed check changed it.
      if (probe) {
        await guard()
        const latest = await getItem(itemAddress(probe), true)
        if (latest?.name === name) await deleteItem(latest, guard)
      }
    }
    verifiedContentConditions.add(key)
  }

  const uploadBusinessDay = async (parent: string, id: string, current: DriveItem | null, content: string, guard: () => Promise<void>, key: string) => {
    // Graph's deferred sourceUrl commit is personal-only. Business uses the
    // small-file endpoint after checking actual server conditional behavior on
    // a disposable probe, including a stale update and duplicate creation.
    await verifyContentConditions(parent, key, guard)
    if (new TextEncoder().encode(content).byteLength > 250 * 1024 * 1024) throw new Error('This daily file exceeds Microsoft Graph’s 250 MB conditional content upload limit for this drive.')
    await guard()
    const uploaded = await putContent(current ? `${itemAddress(current)}/content` : contentPath(parent, `${id}.md`), content,
      current ? { 'If-Match': current.eTag } : { 'If-None-Match': '*' })
    if (!uploaded.file || !uploaded.eTag || uploaded.name !== `${id}.md`) throw new Error('OneDrive returned an invalid daily upload result.')
    itemAddress(uploaded)
    return uploaded
  }

  // The final commit carries the precondition. A precondition on session creation
  // alone does not protect against another writer finishing while bytes upload.
  // Unsupported commit APIs fail closed; never retry with an unconditional PUT.
  const uploadDay = async (parent: string, dayId: string, current: DriveItem | null, content: string, beforeCommit: () => Promise<void>) => {
    const drive = parent.match(/^\/drives\/([^/]+)\/items\//)?.[1]
    if (!drive) throw new Error('Invalid OneDrive upload parent.')
    const key = JSON.stringify([await options.accountKey(), drive])
    let type = driveTypes.get(key)
    if (!type) {
      const response = await graphRequest(`/drives/${drive}?$select=driveType`)
      type = (await response!.json() as { driveType: string }).driveType
      if (!['personal', 'business', 'documentLibrary'].includes(type)) throw new Error('OneDrive drive type could not be verified before upload.')
      driveTypes.set(key, type)
    }
    if (type !== 'personal') return uploadBusinessDay(parent, dayId, current, content, beforeCommit, key)
    const address = current ? itemAddress(current) : `${childAtPath(parent, `${dayId}.md`)}:`
    const session = await graphRequest(`${address}/createUploadSession`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(current ? { 'If-Match': current.eTag } : {}) },
      body: JSON.stringify({ deferCommit: true, item: { name: `${dayId}.md`, '@microsoft.graph.conflictBehavior': current ? 'replace' : 'fail' } }) })
    const { uploadUrl } = await session!.json() as { uploadUrl: string }
    if (!uploadUrl?.startsWith('https://')) throw new Error('OneDrive returned an invalid upload URL.')
    const bytes = new TextEncoder().encode(content)
    const chunkSize = 10 * 320 * 1024
    try {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const end = Math.min(bytes.length, offset + chunkSize)
        const response = await plainFetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${offset}-${end - 1}/${bytes.length}` }, body: bytes.slice(offset, end) })
        if (response.status === 409 || response.status === 412) throw new GraphConflict()
        if (response.status !== 202) throw new Error('OneDrive did not defer the upload commit. Conditional uploads must be verified for this account before syncing.')
      }
      await beforeCommit()
      const commit = await graphRequest(current ? itemAddress(current) : childAtPath(parent, `${dayId}.md`), { method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(current ? { 'If-Match': current.eTag } : { 'If-None-Match': '*' }) },
        body: JSON.stringify({ name: `${dayId}.md`, '@microsoft.graph.conflictBehavior': current ? 'replace' : 'fail', '@microsoft.graph.sourceUrl': uploadUrl }) })
      const uploaded = await commit!.json() as DriveItem
      if (!uploaded.file || !uploaded.eTag || uploaded.name !== `${dayId}.md`) throw new Error('OneDrive returned an invalid daily upload result.')
      itemAddress(uploaded)
      return uploaded
    } finally {
      // Never send Graph credentials to the preauthorized session URL.
      await plainFetch(uploadUrl, { method: 'DELETE' }).catch(() => undefined)
    }
  }
  const deleteItem = async (item: DriveItem, beforeCommit: () => Promise<void>) => {
    await beforeCommit()
    await graphRequest(itemAddress(item), { method: 'DELETE', headers: { 'If-Match': item.eTag } })
  }

  return {
    graphRequest, getItem, resolveTarget, downloadItem, ensureFolder, listChildren,
    inventoryDays, ensureDayParent, uploadDay, deleteItem,
  }
}
export type OneDriveGraph = ReturnType<typeof createOneDriveGraph>
