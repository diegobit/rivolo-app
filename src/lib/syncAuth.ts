type ApiErrorPayload = {
  code?: string
  message?: string
}

// Shared by dropboxAuth.ts and googleDriveAuth.ts: both providers' backend
// endpoints report failures as JSON { message, code? }. Falls back to the
// caller's text when the body is missing, malformed, or not JSON.
export const parseApiError = async (response: Response, fallback: string) => {
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null
  const error = new Error(payload?.message || fallback)
  ;(error as Error & { code?: string }).code = payload?.code
  return error
}

// Shared by dropboxAuth.ts and googleDriveAuth.ts: both wrap every API call
// with a bearer token and retry exactly once on a 401 after a forced token
// refresh. Only the token getter differs between providers.
export const createAuthorizedFetch = (getAccessToken: (forceRefresh?: boolean) => Promise<string>) => {
  return async (input: string, init: RequestInit = {}, retry = true): Promise<Response> => {
    const token = await getAccessToken()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(input, { ...init, headers })
    if (response.status === 401 && retry) {
      const refreshedToken = await getAccessToken(true)
      headers.set('Authorization', `Bearer ${refreshedToken}`)
      return fetch(input, { ...init, headers })
    }
    return response
  }
}
