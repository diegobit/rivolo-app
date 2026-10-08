import type { D1Database } from '@cloudflare/workers-types'

export interface McpD1CleanupOptions {
  /**
   * Retention for authorization codes in hours (default: 24h).
   * Unused/used expired codes older than this are purged.
   */
  authCodeRetentionHours?: number
  /**
   * Retention for revoked token families in days (default: 30 days).
   */
  revokedTokenFamiliesRetentionDays?: number
  /**
   * Retention for expired token families in days (default: 30 days).
   * Token families where all grants have expired older than this are purged.
   */
  expiredTokenFamiliesRetentionDays?: number
  /**
   * Retention for completed write idempotency records in days (default: 30 days).
   */
  writeOperationsRetentionDays?: number
  /**
   * Retention for stale pending write operations in days (default: 7 days).
   */
  stalePendingWriteOperationsDays?: number
  /**
   * Clock override for testing.
   */
  now?: Date | (() => Date)
}

export interface McpD1CleanupStats {
  deletedAuthorizationCodes: number
  deletedTokenGrants: number
  deletedTokenFamilies: number
  deletedWriteOperations: number
}

const DEFAULT_AUTH_CODE_RETENTION_HOURS = 24
const DEFAULT_REVOKED_FAMILIES_RETENTION_DAYS = 30
const DEFAULT_EXPIRED_FAMILIES_RETENTION_DAYS = 30
const DEFAULT_WRITE_OPERATIONS_RETENTION_DAYS = 30
const DEFAULT_STALE_PENDING_DAYS = 7
const BATCH_DELETE_CHUNK_SIZE = 100

const resolveNow = (now?: Date | (() => Date)): Date => {
  if (!now) return new Date()
  return typeof now === 'function' ? now() : now
}

const hoursAgoIso = (now: Date, hours: number): string =>
  new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()

const daysAgoIso = (now: Date, days: number): string =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

/**
 * Periodically purges stale and expired records from the Rivolo MCP D1 database:
 * 1. Expired OAuth authorization codes.
 * 2. Revoked and expired OAuth token families along with their associated grants.
 * 3. Completed and stale pending write idempotency operations.
 */
export async function runMcpD1Cleanup(
  db: D1Database,
  options: McpD1CleanupOptions = {},
): Promise<McpD1CleanupStats> {
  const now = resolveNow(options.now)

  // 1. OAuth authorization codes
  const authCodeCutoff = hoursAgoIso(
    now,
    options.authCodeRetentionHours ?? DEFAULT_AUTH_CODE_RETENTION_HOURS,
  )
  const authCodesResult = await db
    .prepare(
      `DELETE FROM mcp_oauth_authorization_codes
      WHERE expires_at < ?`,
    )
    .bind(authCodeCutoff)
    .run()

  const deletedAuthorizationCodes = authCodesResult.meta.changes ?? 0

  // 2. OAuth token families and grants
  const revokedFamiliesCutoff = daysAgoIso(
    now,
    options.revokedTokenFamiliesRetentionDays ?? DEFAULT_REVOKED_FAMILIES_RETENTION_DAYS,
  )
  const expiredFamiliesCutoff = daysAgoIso(
    now,
    options.expiredTokenFamiliesRetentionDays ?? DEFAULT_EXPIRED_FAMILIES_RETENTION_DAYS,
  )

  // Find family_ids eligible for purging:
  // a) Explicitly revoked families older than the revoked retention threshold
  // b) Families where all grants have expired older than the expired retention threshold
  // c) Empty/orphan families created before the expired retention threshold
  const eligibleFamilies = await db
    .prepare(
      `SELECT family_id FROM mcp_oauth_token_families
      WHERE revoked_at IS NOT NULL AND revoked_at < ?
      UNION
      SELECT family_id FROM mcp_oauth_token_grants
      GROUP BY family_id
      HAVING MAX(refresh_expires_at) < ?
      UNION
      SELECT f.family_id FROM mcp_oauth_token_families f
      LEFT JOIN mcp_oauth_token_grants g ON f.family_id = g.family_id
      WHERE g.grant_id IS NULL AND f.created_at < ?`,
    )
    .bind(revokedFamiliesCutoff, expiredFamiliesCutoff, expiredFamiliesCutoff)
    .all<{ family_id: string }>()

  const familyIds = (eligibleFamilies.results ?? []).map((row) => row.family_id)

  let deletedTokenGrants = 0
  let deletedTokenFamilies = 0

  // Delete grants and families directly by identified family IDs in chunks
  // to avoid SQLite host parameter limits and prevent subquery side-effects.
  if (familyIds.length > 0) {
    for (let i = 0; i < familyIds.length; i += BATCH_DELETE_CHUNK_SIZE) {
      const chunk = familyIds.slice(i, i + BATCH_DELETE_CHUNK_SIZE)
      const placeholders = chunk.map(() => '?').join(', ')

      // Delete child grants first
      const grantsResult = await db
        .prepare(
          `DELETE FROM mcp_oauth_token_grants
          WHERE family_id IN (${placeholders})`,
        )
        .bind(...chunk)
        .run()

      deletedTokenGrants += grantsResult.meta.changes ?? 0

      // Delete parent families
      const familiesResult = await db
        .prepare(
          `DELETE FROM mcp_oauth_token_families
          WHERE family_id IN (${placeholders})`,
        )
        .bind(...chunk)
        .run()

      deletedTokenFamilies += familiesResult.meta.changes ?? 0
    }
  }

  // 3. Write operations idempotency records
  const completedWritesCutoff = daysAgoIso(
    now,
    options.writeOperationsRetentionDays ?? DEFAULT_WRITE_OPERATIONS_RETENTION_DAYS,
  )
  const stalePendingWritesCutoff = daysAgoIso(
    now,
    options.stalePendingWriteOperationsDays ?? DEFAULT_STALE_PENDING_DAYS,
  )

  const writeOpsResult = await db
    .prepare(
      `DELETE FROM mcp_write_operations
      WHERE (state = 'completed' AND updated_at < ?)
         OR (state = 'pending' AND updated_at < ?)`,
    )
    .bind(completedWritesCutoff, stalePendingWritesCutoff)
    .run()

  const deletedWriteOperations = writeOpsResult.meta.changes ?? 0

  return {
    deletedAuthorizationCodes,
    deletedTokenGrants,
    deletedTokenFamilies,
    deletedWriteOperations,
  }
}
