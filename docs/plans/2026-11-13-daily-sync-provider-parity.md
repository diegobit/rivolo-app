# Daily sync for Dropbox and Google Drive: parity with OneDrive

Updated 17 November 2026. Reviewed against `origin/main` at `17fd7d0` (Rivolo 0.8.0). The shared reconciliation and storage extraction is in progress. Provider rollout remains gated below.

This supersedes one constraint of [the OneDrive daily plan](2026-10-01-onedrive-daily-sync.md): "Google Drive and Dropbox keep the single Markdown file". Everything else in that plan (line merge rules, no remote manifest, no continuous polling, draft protection, relay carries metadata only) stays in force and applies to all three providers.

## 1. Goal

Dropbox and Google Drive get what OneDrive has today, through one provider-neutral daily engine and three thin remote drivers. After the last phase there is one sync engine in the client; the monolithic push/pull code survives only as a migration source reader.

Scope is cross-provider: it changes shared sync logic, both other providers, the relay, and the MCP readers.

## 2. Gap today

| Capability | OneDrive | Dropbox | Google Drive |
| --- | --- | --- | --- |
| Remote format | `YYYY/MM/YYYY-MM-DD.md` per day | one file | one file |
| Dirty tracking | per day, SQLite journal written by triggers | one flag | one flag |
| Concurrent edits | three-way line merge per day | push blocked, user picks a copy | blocked, plus revision recovery into a backup |
| Remote change while local is dirty | merged | pull is a no-op | pull is a no-op |
| Live updates | relay WebSocket, targeted pull of one day | 3-minute interval | 3-minute interval |
| Lost-reply and partial-batch recovery | per-day checkpoint, `pending` upload record | none | none |
| Deletions | per day, verified against inventory | whole-file replace | whole-file replace |
| Line authors (footer, gutter) | yes | no | no |
| Shared notebook across accounts | sharing link or folder | no | no |
| Issues | one per category (`files`, `relay`) | single attention item | single attention item |
| Offline history progress (`offlineReady`) | yes | n/a | n/a |
| Hosted MCP Agent access | no | yes (reads/writes the single file) | yes |

## 3. Decisions needed from Diego

Decide cross-account sharing per provider after its live account checks. The shared extraction and compatibility work can proceed independently of sharing.

1. **Google Drive sharing across accounts.** The app requests `drive.file`, which only exposes files the app created for that user or files the user picked. A folder shared by another account is therefore not listable (forum reports say picking a folder does not expose its children; unverified). Recommended: ship daily sync for one account across devices on `drive.file`, and make the scope a deployment setting so the AIT Workspace deployment can opt into the restricted `drive` scope as an internal app. Phase 0 verifies both.
2. **Migration can run automatically after the compatibility gates pass.** Keep the old file and import edits from clients still using it. Verify that both hosted MCP and the app target the same daily notebook before enabling automatic cutover.
3. **Hosted MCP must be ported before a provider migrates**, otherwise Agent access breaks for migrated users. Adding OneDrive to hosted MCP becomes cheap once MCP reads daily folders, but needs Microsoft token storage server-side: recommended as a follow-up, not part of this plan.
4. **Dropbox app type.** If the registered Dropbox app is "App folder", shared folders are impossible without a new app registration and a re-consent. Phase 0 checks; if so, decide whether Dropbox gets sharing or stays single-account.
5. **Keep the existing SQLite table names.** Preserve the OneDrive target keys and row format. Namespace new provider targets in the existing tables.

## 4. Architecture

### 4.1 What is already neutral

- The journal (`onedrive_day_changes` + triggers in `src/lib/sqliteRuntime.ts`) records every note mutation once, for all providers.
- `onedrive_daily_state` and the outbox are keyed by target, so several notebooks coexist.
- `notebookDays.ts`, `oneDriveMerge.ts`, `oneDriveBlame.ts`, `sequenceDiff.ts` contain no Graph calls. Only names and error strings mention OneDrive.
- `workers/onedrive-events/index.ts` relays opaque JSON to a room; it knows nothing about Microsoft.

### 4.2 What to extract

Split `oneDriveDailySync.ts` / `oneDriveDailyState.ts` into an engine plus a driver interface. Indicative shape, adjust to what the code needs:

