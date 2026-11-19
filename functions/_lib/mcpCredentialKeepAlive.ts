import { ProviderProfileRepository } from './providerProfiles'

// Microsoft refresh tokens expire after 90 days without use, and every refresh
// returns a new one with a fresh 90 days. Agents that call the hosted MCP only
// now and then would otherwise lose OneDrive access, so the daily job refreshes
// stored credentials before they lapse.
//
// Only profiles an agent still uses are kept alive: the stored credential can
// reach the user's whole OneDrive, and expiry is what retires abandoned ones.

export type CredentialKeepAliveOptions = {
  // Refresh credentials last saved or refreshed before this many days ago.
  refreshAfterDays?: number
  // Keep a profile alive only if a personal token or OAuth grant of it was
  // created or used within this many days.
  activeWithinDays?: number
  // Each refresh is one outgoing request; a scheduled run has a request cap.
  limit?: number
  now?: () => Date
}

export type CredentialKeepAliveStats = {
  due: number
  refreshed: number
  failed: number
}

type RefreshResult = { refresh_token?: string }

const DAY_MS = 24 * 60 * 60 * 1000

export async function refreshIdleOneDriveCredentials(
  db: D1Database,
  encryptionSecret: string,
  refresh: (refreshToken: string) => Promise<RefreshResult>,
  options: CredentialKeepAliveOptions = {},
): Promise<CredentialKeepAliveStats> {
  const now = (options.now ?? (() => new Date()))()
  const refreshCutoff = new Date(now.getTime() - (options.refreshAfterDays ?? 30) * DAY_MS).toISOString()
  const activeCutoff = new Date(now.getTime() - (options.activeWithinDays ?? 90) * DAY_MS).toISOString()

  // The stalest credentials come first, so a capped run never starves them.
  const due = await db
    .prepare(
      `SELECT profile.profile_id
      FROM mcp_provider_profiles AS profile
      WHERE profile.provider = 'onedrive'
        AND profile.revoked_at IS NULL
        AND profile.encrypted_refresh_token <> ''
        AND COALESCE(profile.credential_refreshed_at, profile.updated_at) < ?
        AND (
          EXISTS (
            SELECT 1 FROM mcp_personal_tokens AS token
            WHERE token.profile_id = profile.profile_id
              AND token.revoked_at IS NULL
              AND COALESCE(token.last_used_at, token.created_at) >= ?
          )
          OR EXISTS (
            SELECT 1 FROM mcp_oauth_token_families AS family
            INNER JOIN mcp_oauth_token_grants AS grant_row
              ON grant_row.family_id = family.family_id
            WHERE family.profile_id = profile.profile_id
              AND family.revoked_at IS NULL
              AND grant_row.created_at >= ?
          )
        )
      ORDER BY COALESCE(profile.credential_refreshed_at, profile.updated_at) ASC
      LIMIT ?`,
    )
    .bind(refreshCutoff, activeCutoff, activeCutoff, options.limit ?? 25)
    .all<{ profile_id: string }>()

  const profileIds = (due.results ?? []).map((row) => row.profile_id)
  const repository = new ProviderProfileRepository(db, encryptionSecret, () => now)
  let refreshed = 0
  let failed = 0
  for (const profileId of profileIds) {
    try {
      const current = await repository.decryptCredential(profileId)
      if (!current) continue
      const token = await refresh(current)
      // Saving the same token still records the refresh time.
      await repository.updateCredential(profileId, token.refresh_token ?? current)
      refreshed += 1
    } catch (error) {
      // A revoked consent or reset password needs the user to enable Agent
      // access again; the profile stays as it is until then.
      failed += 1
      const code = (error as { code?: unknown } | null)?.code ?? null
      console.warn('[mcp-credential-keepalive] refresh failed', { profileId, code })
      // A grant Microsoft rejected stays rejected. Record the attempt so dead
      // credentials do not take every slot ahead of healthy ones each day.
      // Other errors may be transient and keep their place for tomorrow.
      if (code === 'invalid_grant') {
        await db
          .prepare(
            `UPDATE mcp_provider_profiles SET credential_refreshed_at = ?
            WHERE profile_id = ? AND revoked_at IS NULL`,
          )
          .bind(now.toISOString(), profileId)
          .run()
          .catch(() => undefined)
      }
    }
  }
  return { due: profileIds.length, refreshed, failed }
}
