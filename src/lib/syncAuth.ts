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
