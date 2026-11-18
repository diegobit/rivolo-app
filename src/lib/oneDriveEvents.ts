import { authorizedDropboxFetch } from './dropboxAuth'
import { authorizedGoogleDriveFetch } from './googleDriveAuth'
import { SYNC_PROVIDER_LABELS } from './syncState'
import { authorizedOneDriveFetch } from './oneDriveAuth'
import { assertTarget, acknowledgeDailyEvent, persistDailyCheckpoint, readDailyOutbox, type DailyEvent, type NotebookTarget } from './oneDriveDailyState'
import { validItemAddress } from './oneDriveGraph'

const API = '/api/onedrive/events'
const OUTBOX_KEY = 'rivolo.onedrive.events.outbox'
const sender = crypto.randomUUID()
const outbox = new Map<string, string>()
let retryTimer: ReturnType<typeof setTimeout> | undefined
let publishing = false
let publishFailures = 0

export const oneDriveEventItem = (revision: string | null | undefined) =>
  revision?.match(/^(\/drives\/[^/]+\/items\/[^:]+):/)?.[1] ?? null

const eventRequest = async (item: string, action: 'subscribe' | 'publish', signal?: AbortSignal, revision?: string) => {
  const response = await authorizedOneDriveFetch(API, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XmlHttpRequest' },
    body: JSON.stringify({ item, action, sender, revision }),
  })
  if (!response.ok) {
    const error = new Error(response.status === 503
      ? 'OneDrive live updates are unavailable. Check the event service configuration or retry later.'
      : 'OneDrive live updates could not connect. Reconnect OneDrive or retry later.')
    const retry = Number(response.headers.get('Retry-After'))
    Object.assign(error, { retryMs: Number.isFinite(retry) && retry > 0 ? retry * 1000 : 0 })
    throw error
  }
  return response
}

const persistOutbox = () => {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify([...outbox])) } catch { /* Retry in memory if storage is unavailable. */ }
}

const flushOutbox = async () => {
  if (publishing || !navigator.onLine) return
  publishing = true
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = undefined
  try {
    for (const [item, version] of outbox) {
      await eventRequest(item, 'publish', undefined, version)
      if (outbox.get(item) === version) outbox.delete(item)
      persistOutbox()
    }
    publishFailures = 0
  } catch (error) {
    const retryMs = (error as { retryMs?: number }).retryMs ?? 0
    retryTimer = setTimeout(() => { retryTimer = undefined; void flushOutbox() }, Math.max(retryMs, Math.min(60_000, 1000 * 2 ** Math.min(++publishFailures, 6))))
  } finally {
    publishing = false
    if (outbox.size && !retryTimer) retryTimer = setTimeout(() => { retryTimer = undefined; void flushOutbox() }, 1000)
  }
}

// Persist notification intent before sending: a failed relay request must not
// turn an already completed OneDrive upload into a failed/duplicate upload.
export const publishOneDriveChange = (item: string, revision: string) => {
  outbox.set(item, revision)
  persistOutbox()
  void flushOutbox()
}

type DailyConnection = { target: NotebookTarget; onReady?: () => void; guard?: (target: NotebookTarget) => Promise<void> }

