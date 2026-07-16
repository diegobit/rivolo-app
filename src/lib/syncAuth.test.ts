import { describe, expect, it, vi } from 'vitest'
import { createAuthorizedFetch, parseApiError } from './syncAuth'

describe('parseApiError', () => {
  it('uses the JSON message and carries the optional code on the error', async () => {
    const response = new Response(JSON.stringify({ message: 'Token expired.', code: 'auth/expired' }))
    const error = await parseApiError(response, 'Fallback text.')
    expect(error.message).toBe('Token expired.')
    expect((error as Error & { code?: string }).code).toBe('auth/expired')
  })

  it('omits the code when the payload has none', async () => {
    const response = new Response(JSON.stringify({ message: 'Nope.' }))
    const error = await parseApiError(response, 'Fallback text.')
    expect(error.message).toBe('Nope.')
    expect((error as Error & { code?: string }).code).toBeUndefined()
  })

  it('falls back to the caller text for a non-JSON body', async () => {
    const response = new Response('<html>gateway error</html>')
    const error = await parseApiError(response, 'Dropbox connect failed.')
    expect(error.message).toBe('Dropbox connect failed.')
    expect((error as Error & { code?: string }).code).toBeUndefined()
  })

  it('falls back to the caller text when the JSON has no message', async () => {
    const response = new Response(JSON.stringify({ code: 'auth/unknown' }))
    const error = await parseApiError(response, 'Google Drive connect failed.')
    expect(error.message).toBe('Google Drive connect failed.')
    expect((error as Error & { code?: string }).code).toBe('auth/unknown')
  })
})

describe('createAuthorizedFetch', () => {
  it('attaches the bearer token to every request', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('token-1')
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    const authorizedFetch = createAuthorizedFetch(getAccessToken)
    await authorizedFetch('https://example.com/data', { method: 'POST' })

    expect(getAccessToken).toHaveBeenCalledWith()
    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer token-1')
    vi.unstubAllGlobals()
  })

  it('retries exactly once with a refreshed token after a 401', async () => {
    const getAccessToken = vi.fn().mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    const authorizedFetch = createAuthorizedFetch(getAccessToken)
    const response = await authorizedFetch('https://example.com/data')

    expect(response.status).toBe(200)
    expect(getAccessToken).toHaveBeenCalledTimes(2)
    expect(getAccessToken).toHaveBeenNthCalledWith(2, true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[1][1].headers as Headers).get('Authorization')).toBe('Bearer fresh')
    vi.unstubAllGlobals()
  })

  it('does not retry a second time when retry is disabled', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('token')
    const fetchMock = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    const authorizedFetch = createAuthorizedFetch(getAccessToken)
    const response = await authorizedFetch('https://example.com/data', {}, false)

    expect(response.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getAccessToken).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})

describe('both providers use the shared authorized-fetch factory', () => {
  it('Dropbox and Google Drive authorizedFetch both attach the 401-retry behavior from createAuthorizedFetch', async () => {
    vi.resetModules()
    vi.doMock('./dropboxState', () => ({
      getDropboxState: vi.fn(),
      updateDropboxState: vi.fn(),
    }))
    vi.doMock('./googleDriveState', () => ({
      getGoogleDriveState: vi.fn(),
      markGoogleDriveLocalDirty: vi.fn(),
      updateGoogleDriveState: vi.fn(),
    }))

    const syncAuth = await import('./syncAuth')
    const createSpy = vi.spyOn(syncAuth, 'createAuthorizedFetch')

    await import('./dropboxAuth')
    await import('./googleDriveAuth')

    expect(createSpy).toHaveBeenCalledTimes(2)
    vi.doUnmock('./dropboxState')
    vi.doUnmock('./googleDriveState')
  })
})
