import { decryptToken, encryptToken, jsonResponse, validateMutationRequest } from '../../_lib/tokenCookie'
import { dropboxAllowedOrigins, type DropboxOAuthEnv } from '../../_lib/dropboxOAuth'
import { googleAllowedOrigins, type GoogleOAuthEnv } from '../../_lib/googleOAuth'
import { roomName, validDay } from '../../_lib/oneDriveNotebook'
import { relayFetch } from '../../_lib/oneDriveRelay'

type Env = DropboxOAuthEnv & GoogleOAuthEnv & { ONEDRIVE_EVENTS?: DurableObjectNamespace }
type Provider = 'dropbox' | 'google-drive'
type EventRequest = {
  provider?: unknown
  folder?: unknown
  item?: unknown
  action?: unknown
  sender?: unknown
  revision?: unknown
}
type DropboxEntry = { id: string; '.tag': string; path_lower?: string; rev?: string; shared_folder_id?: string; sharing_info?: { shared_folder_id?: string } }
type DriveEntry = {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  headRevisionId?: string
  trashed?: boolean
  appProperties?: Record<string, string>
}
const validProvider = (value: unknown): value is Provider => value === 'dropbox' || value === 'google-drive'
const validRef = (value: unknown, provider: Provider): value is string =>
  typeof value === 'string' && value.length <= 512 &&
  (provider === 'dropbox' ? /^id:[a-zA-Z0-9_-]+$/.test(value) : /^[a-zA-Z0-9_-]+$/.test(value))
const validSender = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value)
const origins = (env: Env, provider: Provider) => provider === 'dropbox' ? dropboxAllowedOrigins(env) : googleAllowedOrigins(env)
const secret = (env: Env, provider: Provider) =>
  provider === 'dropbox' ? env.DROPBOX_TOKEN_ENCRYPTION_KEY : env.GOOGLE_TOKEN_ENCRYPTION_KEY
