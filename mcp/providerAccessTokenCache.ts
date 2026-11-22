// Per-isolate cache of provider access tokens. It only replaces the provider
// refresh round trip: callers must authenticate the MCP request first.

export type ProviderAccessTokenGrant = {
  accessToken: string
  expiresInSeconds: number
}

export type ProviderAccessToken = {
  accessToken: string
  // True when the token came from an earlier, already settled refresh, so a
  // provider 401 may mean it was revoked or expired early.
  cached: boolean
}

type Entry = {
  promise: Promise<{ accessToken: string; expiresAt: number }>
  settled?: { accessToken: string; expiresAt: number }
}

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

export const createProviderAccessTokenCache = ({
  maxEntries = 500,
  now = () => Date.now(),
}: { maxEntries?: number; now?: () => number } = {}) => {
  const entries = new Map<string, Entry>()

  const forget = (key: string, entry: Entry) => {
    if (entries.get(key) === entry) entries.delete(key)
  }

  const refresh = (
    key: string,
    load: () => Promise<ProviderAccessTokenGrant>,
  ) => {
    const entry: Entry = {
      promise: load().then((grant) => ({
        accessToken: grant.accessToken,
        expiresAt: now() + grant.expiresInSeconds * 1000 - EXPIRY_MARGIN_MS,
      })),
    }
    entry.promise.then(
      (token) => {
        entry.settled = token
        if (token.expiresAt <= now()) forget(key, entry)
      },
      () => forget(key, entry),
    )
    entries.delete(key)
    entries.set(key, entry)
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
    return entry.promise
  }

  return {
    async get(
      key: string,
      load: () => Promise<ProviderAccessTokenGrant>,
    ): Promise<ProviderAccessToken> {
      const entry = entries.get(key)
      if (entry?.settled) {
        if (entry.settled.expiresAt > now()) {
          return { accessToken: entry.settled.accessToken, cached: true }
        }
        forget(key, entry)
      } else if (entry) {
        // Another request is already refreshing this credential: share it.
        const token = await entry.promise
        return { accessToken: token.accessToken, cached: false }
      }
      const token = await refresh(key, load)
      return { accessToken: token.accessToken, cached: false }
    },

    // Drop a token the provider rejected, unless a newer one replaced it.
    reject(key: string, accessToken: string) {
      const entry = entries.get(key)
      if (entry?.settled?.accessToken === accessToken) forget(key, entry)
    },
  }
}
