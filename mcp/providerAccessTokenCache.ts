// Per-isolate cache of provider access tokens. It only replaces the provider
// refresh round trip: callers must authenticate the MCP request first.

export type ProviderAccessTokenGrant = {
  accessToken: string
  expiresInSeconds: number
}

export type ProviderAccessToken = {
  accessToken: string
  // True when the token came from an earlier refresh, so a provider 401 may
  // mean it was revoked or expired early.
  cached: boolean
}

type Entry = { accessToken: string; expiresAt: number }

const EXPIRY_MARGIN_MS = 2 * 60 * 1000

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

// A rotated or replaced refresh token produces a new key, so it never reuses
// an access token minted from the previous credential.
export const providerAccessTokenKey = async (
  profileId: string,
  refreshToken: string,
) => `${profileId}:${await sha256Hex(refreshToken)}`

// Only finished refreshes are shared. In Workers, a request waiting on a
// refresh started by another request can hang if that request is cancelled
// (for example, its client disconnects), so each cache miss refreshes on its
// own. Concurrent misses cost an extra refresh, never a stuck request.
export const createProviderAccessTokenCache = ({
  maxEntries = 500,
  now = () => Date.now(),
}: { maxEntries?: number; now?: () => number } = {}) => {
  const entries = new Map<string, Entry>()

  return {
    async get(
      key: string,
      load: () => Promise<ProviderAccessTokenGrant>,
    ): Promise<ProviderAccessToken> {
      const entry = entries.get(key)
      if (entry && entry.expiresAt > now()) {
        return { accessToken: entry.accessToken, cached: true }
      }
      if (entry) entries.delete(key)

      const grant = await load()
      const token = {
        accessToken: grant.accessToken,
        expiresAt: now() + grant.expiresInSeconds * 1000 - EXPIRY_MARGIN_MS,
      }
      if (token.expiresAt > now()) {
        entries.delete(key)
        entries.set(key, token)
        while (entries.size > maxEntries) {
          const oldest = entries.keys().next().value
          if (oldest === undefined) break
          entries.delete(oldest)
        }
      }
      return { accessToken: token.accessToken, cached: false }
    },

    // Drop a token the provider rejected, unless a newer one replaced it.
    reject(key: string, accessToken: string) {
      if (entries.get(key)?.accessToken === accessToken) entries.delete(key)
    },
  }
}
