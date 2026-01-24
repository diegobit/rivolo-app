import { exportMarkdownFromDb, importMarkdownToDb } from './importExport'
import { getDropboxState, updateDropboxState } from './dropboxState'
import type { DropboxState } from './dropboxState'
import type { SyncProvider, SyncStatus } from './sync'

const DROPBOX_API = 'https://api.dropboxapi.com/2'
const DROPBOX_CONTENT = 'https://content.dropboxapi.com/2'
const DROPBOX_AUTH = 'https://www.dropbox.com/oauth2/authorize'
const DROPBOX_TOKEN = 'https://api.dropboxapi.com/oauth2/token'
const DROPBOX_SCOPE = 'files.content.read files.content.write files.metadata.read account_info.read'
const DROPBOX_OAUTH_STORAGE = 'dropbox.oauth'
const ACCESS_TOKEN_REFRESH_BUFFER = 60_000

export const DEFAULT_DROPBOX_PATH = '/Apps/Rivolo/inbox.md'

type DropboxMetadata = {
  rev: string
  server_modified: string
}

type DropboxAuth = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

type DropboxTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope: string
  account_id: string
}

type DropboxAccount = {
  account_id: string
  email: string
  name: {
    display_name: string
  }
}

type DropboxOAuthSession = {
  codeVerifier: string
  state: string
  createdAt: number
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

const encoder = new TextEncoder()

const toBase64Url = (value: ArrayBuffer | Uint8Array) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const createRandomToken = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : toBase64Url(crypto.getRandomValues(new Uint8Array(16)))

const createCodeVerifier = () => toBase64Url(crypto.getRandomValues(new Uint8Array(64)))

const createCodeChallenge = async (verifier: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
  return toBase64Url(digest)
}

const getDropboxClientId = () => {
  const clientId = import.meta.env.VITE_DROPBOX_CLIENT_ID as string | undefined
  if (!clientId) {
    throw new Error('Missing VITE_DROPBOX_CLIENT_ID.')
  }
  return clientId
}

const getDropboxRedirectUri = () => `${window.location.origin}/auth/dropbox/callback`

const saveOAuthSession = (payload: DropboxOAuthSession) => {
  sessionStorage.setItem(DROPBOX_OAUTH_STORAGE, JSON.stringify(payload))
}

const loadOAuthSession = () => {
  const stored = sessionStorage.getItem(DROPBOX_OAUTH_STORAGE)
  if (!stored) return null
  try {
    return JSON.parse(stored) as DropboxOAuthSession
  } catch {
    return null
  }
}

const clearOAuthSession = () => {
  sessionStorage.removeItem(DROPBOX_OAUTH_STORAGE)
}

const resolveDropboxPath = async (state: DropboxState) => {
  if (state.filePath?.trim()) {
    return state.filePath
  }
  const next = await updateDropboxState({ filePath: DEFAULT_DROPBOX_PATH })
  return next.filePath ?? DEFAULT_DROPBOX_PATH
}

const storeDropboxAuth = async (auth: DropboxAuth, account?: DropboxAccount) => {
  const current = await getDropboxState()
  const filePath = current.filePath ?? DEFAULT_DROPBOX_PATH
  const updates: Partial<DropboxState> = {
    auth,
    filePath,
  }

  if (account) {
    updates.accountId = account.account_id
    updates.accountEmail = account.email
    updates.accountName = account.name.display_name
  }

  return updateDropboxState(updates)
}

const getDropboxAuth = async () => {
  const state = await getDropboxState()
  if (!state.auth) {
    throw new Error('Dropbox not connected.')
  }
  return state.auth
}

const fetchDropboxToken = async (params: URLSearchParams) => {
  const response = await fetch(DROPBOX_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })

  if (!response.ok) {
    throw new Error('Failed to fetch Dropbox token.')
  }

  return (await response.json()) as DropboxTokenResponse
}

const exchangeDropboxCode = async (code: string, codeVerifier: string) => {
  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: getDropboxClientId(),
    code_verifier: codeVerifier,
    redirect_uri: getDropboxRedirectUri(),
  })
  return fetchDropboxToken(params)
}

const refreshDropboxToken = async (refreshToken: string) => {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: getDropboxClientId(),
  })
  return fetchDropboxToken(params)
}

const fetchDropboxAccount = async (accessToken: string) => {
  const response = await fetch(`${DROPBOX_API}/users/get_current_account`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as DropboxError | null
    const detail = payload?.error_summary ? ` (${payload.error_summary})` : ''
    throw new Error(`Failed to fetch Dropbox account.${detail}`)
  }

  return (await response.json()) as DropboxAccount
}

const refreshDropboxAuth = async (auth: DropboxAuth) => {
  const token = await refreshDropboxToken(auth.refreshToken)
  const nextAuth: DropboxAuth = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
  }
  await storeDropboxAuth(nextAuth)
  return nextAuth
}

const getValidDropboxAuth = async () => {
  const auth = await getDropboxAuth()
  if (Date.now() < auth.expiresAt - ACCESS_TOKEN_REFRESH_BUFFER) {
    return auth
  }
  return refreshDropboxAuth(auth)
}

const withAuthHeaders = (headers: HeadersInit | undefined, token: string) => {
  const nextHeaders = new Headers(headers)
  nextHeaders.set('Authorization', `Bearer ${token}`)
  return nextHeaders
}

