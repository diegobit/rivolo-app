# OneDrive Agent access on the hosted MCP

Date: 19 November 2026. Baseline: `main` at `ed2bbbe`, which includes PR #34 (daily sync for Dropbox and Google Drive, hosted MCP daily folders).

## Goal

OneDrive users can enable Agent access in Settings and use the hosted MCP (`mcp.aitlab.it`) exactly as Dropbox and Google Drive users do: the same read and write tools, personal tokens, OAuth grants, and disable/revoke behavior. Agent writes reach open OneDrive apps without a reload.

## Starting point

| | Dropbox | Google Drive | OneDrive |
|---|---|---|---|
| Hosted MCP on a daily folder | yes, `mcp/hostedDailyNotes.ts` | yes | no |
| Refresh token stored in the D1 profile | yes | yes | no |
| Settings Agent access panel | shown | shown | hidden: `SyncSection.tsx` renders it only when `provider !== 'onedrive'` |
| How open apps see an agent write | 3-minute interval reconcile | 3-minute interval reconcile | no interval; only start, foreground, reconnect, or a relay event |
| Local MCP | file or daily folder | file or daily folder | daily folder already works; `mcp/README.md` still says it does not |

OneDrive notebooks are always daily, so OneDrive skips the single-file profile and the `/api/mcp/daily-target` cutover: its profile is created on the daily folder directly.

## Scope

OneDrive-specific, except for three shared touch points:

- `src/lib/oneDriveGraph.ts` is refactored; the client OneDrive sync uses it too.
- The D1 table `mcp_provider_profiles` is rebuilt; it holds every provider's profile, tokens, and OAuth grants by foreign key.
- The MCP Worker gains a binding to the OneDrive events relay.

Dropbox and Google Drive behavior does not change.

## Decisions

Settled with the user on 19 November 2026:

- Losing existing personal tokens or OAuth grants during the D1 rebuild is acceptable; agents reconnect. Still prefer a migration that keeps them, but no production dry run is required.
- Microsoft refresh tokens expire after 90 days unused and cannot be configured longer. The MCP Worker's daily cron refreshes OneDrive credentials before that, but only for profiles with a personal token or OAuth grant created or used in the last 90 days; abandoned profiles still expire. Credential refreshes are recorded in `credential_refreshed_at`, not `updated_at`, which Settings uses to detect concurrent changes.
- This fork owns migration `0006`. Upstream's next migration will use `0007`.

Phases 3 and 4 use these choices:

- OneDrive writes use `Agent · <Microsoft display name>` when the agent profile has a display name, or `Agent` otherwise. Dropbox and Google Drive keep `Agent`.
- The hosted Worker publishes immediate change notifications for OneDrive writes. Dropbox and Google Drive retain their current reconciliation.
- The Microsoft grant keeps `Files.ReadWrite.All` for access to notebooks shared from other drives. Privacy explains the credential scope and the Worker's use of the configured notebook folder.

## Phases

Each phase is one PR to `dev`, then `main`. Run `npm run build`, `npm run lint`, and `npm test` for each. Read [tests/AGENTS.md](../../tests/AGENTS.md) before touching tests.

### 1. Graph driver usable outside the browser

`oneDriveGraph.ts` calls `authorizedOneDriveFetch` and `getOneDriveState()` and keeps module-level `retryAfterAt`, `driveTypes`, and `verifiedContentConditions`. Move the implementation to `src/lib/oneDriveGraphApi.ts` as `createOneDriveGraph({ authorizedFetch, accountKey, fetch })`, holding that state per instance. `oneDriveGraph.ts` binds one instance to the browser session and keeps its exports, so client callers are unchanged.

Done when: no behavior change; existing OneDrive tests pass with unchanged assertions.

### 2. Profile storage and enable endpoint (done)

- `migrations/0006`: rebuild `mcp_provider_profiles` to allow `provider = 'onedrive'` with no file columns and a required `daily_folder_id`. SQLite cannot alter a CHECK in place.
  - `DROP TABLE` on the parent runs an implicit DELETE that fires `ON DELETE CASCADE` on tokens, write operations, and OAuth rows; `PRAGMA defer_foreign_keys` does not stop it.
  - Renaming the old table away does not help: with foreign keys on, SQLite repoints child references at the renamed table even under `PRAGMA legacy_alter_table=ON`.
  - Implemented: copy the child rows to temporary tables, drop and replace the parent, restore the rows with the same keys, recreate both revoke triggers. `src/test/mcpMigrations.test.ts` proves rows and triggers survive on SQLite; the remote D1 apply is still unverified.
  - The rebuild also adds `onedrive_folder_name` and `credential_refreshed_at`.