```ts
type RemoteFile = { ref: string; name: string; revision: string }   // ref and revision are opaque
type DailyRemote = {
  provider: SyncProviderId
  inventory(target): Promise<Map<string, RemoteFile>>      // complete, or throws
  stat(target, dayId): Promise<RemoteFile | null>
  statByRef(ref): Promise<RemoteFile | null>               // detects moves and renames
  download(file): Promise<string>
  prepareWrite(target, dayId, expected: RemoteFile | null): Promise<WriteDay>
  remove(file, beforeCommit): Promise<void>                // requires verified protection against concurrent edits
  assertFolder(target): Promise<void>                      // folder still exists and is writable
}
```

- `reconcileDay`, `pushDailyNotebook`, `pullDailyNotebook`, checkpoints, deferral and the pass backup move to the engine unchanged in behavior. `oneDriveGraph.ts` becomes the first driver. Graph-only details (upload sessions, the business conditional-write probe, `parentReference`) stay inside it.
- `NotebookTarget` gains `provider`. Keep the OneDrive `targetKey` byte-identical (`[account, folder]`) so existing baselines are not orphaned; new providers use `[provider, account, folder]`.
- Target assertion (`assertTarget`, `assertTargetInDatabase`) reads the state of the target's provider instead of `onedrive.state`.
- Provider state modules keep their own settings keys. Do not merge three state shapes into one.
- Replace every `provider === 'onedrive'` branch with a property of the active provider. Sites: `useAutoSync.ts`, `store/syncActions.ts`, `DayEditorCard.tsx`, `useDayAttribution.ts`, `MobileMenu.tsx`, `SyncSection.tsx`, `useSyncProviderActions.ts`, `syncDirty.ts`. During the transition the property is "uses the daily engine"; after phase 7 the branches disappear.
- Use neutral names for the engine and storage modules and use `SYNC_PROVIDER_LABELS` for shared errors. Existing merge and attribution names can migrate when their next consumers land.

Do not build more abstraction than three drivers need: no plugin registry, no generic OAuth layer, no shared settings schema.

### 4.3 Relay

- New versioned endpoint `/api/sync/daily-events` taking `provider`. Subscribe, publish and invalidate keep today's semantics. Access and day-membership checks go through a per-provider verifier called with the caller's bearer token, as `functions/_lib/oneDriveNotebook.ts` does now.
- Room name = hash of `provider + canonical folder identity`. Keep the existing OneDrive room derivation so old and new clients share a room during rollout; keep `/api/onedrive/daily-events` until old clients are gone.
- Reuse the deployed Worker and Durable Object class. Add the binding and ticket key under neutral names; do not rename the deployed Worker.
- The relay must be optional. A deployment without it (503 "not configured") falls back to the interval reconcile that Dropbox and Google Drive use today, without raising a `relay` issue. OneDrive keeps its current behavior.
- External edits (Dropbox desktop client, Drive web) emit no relay event, as on OneDrive: they are found on start, foreground and reconnect.

### 4.4 Migration

Generalize `oneDriveMigration.ts` into: snapshot local and remote, reconcile, split by day, upload with per-day checkpoints, verify, then atomically switch target and baselines. Keep OneDrive's registry, lease and permission replication as OneDrive-only hooks: the other two files are single-account today, so their destination can be deterministic and needs no registry.

- Dropbox: destination is a folder at a deterministic path derived from the source (`/inbox.md` → `/Rivolo` by default; state the rule for custom paths in the PR). Two devices migrating at once converge because creation is `add` without autorename and a conflict falls into the normal day merge.
- Google Drive: destination is the existing app-created Rivolo folder (`appProperties.rivoloSync = 'folder'`); day files sit beside the retained single file.
- Before enabling automatic migration, check the retained source during full reconciles. If its revision changed, merge the changed days using the last successfully imported source contents as the baseline. Record that source revision and baseline after the affected days have durable checkpoints. Verify interrupted imports, two successive old-client writes, and an old app reconnecting after MCP cutover. Apply the same check to OneDrive as a follow-up.
- The same barrier as today: no auto-sync, auto-push or subscription for a provider before its migration check.

## 5. Provider drivers