const authorizedFetch = async (url: string, init: RequestInit, retry = true) => {
  const auth = await getValidDropboxAuth()
  const response = await fetch(url, {
    ...init,
    headers: withAuthHeaders(init.headers, auth.accessToken),
  })

  if (response.status === 401 && retry) {
    const refreshed = await refreshDropboxAuth(auth)
    return fetch(url, {
      ...init,
      headers: withAuthHeaders(init.headers, refreshed.accessToken),
    })
  }

  return response
}

const fetchMetadata = async (path: string) => {
  const response = await authorizedFetch(`${DROPBOX_API}/files/get_metadata`, {
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
  const response = await authorizedFetch(`${DROPBOX_CONTENT}/files/download`, {
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

const uploadFile = async (
  path: string,
  content: string,
  mode: DropboxUploadMode,
) => {
  const response = await authorizedFetch(`${DROPBOX_CONTENT}/files/upload`, {
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

export const startDropboxAuth = async () => {
  const codeVerifier = createCodeVerifier()
  const codeChallenge = await createCodeChallenge(codeVerifier)
  const state = createRandomToken()
  saveOAuthSession({ codeVerifier, state, createdAt: Date.now() })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getDropboxClientId(),
    redirect_uri: getDropboxRedirectUri(),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    scope: DROPBOX_SCOPE,
    state,
  })

  window.location.assign(`${DROPBOX_AUTH}?${params.toString()}`)
}

export const completeDropboxAuth = async (
  code: string,
  returnedState: string | null,
) => {
  const oauthSession = loadOAuthSession()
  if (!oauthSession) {
    throw new Error('Dropbox login expired. Please try again.')
  }
  if (returnedState !== oauthSession.state) {
    throw new Error('Dropbox auth state mismatch.')
  }
  clearOAuthSession()

  const token = await exchangeDropboxCode(code, oauthSession.codeVerifier)
  if (!token.refresh_token) {
    throw new Error('Dropbox did not return a refresh token.')
  }

  const auth: DropboxAuth = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  }
  const account = await fetchDropboxAccount(auth.accessToken)
  await storeDropboxAuth(auth, account)
}

export const disconnectDropbox = async () => {
  await updateDropboxState({
    auth: null,
    accountId: null,
    accountEmail: null,
    accountName: null,
    lastRemoteRev: null,
    lastSyncAt: null,
  })
}

export const getDropboxStatus = async (): Promise<SyncStatus> => {
  const state = await getDropboxState()
  return {
    connected: Boolean(state.auth),
    filePath: state.filePath,
    lastRemoteVersion: state.lastRemoteRev,
    lastSyncAt: state.lastSyncAt,
    localDirty: state.localDirty,
    accountName: state.accountName,
    accountEmail: state.accountEmail,
  }
}

export const pullFromDropbox = async () => {
  const state = await getDropboxState()
  const path = await resolveDropboxPath(state)

  const metadata = await fetchMetadata(path)
  if (!metadata) {
    throw new Error('Dropbox file not found. Push to create it first.')
  }

  if (metadata.rev === state.lastRemoteRev) {
    console.info('[Dropbox] pull:noop', { filePath: path, rev: metadata.rev })
    return { status: 'noop' as const, metadata }
  }

  const content = await downloadFile(path)
  const result = await importMarkdownToDb(content, { replace: true })
  const hasNoMarkersWarning =
    result.imported === 0 &&
    result.warnings.some((warning) => warning.toLowerCase().includes('no day markers'))

  if (hasNoMarkersWarning) {
    throw new Error('Dropbox file has no day markers. Import aborted to avoid data loss.')
  }

  await updateDropboxState({
    lastRemoteRev: metadata.rev,
    lastSyncAt: Date.now(),
    localDirty: false,
  })

  console.info('[Dropbox] pull:ok', { filePath: path, rev: metadata.rev })
  return { status: 'pulled' as const, metadata, result }
}

export const pushToDropbox = async (force = false) => {
  const state = await getDropboxState()
  const path = await resolveDropboxPath(state)

  if (!state.localDirty && !force) {
    console.info('[Dropbox] push:clean', { filePath: path })
    return { status: 'clean' as const }
  }

  const metadata = await fetchMetadata(path)

  if (!force && state.lastRemoteRev && (!metadata || metadata.rev !== state.lastRemoteRev)) {
    console.warn('[Dropbox] push:blocked', {
      filePath: path,
      localRev: state.lastRemoteRev,
      remoteRev: metadata?.rev ?? 'missing',
    })
    return { status: 'blocked' as const, metadata }
  }

  const content = await exportMarkdownFromDb()
  const upload = await uploadFile(path, content, resolveUploadMode(state.lastRemoteRev, force))

  await updateDropboxState({
    lastRemoteRev: upload.rev,
    lastSyncAt: Date.now(),
    localDirty: false,
  })

  console.info('[Dropbox] push:ok', { filePath: path, rev: upload.rev })
  return { status: 'pushed' as const, metadata: upload }
}

export const dropboxProvider = {
  id: 'dropbox',
  getStatus: getDropboxStatus,
  pull: pullFromDropbox,
  push: pushToDropbox,
  disconnect: disconnectDropbox,
} satisfies SyncProvider