- `functions/_lib/providerProfiles.ts`: OneDrive variant with target `{ folder, folderName }`. Extend the `ON CONFLICT … WHERE` guard so a different folder still requires disabling first.
- `functions/_lib/providerAccess.ts`: `fetchOneDriveAccount` (`/me`, `id` as account ID) and `verifyOneDriveDailyTarget` (item is a folder; store its canonical `/drives/{drive}/items/{id}` address).
- `functions/api/onedrive/mcp-enable.ts`, modeled on the Dropbox handler. It must live under `/api/onedrive` because the refresh cookie is scoped there. Save the rotated refresh token to both the cookie and D1.
- `/api/mcp/daily-target` rejects OneDrive.
- Until phase 3, the Worker answers a OneDrive profile with an explicit "not available yet" error.

### 2b. Credential keep-alive (done)

- `functions/_lib/mcpCredentialKeepAlive.ts`, run from `scheduled()` in `mcp/worker.ts` after the D1 cleanup. It refreshes up to 25 active OneDrive profiles per run whose credential is older than 30 days, stalest first, and stores the returned token. A failed refresh is logged and leaves the profile alone.
- `ProviderProfileRepository.updateCredential` now sets `credential_refreshed_at` instead of `updated_at`, for every provider.
- `ONEDRIVE_CLIENT_ID` is in `wrangler.mcp.toml`; `ONEDRIVE_CLIENT_SECRET` must be set as a Worker secret (prod and dev). Without it the cron logs a warning and skips the refresh.

### 3. MCP Worker (implemented)

- `mcp/remoteServer.ts`: `createOneDriveAccessToken`, persisting rotated refresh tokens as the Dropbox path does. The Worker config and secret already exist from phase 2b.
- `mcp/hostedDailyNotes.ts`: OneDrive branch using the phase 1 driver. The app and Worker share the Graph daily-file adapter. The hosted providers share the read, additive write, conflict retry, and attribution logic. The durable result includes write metadata only.
- Relay: bind `ONEDRIVE_EVENTS` in `wrangler.mcp.toml` with `script_name` `rivolo-onedrive-events` (prod) and `rivolo-onedrive-events-dev` (dev). After a write, publish `day-changed` with `sender: ''` to `roomName('daily:' + folder)`, the derivation `/api/onedrive/daily-events` uses. A failed publish must not fail the already committed write.

### 4. Settings and documentation (implemented)

- `SyncSection.tsx`: remove the OneDrive exclusions from the Agent access panel and from target-mutation gating.
- `Settings.tsx`: OneDrive branch in `handleEnableAgentAccess` using the folder address from OneDrive state; route OneDrive target changes through `runWithAgentSafety`; run OneDrive disconnects and provider connections that would switch away from an enabled OneDrive profile through the same safety check; `targetReady` is false until a legacy-file migration completes.
- `src/lib/agentAccess.ts`: OneDrive variant in the profile and enable-target types and in `agentAccessTargetLabel`. The panel's advanced details show the folder.
- `Privacy.tsx`, `README.md`, `mcp/README.md`: server-stored Microsoft credential, Worker processing of note text, local MCP on a synced OneDrive folder. Check copy under both Rivolo and AIT identities.

### 5. Verification

Automated: Graph through HTTP-routed fixtures; D1 repository proofs on the current migrations; hosted MCP read and append on a OneDrive daily fixture; idempotent retry with the same `operation_id`.

Live, on a personal and a business Microsoft account, recorded in `docs/verification.md`:

- Worker subrequest count for an unbounded read on a realistic notebook, against the deployed Workers plan.
- Conditional writes from the Worker: personal-drive deferred commit and the business-drive probe.
- Browser and Worker refreshing the same Microsoft grant independently.
- Agent append while the app is open appears without reload; append to a day being edited merges both; offline device reconnects after an agent write; a folder shared from another drive; revoked or expired token gives a reconnect message.
- Settings at 320, 375, and 1280 px. iOS Safari and installed PWA need a physical device; report them as not run if none is available.