const ticketKey = (env: Env, provider: Provider) => `rivolo-daily-event-v1:${provider}:${secret(env, provider)}`
const verified = async <T>(promise: Promise<Response>) => {
  const response = await promise
  if (!response.ok) throw response
  return await response.json() as T
}
const dropboxMetadata = (ref: string, authorization: string) => verified<DropboxEntry>(fetch(
  'https://api.dropboxapi.com/2/files/get_metadata', {
    method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: ref }),
  },
))
const driveMetadata = (ref: string, authorization: string) => verified<DriveEntry>(fetch(
  `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref)}?fields=id,name,mimeType,parents,headRevisionId,trashed,appProperties`,
  { headers: { Authorization: authorization } },
))
type FileNotice = { dayId: string; item: string; revision: string }
const resolveFolder = async (provider: Provider, ref: string, authorization: string) => {
  if (provider === 'dropbox') {
    const folder = await dropboxMetadata(ref, authorization)
    if (folder['.tag'] !== 'folder' || !folder.path_lower || !validRef(folder.id, provider)) throw new Response(null, { status: 403 })
    const lookup = async (itemRef: string): Promise<FileNotice | null> => {
      const item = await dropboxMetadata(itemRef, authorization)
      const dayId = item.path_lower?.split('/').at(-1)?.replace(/\.md$/, '')
      if (item['.tag'] !== 'file' || !validDay(dayId) || !item.rev || item.path_lower !==
        `${folder.path_lower}/${dayId.slice(0, 4)}/${dayId.slice(5, 7)}/${dayId}.md`) return null
      return { dayId, item: item.id, revision: item.rev }
    }
    const sharedId = folder.sharing_info?.shared_folder_id ?? folder.shared_folder_id
    return { identity: sharedId ? `shared:${sharedId}` : folder.id, lookup }
  }
  const folder = await driveMetadata(ref, authorization)
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' || !folder.appProperties?.rivoloDailySource ||
      !validRef(folder.id, provider)) throw new Response(null, { status: 403 })
  const lookup = async (itemRef: string): Promise<FileNotice | null> => {
    const file = await driveMetadata(itemRef, authorization)
    const dayId = file.appProperties?.rivoloDay
    if (!validDay(dayId) || file.name !== `${dayId}.md` || file.trashed || !file.headRevisionId ||
        !file.parents?.includes(folder.id) || file.appProperties?.rivoloNotebook !== folder.id) return null
    return { dayId, item: file.id, revision: file.headRevisionId }
  }
  return { identity: folder.id, lookup }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json().catch(() => null) as EventRequest | null
  if (!body || !validProvider(body.provider) || !validRef(body.folder, body.provider) ||
      !validSender(body.sender) || !['subscribe', 'publish', 'invalidate'].includes(String(body.action))) {
    return jsonResponse({ message: 'Invalid daily sync event.' }, 400)
  }
  const provider = body.provider
  const invalid = validateMutationRequest(request, origins(env, provider))
  if (invalid) return jsonResponse({ message: invalid }, 403)
  if (!env.ONEDRIVE_EVENTS || !secret(env, provider)) return jsonResponse({ code: 'relay_unavailable' }, 503)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ') || authorization.length > 16_384) return jsonResponse({ message: 'Provider authorization required.' }, 401)
  try {
    const notebook = await resolveFolder(provider, body.folder, authorization)
    const room = await roomName(`daily:${provider}:${notebook.identity}`)
    const channel = env.ONEDRIVE_EVENTS.get(env.ONEDRIVE_EVENTS.idFromName(room))
    if (body.action === 'subscribe') {
      await relayFetch(channel, '/health')
      const ticket = await encryptToken(JSON.stringify({ room, sender: body.sender, expires: Date.now() + 60_000 }), ticketKey(env, provider))
      return jsonResponse({ ticket })
    }
    const publish = (event: object) => relayFetch(channel, '/publish', { method: 'POST', body: JSON.stringify(event) })
    if (body.action === 'invalidate') {
      if (!validSender(body.revision)) return jsonResponse({ message: 'Invalid inventory event.' }, 400)
      return await publish({ type: 'inventory-invalidated', revision: body.revision, sender: body.sender })
    }
    if (!validRef(body.item, provider)) return jsonResponse({ message: 'A notebook day file is required.' }, 400)
    let file
    try { file = await notebook.lookup(body.item) } catch (error) {
      if (!(error instanceof Response) || ![404, 409].includes(error.status)) throw error
      return await publish({ type: 'inventory-invalidated', revision: `missing:${body.item}`, sender: '' })
    }
    if (!file) return jsonResponse({ message: 'This file is outside the daily notebook.' }, 403)
    return await publish({ type: 'day-changed', ...file, sender: body.revision === file.revision ? body.sender : '' })
  } catch (error) {
    const status = error instanceof Response ? error.status : 503
    return jsonResponse({ message: 'Could not verify access to the daily notebook.' }, [401, 403, 404, 409, 429].includes(status) ? status : 503)
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const provider = url.searchParams.get('provider')
  const origin = request.headers.get('Origin')
  if (!validProvider(provider) || !origin || ![url.origin, ...origins(env, provider)].includes(origin)) return new Response(null, { status: 403 })
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 })
  if (!env.ONEDRIVE_EVENTS || !secret(env, provider)) return new Response(null, { status: 503 })
  try {
    const ticket = url.searchParams.get('ticket') ?? ''
    if (ticket.length > 2048) return new Response(null, { status: 401 })
    const payload = JSON.parse(await decryptToken(ticket, ticketKey(env, provider)) ?? '') as { room: string; sender: string; expires: number }
    const now = Date.now()
    if (!/^[a-f0-9]{64}$/.test(payload.room) || !validSender(payload.sender) ||
        !Number.isFinite(payload.expires) || payload.expires < now || payload.expires > now + 60_000) return new Response(null, { status: 401 })
    return await relayFetch(env.ONEDRIVE_EVENTS.get(env.ONEDRIVE_EVENTS.idFromName(payload.room)), '/connect',
      { headers: { Upgrade: 'websocket', 'X-Sender': payload.sender } })
  } catch (error) {
    return error instanceof Response ? error : new Response(null, { status: 401 })
  }
}
