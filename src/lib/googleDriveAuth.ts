import {
  getGoogleDriveState,
  markGoogleDriveLocalDirty,
  updateGoogleDriveState,
} from './googleDriveState'

const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client'
const ACCESS_TOKEN_REFRESH_BUFFER = 60_000

type GoogleCodeResponse = {
  code?: string
  error?: string
  error_description?: string
}

type GoogleCodeClient = {
  requestCode: () => void
}

type GoogleIdentityApi = {
  accounts: {
    oauth2: {
      initCodeClient: (config: {
        client_id: string
        scope: string
        ux_mode: 'popup'
        prompt: string
        callback: (response: GoogleCodeResponse) => void
        error_callback: (error: { type?: string }) => void
      }) => GoogleCodeClient
    }
  }
}

type TokenPayload = {
  accessToken: string
  expiresAt: number
}

type ApiErrorPayload = {
  code?: string
  message?: string
}

type GoogleDriveUser = {
  permissionId?: string
  displayName?: string
  emailAddress?: string
}

declare global {
  interface Window {
    google?: GoogleIdentityApi
  }
}

let preparePromise: Promise<void> | null = null
let googleClientId: string | null = null
let memoryToken: TokenPayload | null = null

const parseApiError = async (response: Response, fallback: string) => {
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null
  const error = new Error(payload?.message || fallback)
  ;(error as Error & { code?: string }).code = payload?.code
  return error
}

const loadGoogleIdentityScript = async () => {
  if (window.google?.accounts.oauth2) return
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Google sign-in could not load.')), {
        once: true,
      })
      return
    }
    const script = document.createElement('script')
    script.src = GOOGLE_IDENTITY_SCRIPT
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google sign-in could not load.'))
    document.head.append(script)
  })
  if (!window.google?.accounts.oauth2) throw new Error('Google sign-in is unavailable.')
}

const loadGoogleClientId = async () => {
  const response = await fetch('/api/google-drive/config', { cache: 'no-store' })
  if (!response.ok) throw await parseApiError(response, 'Google Drive sync is not configured.')
  const payload = (await response.json()) as { clientId?: string }
  if (!payload.clientId) throw new Error('Google Drive sync is not configured.')
  googleClientId = payload.clientId
}

export const prepareGoogleDriveAuth = () => {
  preparePromise ??= Promise.all([loadGoogleIdentityScript(), loadGoogleClientId()])
    .then(() => undefined)
    .catch((error) => {
      preparePromise = null
      throw error
    })
  return preparePromise
}

const exchangeAuthorizationCode = async (code: string) => {
  const response = await fetch('/api/google-drive/exchange', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XmlHttpRequest',
    },
    body: JSON.stringify({ code }),
  })
  if (!response.ok) throw await parseApiError(response, 'Google Drive connect failed.')
  memoryToken = (await response.json()) as TokenPayload
  return memoryToken
}

const fetchGoogleDriveUser = async (accessToken: string) => {
  const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error('Connected, but Google account details could not be loaded.')
  const payload = (await response.json()) as { user?: GoogleDriveUser }
  return payload.user ?? {}
}

export const startGoogleDriveAuth = () => {
  if (!googleClientId || !window.google?.accounts.oauth2) {
    throw new Error('Google sign-in is still loading. Try again.')
  }

  return new Promise<void>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initCodeClient({
      client_id: googleClientId!,
      scope: 'https://www.googleapis.com/auth/drive.file',
      ux_mode: 'popup',
      prompt: 'consent',
      callback: (response) => {
        if (!response.code) {
          reject(new Error(response.error_description || response.error || 'Google authorization was cancelled.'))
          return
        }
        void exchangeAuthorizationCode(response.code)
          .then(async (token) => {
            const current = await getGoogleDriveState()
            await updateGoogleDriveState({ connected: true })
            try {
              const user = await fetchGoogleDriveUser(token.accessToken)
              await updateGoogleDriveState({
                accountId: user.permissionId ?? null,
                accountEmail: user.emailAddress ?? null,
                accountName: user.displayName ?? null,
              })
            } catch {
              // Account metadata is optional; the Drive grant itself is enough to sync.
            }
            if (!current.lastRemoteVersion) {
              await markGoogleDriveLocalDirty()
            }
          })
          .then(resolve, reject)
      },
      error_callback: (error) => {
        reject(
          new Error(
            error.type === 'popup_closed'
              ? 'Google authorization was cancelled.'
              : 'Google authorization popup could not open.',
          ),
        )
      },
    })
    client.requestCode()
  })
}

export const getGoogleDriveAccessToken = async (forceRefresh = false) => {
  if (
    !forceRefresh &&
    memoryToken &&
    Date.now() < memoryToken.expiresAt - ACCESS_TOKEN_REFRESH_BUFFER
  ) {
    return memoryToken.accessToken
  }

  const response = await fetch('/api/google-drive/token', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XmlHttpRequest' },
  })
  if (!response.ok) {
    if (response.status === 401) {
      memoryToken = null
      await updateGoogleDriveState({ connected: false })
    }
    throw await parseApiError(response, 'Google Drive authorization failed.')
  }
  memoryToken = (await response.json()) as TokenPayload
  return memoryToken.accessToken
}

export const authorizedGoogleDriveFetch = async (
  input: string,
  init: RequestInit = {},
  retry = true,
) => {
  const token = await getGoogleDriveAccessToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(input, { ...init, headers })
  if (response.status === 401 && retry) {
    const refreshedToken = await getGoogleDriveAccessToken(true)
    headers.set('Authorization', `Bearer ${refreshedToken}`)
    return fetch(input, { ...init, headers })
  }
  return response
}

export const disconnectGoogleDriveAuth = async () => {
  try {
    await fetch('/api/google-drive/disconnect', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XmlHttpRequest' },
    }).catch(() => undefined)
  } finally {
    memoryToken = null
  }
}