### 5.1 Dropbox

- Conditional writes are atomic: update with `mode: {".tag": "update", "update": rev}` (already used in `src/lib/dropbox.ts`), create with `mode: "add"` and `autorename: false`, both with `strict_conflict: true`; delete with `files/delete_v2` and `parent_rev`.
- Inventory: one recursive `files/list_folder` with pagination, instead of per-month listing. Keep the cursor: `list_folder/continue` makes later reconciles a delta. This is an optimization inside the driver; the engine still receives a complete map.
- `ref` = Dropbox file `id:`, `revision` = `rev`. Paths are case-insensitive: validate names against `path_display`, compare with `path_lower`.
- Shared notebooks: a collaborator mounts the shared folder, then enters its path in their own Dropbox. Canonical identity for the relay room is `sharing_info.shared_folder_id` when present, otherwise account id plus folder id. Sharing-link resolution like OneDrive's is not available for writes; do not emulate it.
- Not planned: team-space path roots (`Dropbox-API-Path-Root`), `list_folder/longpoll`. Record in the PR if Phase 0 shows either is required.

### 5.2 Google Drive

- **Conditional writes are unverified.** Test stale media writes and delete-versus-edit against live Drive. If updates cannot be made conditional, verify whether overwritten revisions can be listed, retained and downloaded reliably through the app's scope. Google requires older blob revisions to be marked Keep Forever to download them. Verify retention, visibility lag, pagination and lost replies before choosing a recovery strategy. Leave a day pending and retain recoverable copies if verification is inconclusive. Gate automatic Drive migration on an end-to-end proof.
- **Names are not unique.** Inventory can identify duplicates and choose a stable canonical candidate. Reconcile their content explicitly before moving or trashing anything. Retain both copies when revisions or membership cannot be verified. Drive may report `incompleteSearch` on a successful listing, so fail the inventory rather than infer deletions.
- Inventory: tag every day file with `appProperties` (`rivoloNotebook = <folderId>`, `rivoloDay = <dayId>`) and list them with one paginated `files.list` query. Under `drive.file` the app cannot see files created outside it anyway, so this loses nothing. Still verify name, parent chain and day marker before importing.
- `ref` = file id; `revision` = `headRevisionId` (content changes only; `version` also moves on metadata changes).
- Verify whether Drive can protect trashing against a concurrent edit. If a revision check leaves a race, keep deletion pending or require an explicit recoverable resolution.
- Sharing depends on decision 1. With `drive.file`, hide the shared-folder input for Google Drive and say why in the settings copy.

## 6. MCP

`mcp/googleDriveNotesSource.ts` and `mcp/providers/dropboxNotes.ts` read and rewrite the single file, and `functions/_lib/providerProfiles.ts` stores a file target. A migrated notebook breaks them.

- Add daily-folder sources for both providers behind the existing `NotesSnapshot` interface. `add_to_day` then writes one day file with the driver's conditional write and merge, and publishes a relay event so open apps update live.
- The source must accept both formats and pick by target type, so MCP can deploy before any client migrates.
- Add a validated same-notebook profile transition that preserves the profile ID. The existing `mcp-enable` flow rejects changing the target of an active profile. Persist cutover progress so either side can resume after a partial switch. Test a connected agent and an append racing with cutover.
- Measure cold-cache whole-notebook search, tags, todos, and mentions against the actual Worker subrequest budget. Bounded concurrency does not reduce the number of subrequests. Options, in order of preference: download only days the tool needs and fan out with bounded concurrency; a per-isolate cache keyed by file revision; Dropbox `files/download_zip` for the folder. Do not persist note content server-side and do not reintroduce a derived single file.
- Share the day codec and merge with the client (`src/lib/notebookDays.ts`, merge module) rather than reimplementing them in `mcp/`.

## 7. Phases

Each phase is one PR to `dev`, with `npm run build`, `npm run lint`, `npm test` and the checks named below. Read [tests/AGENTS.md](../../tests/AGENTS.md) before touching tests. Do not start a phase whose gate is open.