export const startOneDriveEvents = (item: string, onChanged: (event?: DailyEvent) => void, onError: (message: string) => void, daily?: DailyConnection) => {
  const provider = daily?.target.provider ?? 'onedrive'
  const label = SYNC_PROVIDER_LABELS[provider]
  const guard = daily?.guard ?? assertTarget
  let disposed = false
  let generation = 0
  let socket: WebSocket | null = null
  let abort: AbortController | null = null
  let reconnect: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let lastMessageAt = 0
  let failures = 0
  let lastRevision: string | null = null
  const dailyRevisions = new Map<string, string>()
  const active = () => !disposed && navigator.onLine && document.visibilityState === 'visible'
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]')
    if (Array.isArray(stored)) for (const entry of stored) {
      if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && typeof entry[1] === 'string' &&
          oneDriveEventItem(entry[1]) === entry[0]) outbox.set(entry[0], entry[1])
    }
  } catch { /* A malformed outbox cannot prevent subscribing. */ }

  const stopConnection = () => {
    generation++
    abort?.abort()
    abort = null
    if (reconnect) clearTimeout(reconnect)
    if (heartbeat) clearInterval(heartbeat)
    const previous = socket
    socket = null
    previous?.close()
  }

  const connect = async () => {
    stopConnection()
    if (!active()) return
    const current = generation
    const scheduleReconnect = (delay?: number, report = true) => {
      if (current !== generation || !active()) return
      if (heartbeat) clearInterval(heartbeat)
      if (report) onError(`${label} live updates disconnected. Reconnecting automatically.`)
      reconnect = setTimeout(() => { void connect() }, Math.max(delay ?? 0, Math.min(60_000, 1000 * 2 ** Math.min(failures++, 6))))
    }
    if (daily) void flushDailyEvents(daily.target, guard)
    else void flushOutbox()
    abort = new AbortController()
    try {
      if (daily) await guard(daily.target)
      const response = daily ? await dailyEventRequest(daily.target, guard, undefined, abort.signal) : await eventRequest(item, 'subscribe', abort.signal)
      const { ticket } = await response.json() as { ticket: string }
      if (current !== generation || !active()) return
      if (!ticket) throw new Error(`${label} event service returned an invalid ticket.`)
      const url = new URL(daily ? dailyApi(provider) : API, window.location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('ticket', ticket)
      if (provider !== 'onedrive') url.searchParams.set('provider', provider)
      const connected = new WebSocket(url)
      socket = connected
      lastMessageAt = Date.now()
      connected.onmessage = (message) => {
        if (current !== generation) return
        lastMessageAt = Date.now()
        if (message.data === 'pong') return
        try {
          const event = JSON.parse(message.data) as { type: string; revision?: string; sender?: string; item?: string; dayId?: string }
          if (event.type === 'ready') {
            failures = 0
            daily?.onReady?.()
            // Catch up after connecting, including writes between ticket issuance
            // and socket acceptance. No idle notebook polling is needed.
            onChanged()
          } else if (daily && event.sender !== sender && typeof event.revision === 'string') {
            if (event.type === 'inventory-invalidated') {
              onChanged()
            } else if (event.type === 'day-changed' && typeof event.item === 'string' && validEventItem(event.item, provider) && typeof event.dayId === 'string' &&
                /^\d{4}-\d{2}-\d{2}$/.test(event.dayId) && dailyRevisions.get(event.item) !== event.revision) {
              dailyRevisions.set(event.item, event.revision)
              onChanged({ type: 'day-changed', dayId: event.dayId, item: event.item, revision: event.revision })
            }
          } else if (!daily && event.type === 'changed' && event.sender !== sender && typeof event.revision === 'string' &&
              oneDriveEventItem(event.revision) === item && event.revision !== lastRevision) {
            lastRevision = event.revision
            onChanged()
          }
        } catch { /* Ignore malformed channel messages. */ }
      }
      connected.onclose = (event) => scheduleReconnect(undefined, event?.code !== 4001)
      connected.onerror = () => connected.close()
      heartbeat = setInterval(() => {
        if (Date.now() - lastMessageAt > 60_000) { connected.close(); return }
        if (connected.readyState === WebSocket.OPEN) connected.send('ping')
      }, 25_000)
    } catch (error) {
      if (current !== generation || !active()) return
      // Optional cloud relay. Foreground and interval sync keep working, and
      // another visibility change can reconnect after configuration is fixed.
      const problem = error as { retryMs?: number; status?: number }
      if (provider !== 'onedrive' && [404, 503].includes(problem.status ?? 0)) { onError(''); return }
      scheduleReconnect(problem.retryMs)
      onError(error instanceof Error ? error.message : `${label} live updates could not connect.`)
    }
  }

  const resume = () => { if (active()) void connect(); else stopConnection() }
  window.addEventListener('online', resume)
  window.addEventListener('offline', resume)
  window.addEventListener('pageshow', resume)
  window.addEventListener('pagehide', stopConnection)
  document.addEventListener('visibilitychange', resume)
  void connect()
  return () => {
    disposed = true
    stopConnection()
    window.removeEventListener('online', resume)
    window.removeEventListener('offline', resume)
    window.removeEventListener('pageshow', resume)
    window.removeEventListener('pagehide', stopConnection)
    document.removeEventListener('visibilitychange', resume)
  }
}

