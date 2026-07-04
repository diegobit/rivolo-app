import { getDropboxState, updateDropboxState } from './dropboxState'

const DROPBOX_AUTH = 'https://www.dropbox.com/oauth2/authorize'
const DROPBOX_API = 'https://api.dropboxapi.com/2'
const DROPBOX_SCOPE = 'files.content.read files.content.write files.metadata.read account_info.read'
const DROPBOX_OAUTH_STORAGE = 'dropbox.oauth'
const ACCESS_TOKEN_REFRESH_BUFFER = 60_000

type TokenPayload = {
  accessToken: string
  expiresAt: number
}

type ApiErrorPayload = {
  code?: string
  message?: string
}

type DropboxOAuthSession = {
  codeVerifier: string
  state: string
  createdAt: number
}

type DropboxAccount = {
  account_id: string
  email: string
  name: {
    display_name: string
  }
}

let memoryToken: TokenPayload | null = null

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

const parseApiError = async (response: Response, fallback: string) => {
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null
  const error = new Error(payload?.message || fallback)
  ;(error as Error & { code?: string }).code = payload?.code
  return error
}

const fetchDropboxAccount = async (accessToken: string) => {
  const response = await fetch(`${DROPBOX_API}/users/get_current_account`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error('Connected, but Dropbox account details could not be loaded.')
  }
  return (await response.json()) as DropboxAccount
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

const exchangeAuthorizationCode = async (code: string, codeVerifier: string) => {
  const response = await fetch('/api/dropbox/exchange', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XmlHttpRequest',
    },
    body: JSON.stringify({ code, codeVerifier }),
  })
  if (!response.ok) throw await parseApiError(response, 'Dropbox connect failed.')
  memoryToken = (await response.json()) as TokenPayload
  return memoryToken
}

export const completeDropboxAuth = async (code: string, returnedState: string | null) => {
  const oauthSession = loadOAuthSession()
  if (!oauthSession) {
    throw new Error('Dropbox login expired. Please try again.')
  }
  if (returnedState !== oauthSession.state) {
    throw new Error('Dropbox auth state mismatch.')
  }
  clearOAuthSession()

  const token = await exchangeAuthorizationCode(code, oauthSession.codeVerifier)
  await updateDropboxState({ connected: true })
  try {
    const account = await fetchDropboxAccount(token.accessToken)
    await updateDropboxState({
      accountId: account.account_id,
      accountEmail: account.email,
      accountName: account.name.display_name,
    })
  } catch {
    // Account metadata is optional; the Dropbox grant itself is enough to sync.
  }
}

export const getDropboxAccessToken = async (forceRefresh = false) => {
  if (
    !forceRefresh &&
    memoryToken &&
    Date.now() < memoryToken.expiresAt - ACCESS_TOKEN_REFRESH_BUFFER
  ) {
    return memoryToken.accessToken
  }

  const response = await fetch('/api/dropbox/token', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XmlHttpRequest' },
  })
  if (!response.ok) {
    if (response.status === 401) {
      memoryToken = null
      await updateDropboxState({ connected: false })
    }
    throw await parseApiError(response, 'Dropbox authorization failed.')
  }
  memoryToken = (await response.json()) as TokenPayload
  return memoryToken.accessToken
}

export const authorizedDropboxFetch = async (
  input: string,
  init: RequestInit = {},
  retry = true,
) => {
  const token = await getDropboxAccessToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(input, { ...init, headers })
  if (response.status === 401 && retry) {
    const refreshedToken = await getDropboxAccessToken(true)
    headers.set('Authorization', `Bearer ${refreshedToken}`)
    return fetch(input, { ...init, headers })
  }
  return response
}

export const disconnectDropboxAuth = async () => {
  try {
    await fetch('/api/dropbox/disconnect', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XmlHttpRequest' },
    }).catch(() => undefined)
  } finally {
    memoryToken = null
  }
}

export const isDropboxConnected = async () => {
  const state = await getDropboxState()
  return state.connected
}