| # | Work | Done when |
| --- | --- | --- |
| 0 | Spikes on real accounts, no product code: Dropbox app type, shared-folder mount, create/update/delete races; Drive `If-Match`, revision ordering under two concurrent writers, duplicate names, `drive.file` on a picked shared folder, `appProperties` listing; MCP subrequest count on a realistic history | Findings and limits recorded in `docs/verification.md`; decisions 1 and 4 answerable; §5.2 strategy fixed |
| 1 | Extract the daily engine and storage; OneDrive becomes the first driver; keep existing SQLite names and keys | No behavior change. Existing OneDrive tests pass with unchanged assertions; a driver contract suite (HTTP-routed fixtures, real SQLite) runs against the OneDrive driver; a database from the previous schema opens with baselines, dirty days and outbox intact |
| 2 | Generic relay endpoint, provider verifiers, neutral client events module, optional-relay fallback | `npm run test:events-runtime` covers a second provider: room isolation between providers, membership refusal, expired ticket; OneDrive old endpoint still works |
| 3 | MCP daily sources for Dropbox and Google Drive, both formats accepted | Hosted and local MCP read and append against a daily fixture and still pass single-file tests |
| 4 | Dropbox driver, migration, settings, blame and live updates enabled | Contract suite passes for Dropbox; cases in §8; two real Dropbox accounts on one shared folder if decision 4 allows; old-client import and hosted MCP cutover pass before migration is enabled |
| 5 | Google Drive driver (strategy from Phase 0), duplicate resolution, migration, settings | Contract suite passes; duplicate creation, concurrent edits, lost replies and delete-versus-edit are recoverable; real two-device run on one account; old-client import and hosted MCP cutover pass before migration is enabled |
| 6 | Apply retained-source handling to existing OneDrive migrations | A write to the old OneDrive file after migration is merged in and reported |
| 7 | Delete the single-file push/pull paths, `blocked` push result and its UI, the whole-notebook dirty flags; update README, privacy text, MCP README, settings copy | No `provider ===` branches left in sync code; record deletions per tests/AGENTS.md |

Order rationale: Dropbox goes first because its conditional writes are strong, so it proves the abstraction; Google Drive is the driver most likely to bend the interface. Phase 3 precedes 4 and 5 so Agent access never breaks. Deploy order inside a phase stays Worker, then Pages Functions, then client.

## 8. Cases every driver must pass

Run through the shared contract suite, then by hand on real accounts where marked in the phase table.

- Editing today uploads only today's file; unchanged days are neither downloaded nor compared.
- Two writers, different lines of one day: both survive. Same line: last completed writer wins after re-merge. Both create the same new day: contents combine.
- Upload reply lost: the next pass recognizes its own upload and does not duplicate lines.
- Two dirty days, one upload fails: the other is checkpointed; retry sends only the failed day.
- Offline edits, then reconnect: merged against the stored baseline, not treated as all-new text.
- Local delete against remote edit, remote delete against local edit, delete while offline: per the OneDrive rules; an incomplete inventory never deletes anything.
- A draft in one day defers only that day.
- Account or target change mid-pass stops the pass and never publishes with the old context.
- Migration: interrupted and resumed, two devices at once, remote newer than local, no baseline with diverging copies (explicit choice, both backed up), source kept untouched.
- Switching the active provider preserves each provider's baselines and dirty state.
- Relay unavailable: sync still converges through interval and foreground reconciles.

UI (per the repository AGENTS.md): settings panel at 320, 375 and 1280 px, 44 px targets, long paths, keyboard and safe areas; author gutter on all three providers; installed PWA on iOS Safari resume. Report device checks that could not be run.

## 9. Out of scope

Shared cursors, edit history, CRDT line identities, a remote manifest, provider-native push notifications (Graph subscriptions, Drive `changes.watch`, Dropbox webhooks), OneDrive in hosted MCP, syncing to several providers at once.

## References

- [Drive API `files.update`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update)
- [Drive revision retention and downloads](https://developers.google.com/workspace/drive/api/guides/manage-revisions)
- [Drive inventory completeness](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
- [Workers subrequest limits](https://developers.cloudflare.com/workers/platform/limits/#subrequests)
- [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Dropbox forum: longpoll host and CORS](https://www.dropboxforum.com/discussions/101000014/list-folderlongpoll-not-working-with-cors/658737)
