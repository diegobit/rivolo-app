# MCP D1 Cleanup & Maintenance — Reflections and Future Improvements

Status: Planned / Backlog. Documented following code review by Cursor on 2026-10-05.

## Context

PR #34 and PR #35 implemented the automated daily D1 database cleanup trigger (`0 3 * * *` UTC) in `mcp/worker.ts` and `functions/_lib/mcpCleanup.ts`. It purges:
- Expired OAuth authorization codes (> 24 hours)
- Revoked and expired OAuth token families and their associated child grants (> 30 days)
- Completed write idempotency operations (> 30 days) and stale pending write operations (> 7 days)

An in-depth review by `$delegate cursor` confirmed that the architecture is sound, decoupled from live agent traffic, and operates well within Cloudflare Workers and D1 free-tier quotas (0 cost). The review highlighted four specific reflection points and future hardening opportunities.

---

## 1. Idempotency vs. Stale Pending Writes (7-Day Purge)

### Observation
In `functions/_lib/mcpCleanup.ts`:
```sql
DELETE FROM mcp_write_operations
WHERE (state = 'completed' AND updated_at < ?)
   OR (state = 'pending' AND updated_at < ?)
```
Currently, pending write operations older than 7 days are deleted.
However, in `functions/_lib/mcpWriteIdempotency.ts`:
- A record is marked `state = 'pending'` when an insert attempt was started but an error occurred before completion (e.g. network timeout to Dropbox or Google Drive).
- In this state, the server cannot guarantee whether the provider actually executed the file edit or not.
- The contract tells the client: *"outcome ambiguous; verify notes before retrying"*.

### Potential Risk
If a pending row is deleted after 7 days, a delayed client retrying with the same `operation_id` will treat it as a new transaction and may write a duplicate note into the user's daily file.

### Proposed Solutions to Evaluate
- **Option A (Safe status transition)**: Instead of deleting pending rows, migrate them after 7 days to `state = 'failed'` or `state = 'abandoned'` so they remain in the database indefinitely (or for 90 days) and prevent replay.
- **Option B (Never delete pending)**: Only purge rows with `state = 'completed'`. Given that `pending` rows only occur during rare network drops, table growth would be negligible (dozens of rows per year).
- **Option C (Keep current 7-day TTL)**: If we assume interactive MCP clients abandon uncompleted tool operations within minutes or hours, 7 days is practically sufficient.

---

## 2. D1 SQL Parameter Headroom (`BATCH_DELETE_CHUNK_SIZE`)

### Observation
In `functions/_lib/mcpCleanup.ts`:
```ts
const BATCH_DELETE_CHUNK_SIZE = 100
```
Cloudflare D1 enforces a maximum bound parameter limit per query of 100 parameters (`SQLITE_MAX_VARIABLE_NUMBER` in D1's specific runtime wrapper).

### Potential Risk
Chunking exactly at 100 leaves zero margin. If any additional parameter (e.g. timestamp, profile_id filter) is added to the delete query in the future, the query will immediately reject with a parameter limit error.

### Proposed Action
- Lower `BATCH_DELETE_CHUNK_SIZE` to `50` (or `80`) to provide comfortable headroom for additional bindings and ensure compatibility across D1 engine updates.

---

## 3. Pruning Consumed Grants (`refresh_used_at`) in Active Token Families

### Observation
- The OAuth 2.1 implementation in `functions/_lib/mcpOAuth.ts` rotates the refresh token on every exchange.
- Used refresh tokens are kept with `refresh_used_at` populated to detect token replay/theft (if an already-used refresh token is presented, the entire family is revoked).
- `runMcpD1Cleanup` only purges token families where `MAX(refresh_expires_at) < cutoff` (i.e., wholly expired families).
- For a long-running agent or client that refreshes continuously (e.g. daily for a year), the family stays perpetually active and old consumed grants continue accumulating.

### Potential Risk
At large scale (hundreds of active agents refreshing frequently for months), `mcp_oauth_token_grants` could grow to tens of thousands of historical rows that are scanned during the daily group-by query.

### Proposed Action
- Add a cleanup step for active families that purges only already-used grants (`refresh_used_at IS NOT NULL` and `refresh_expires_at < cutoff_30d`), while keeping the most recent grant and unexpired refresh tokens intact.
- Add an index on `mcp_oauth_token_grants(family_id, refresh_expires_at)` if grant tables grow significantly.

---

## 4. Query Semantics for Recently Revoked Families with Pre-Expired Grants

### Observation
In the family eligibility query:
```sql
SELECT family_id FROM mcp_oauth_token_families
WHERE revoked_at IS NOT NULL AND revoked_at < ?
UNION
SELECT family_id FROM mcp_oauth_token_grants
GROUP BY family_id
HAVING MAX(refresh_expires_at) < ?
UNION
...
```
The second `SELECT` arm does not specify `revoked_at IS NULL`.

### Analysis
If a family's refresh tokens expired 40 days ago, and then the user or server explicitly revokes it yesterday, the second arm will immediately select it for deletion because its `MAX(refresh_expires_at)` is older than the 30-day cutoff, bypassing the 30-day post-revocation retention window.
While this does not cause security issues (the tokens were already completely expired), it slightly violates the configured `revokedTokenFamiliesRetentionDays` guarantee for audit logs.

### Proposed Action
- Refine the second arm to:
  ```sql
  SELECT g.family_id FROM mcp_oauth_token_grants g
  JOIN mcp_oauth_token_families f ON f.family_id = g.family_id
  WHERE f.revoked_at IS NULL
  GROUP BY g.family_id
  HAVING MAX(g.refresh_expires_at) < ?
  ```