const dailyApi = (provider: NotebookTarget['provider']) =>
  provider === 'onedrive' ? '/api/onedrive/daily-events' : '/api/sync/daily-events'
const validEventItem = (item: string, provider: NotebookTarget['provider']) => provider === 'onedrive'
  ? validItemAddress(item) : item.length <= 512 && (provider === 'dropbox' ? /^id:[a-zA-Z0-9_-]+$/.test(item) : /^[a-zA-Z0-9_-]+$/.test(item))
const dailyEventRequest = async (target: NotebookTarget, guard: (target: NotebookTarget) => Promise<void>, event?: DailyEvent, signal?: AbortSignal) => {
  await guard(target)
  const provider = target.provider ?? 'onedrive'
  const fetchEvent = provider === 'onedrive' ? authorizedOneDriveFetch
    : provider === 'dropbox' ? authorizedDropboxFetch : authorizedGoogleDriveFetch
  const response = await fetchEvent(dailyApi(provider), { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XmlHttpRequest' },
    body: JSON.stringify({ ...(provider !== 'onedrive' ? { provider } : {}), folder: target.folder, action: !event ? 'subscribe' : event.type === 'day-changed' ? 'publish' : 'invalidate',
      sender, ...(event?.type === 'day-changed' ? { item: event.item } : {}), revision: event?.revision }) })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw Object.assign(new Error(body?.message ?? `${SYNC_PROVIDER_LABELS[provider]} live updates are unavailable. Reconnecting automatically.`),
      { retryMs: Math.max(0, Number(response.headers.get('Retry-After')) || 0) * 1000, status: response.status })
  }
  return response
}
let dailyPublishing = false
let dailyRetry: ReturnType<typeof setTimeout> | undefined
let dailyFailures = 0
export const flushDailyEvents = async (target: NotebookTarget, guard: (target: NotebookTarget) => Promise<void>) => {
  if (dailyPublishing || !navigator.onLine) return
  dailyPublishing = true
  clearTimeout(dailyRetry)
  dailyRetry = undefined
  try {
    await guard(target)
    const rows = await readDailyOutbox(target)
    // Nothing queued: skip the two whole-database saves below.
    if (!rows.length) { dailyFailures = 0; return }
    // Upload result and notification intent are in the same persisted database
    // checkpoint. A restart retries metadata publication without re-uploading.
    await persistDailyCheckpoint()
    for (const row of rows) {
      try { await dailyEventRequest(target, guard, row.entry.event) }
      catch (error) {
        // The relay refused this notification for good (invalid, or the file
        // left the notebook). It is only a hint to refresh, so drop it rather
        // than hold back every notification queued after it.
        const status = (error as { status?: number }).status ?? 0
        if (target.provider && target.provider !== 'onedrive' && [404, 503].includes(status)) return
        if (![400, 403].includes(status)) throw error
        console.warn('[Sync] events:dropped', { item: row.item })
      }
      await acknowledgeDailyEvent(row.entry.context, row.item, row.value)
    }
    await persistDailyCheckpoint()
    dailyFailures = 0
  } catch (error) {
    try {
      await guard(target)
      dailyRetry = setTimeout(() => { void flushDailyOneDriveEvents(target) }, Math.max((error as { retryMs?: number }).retryMs ?? 0, Math.min(60_000, 1000 * 2 ** Math.min(++dailyFailures, 6))))
    } catch { /* A different account/target must never publish this outbox. */ }
  } finally { dailyPublishing = false }
}
export const startDailyOneDriveEvents = (target: NotebookTarget, onChanged: (event?: DailyEvent) => void, onError: (message: string) => void, onReady?: () => void) =>
  startOneDriveEvents(target.folder, onChanged, onError, { target, onReady })

export const flushDailyOneDriveEvents = (target: NotebookTarget) => flushDailyEvents(target, assertTarget)
export const startCloudDailyEvents = (target: NotebookTarget, guard: (target: NotebookTarget) => Promise<void>,
  onChanged: (event?: DailyEvent) => void, onError: (message: string) => void, onReady: () => void) =>
  startOneDriveEvents(target.folder, onChanged, onError, { target, guard, onReady })
