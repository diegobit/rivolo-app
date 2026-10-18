# Storage and sync test ownership

This change replaces invented database behavior with production SQLite/WASM, repository SQL, archive parsing, provider state, and `idb-keyval` transactions. Only the external cloud HTTP service is simulated. The new tests check stored notes and reopen serialized SQLite bytes from IndexedDB instead of accepting mocked import receipts or index calls.

The work starts from `830e548`. It changes tests and test support only; no production behavior or reset export is introduced. The Node fixture adapts the browser WASM asset URL, supplies window timers, and owns a dedicated `fake-indexeddb` factory. It clears that test database between cases. Reloading production modules reconstructs the application database from the committed bytes without a production reset hook. Real browsers and physical installed-PWA lifecycle checks remain separate proof.

## Authoring gate and primary owners

Each new case protects an observable invariant with independent expected data. Existing mocked suites could not establish SQL execution, successful serialization, transaction completion, or provider/importer composition. Existing pure parsing, migration, scheduling, error-notification, and revision tests remain where they protect distinct risks.

| Owner | Behavior and credible regression | Independent oracle and boundary |
| --- | --- | --- |
| `dayRepository.test.ts` | Invalid writes, stale FTS rows, Unicode/literal omissions, filtered paging, lost concurrent appends, poisoned append queues, whole-database blocking | Actual repository methods; exact note IDs/content/blocks; real SQL trigger rejection; exported SQLite reopened through IndexedDB. |
| `importExport.test.ts` | Destructive empty/duplicate imports, missing recovery data, backup after destructive mutation, dropped archive rows, corrupt/legacy backups | Original note content and exact rejected reasons; a real SQL rejection after backup; actual IndexedDB put failure; compressed bytes read back; a 10,001-row SQLite archive with oldest sentinel. |
| `dbPersistence.test.ts` | Save debounce writes too early or never, flush fails to commit, bulk mutations serialize an intermediate snapshot | Read `single-note-db` through the real IDB transaction and deserialize independently with official SQLite. No flush is performed by the assertion helper. |
| `syncProviders.test.ts` | Dirty pull overwrites, impossible successful import, wrong provider bearer/refresh, remote-change overwrite, lost edit during upload, repeated identical upload | Parameterized Dropbox/Drive production adapters and routed method/URL/header/body validation; real notes/settings/backups; second upload carries the later edit; persisted state reopened. |
| `googleDrive.test.ts` | Invalid first multipart upload, failed root-file migration, redundant folder discovery, false conflict or missing revision backup | Routed Drive protocol; preserved content, folders, request budget, and actual recoverable backup in IDB. |

No expected search results are computed by `searchDaysInMemory`. Cloud response order does not choose the endpoint: the fixture matches method and URL and rejects unknown requests. The provider-specific token endpoint and bearer value are checked, so the same network substitute cannot silently make a wrong auth wrapper succeed. Backup failure is injected at the public IndexedDB object-store operation; the importer and repository remain real.

## Completed candidate evidence

Baseline locations below refer to `830e548`, so deleted declarations remain identifiable. Each candidate lists the failure it detected, production callers, replacement, history, deletion, risk, and focused validation.

### C1: factory invocation count

- Exact test: `src/lib/syncAuth.test.ts:84`, “Dropbox and Google Drive authorizedFetch both attach the 401-retry behavior from createAuthorizedFetch.”
- Detectable failure: number of factory calls at import time; neither exported provider fetch was exercised.
- Production callers: `dropboxAuth.ts` and `googleDriveAuth.ts` construct the wrappers; `dropbox.ts` and `googleDrive.ts` consume them.
- Keeper: `syncProviders.test.ts`, “delivers the provider-specific bearer token and refreshes once after a real 401”, for each provider. Helper Response/Headers contracts remain in `syncAuth.test.ts`.
- History: `b17e9b8` extracted identical wrappers and introduced the reuse assertion.
- Deletion: factory spy and dynamic import/state mock declaration. Production factory and wrappers remain live.
- Risk: wrong token getter or refresh path; covered by provider-specific token routes, request headers and actual upload.
- Validation: `npm test -- src/lib/syncAuth.test.ts src/lib/syncProviders.test.ts src/lib/googleDrive.test.ts`.

### C2: SQL-ignoring parity

- Exact test: `src/lib/dayRepository.test.ts:513`, “matches the previous in-memory behavior on representative queries and filters.”
- Detectable failure: mapping/paging of supplied rows; the mock ignored WHERE/FTS filtering and expectations called the same matcher as production.
- Production callers: Timeline calls `searchDays`; MCP uses the shared in-memory matcher separately.
- Keepers: real persisted literal/Unicode query table, exact filtered-block table, and full-batch false-positive paging case in `dayRepository.test.ts`.
- History: `e20aaff` bounded scans; `0f025fe` FTS5; `b5cf8a7` Unicode fallback.
- Deletion: SQL-ignoring parity, exact SQL query assertions and mocked query fixture. Production search and matcher stay.
- Risk: omitted search hits; independently specified IDs/blocks now pass through real query execution.
- Validation: `npm test -- src/lib/dayRepository.test.ts src/lib/sqliteRuntime.test.ts src/lib/notesCore.test.ts`.

### C3: index calls and exact all-row SQL

- Exact tests: `dayRepository.test.ts:381`, “updates the index when a day is saved”; `:391`, “rebuilds index rows when all days are replaced”; `:66`, “queries all rows in descending order without a LIMIT clause.”
- Detectable failures: missing `upsertFts` calls, a DELETE string, or changed exact SQL; no successful stored/searchable rows or untruncated archive was established.
- Production callers: day-store writes, import replacement, Timeline search, export/safety/backup using `listAllDays`.
- Keepers: save/edit/move/delete/replacement search sequence including reopen; SQL-trigger replacement failure with original notes/index restored; real 10,001-row export and oldest-sentinel safety/rollback.
- History: `0f025fe` FTS maintenance; `eaf7365` fixed truncated exports/backups.
- Deletion: fake SQL Map, FTS call assertions, exact-query assertion. `listAllDays` and production SQL remain required.
- Risk: missing/ghost search rows, partial replacement or lost older notes; keepers assert actual results and recovery.
- Validation: `npm test -- src/lib/dayRepository.test.ts src/lib/importExport.test.ts src/lib/sqliteRuntime.test.ts`.

### C4: unreachable empty-database fixture

- Exact test: `importExport.test.ts:117`, “blocks invalid-date-only replacement when database is empty.”
- Detectable failure: same early no-valid-days guard covered by the old confirmation-state table; empty DB fixture was never read.
- Production callers: Settings import, backup restore, both provider pulls.
- Keeper: “never replaces notes with invalid-date-only content, across confirmation states”; all confirmation states reject and stored content/backup state are checked, then reopened.
- History: `eaf7365` introduced both declarations during destructive-import repair.
- Deletion: duplicate declaration and mocked empty-DB arrangement, no production seam.
- Risk: accidental destructive empty replacement; keeper proves unchanged durable notes for every confirmation state.
- Validation: `npm test -- src/lib/importExport.test.ts`.

### C5: assumed successful cloud imports

- Exact tests: Dropbox `:72`, “pulls over dirty local notes when forced”; Drive `:132`, “pulls a newer remote file and marks the other provider stale”; Drive `:179`, “pulls over dirty local notes when forced.”
- Detectable failure: dispatch and state updates after mocked import success. Downloaded Markdown lacked required day markers and would fail the actual replacement importer.
- Production callers: sync actions → provider pull → real importer → repository/IDB.
- Keepers: force-pull valid archive/reopen/recoverable rollback, normal newer clean pull/tracked version, dirty-noop, and marker-free forced-pull rejection with unchanged notes/state in `syncProviders.test.ts`.
- History: `f6ef5a8` forced Dropbox replacement, `af03642` Drive pulls, `2318103` import sanity checks.
- Deletion: success-supplying import/export/auth/state mocks and positional cloud-response fixtures. Shared contract declarations move from `dropbox.test.ts` into `syncProviders.test.ts`; Dropbox upload-CAS conflict stays there and Drive-only protocols stay in `googleDrive.test.ts`.
- Risk: falsely reporting successful sync or destroying local notes. Assertions use real stored notes, backups and revisions.
- Validation: `npm test -- src/lib/syncProviders.test.ts src/lib/googleDrive.test.ts src/lib/importExport.test.ts src/lib/syncAuth.test.ts`.

## Preservation mapping

The former repository date-entry matrix now checks actual stored rows and absence of dirty provider state. Append byte preservation, trimming, absent-day creation and mixed newline rules are exercised through overlapping actual appends and reopen. Rejected append recovery uses a real SQLite trigger; independent-day progress pauses the existing public `db.run` operation while allowing its original SQL to run, rather than emulating SQL.

Former importer no-marker, no-valid-days, duplicate, confirmed-last-block, would-delete, combined-error, literal-marker, backup-order, retention, legacy, cross-realm, corrupt-compression, complete-export and oldest-day checks all have actual-storage cases. Corrupt backups are ignored and omitted on the next saved backup. Legacy single backups are migrated before retention pruning. Backup restore is exercised and then reopened.

Common provider dirty/force/no-change/conflict/hash/race behavior has one parameterized owner. Drive first-folder/multipart creation, dirty and clean root migration, cached-folder request budget and normal/concurrent revision distinction remain separate. Lack of revision identifiers is the cached-folder ordinary push case: exactly metadata and upload requests, no revision request or backup. Dropbox upload conflict remains a protocol-specific case. The fast `dropboxState` race suite stays because it isolates queued state mutation; auth helper tests stay because malformed response and retry-limit contracts differ from provider wiring.

## Deliberate mutation controls

Each control ran a focused test while applying one temporary production mutation. Every command finished before another source edit. Original production bytes were restored in `finally` and compared exactly. All six controls failed for the intended contract; the final unmutated focused suite passed.

| Temporary mutation | Keeper that failed |
| --- | --- |
| Bearer header replaced by a wrong-provider token | Provider-specific 401/bearer cases for Dropbox and Drive. |
| Repository FTS query replaced by a never-matching phrase | Independent persisted literal/Unicode search table. |
| `upsertFts` returns before writing the index | Save/edit/move/delete/replacement searchable-row sequence. |
| `listAllDays` capped at 10,000 | Real 10,001-row export count and oldest-sentinel proof. |
| Pre-replacement rollback omitted | Actual replacement-rejection case finds no recoverable original backup. |
| Dropbox push finalization always marks clean | Late edit during upload must remain dirty and appear in the next upload. |

Controls used `npm test -- <owner-file> -t <contract>`; filtering intentionally skips unrelated cases only for those controls. No test was marked skip or weakened to obtain a passing final run.

## Validation and limits

The final focused 15-file storage/sync/retained-sibling suite passed 142 tests. Targeted ESLint and `git diff --check` passed. The full-suite/build result after combining lanes is recorded by the parent integration handoff.

No production line change, provider credentials, user database, live cloud account, network upload, or lifecycle product fix is part of this lane. Browser/CI ownership and physical iOS/Mac PWA proof belong to the parent integration work. fake-indexeddb establishes the transaction/data contract in Node; it cannot establish Safari connection suspension or process-kill durability. Independent preservation review and combined full-suite/build checks are performed by the parent after integration.

## Independent preservation review

A fresh reviewer compared every removed storage/import/provider declaration and its assertions at `830e548` with `d435e4b`, the retained suites, and production callers. The broad replacement is valid, but the following contracts needed explicit preservation before integration:

- The foreign-view backup fixture was normalized into the current realm by fake-indexeddb. An independent probe found `source instanceof Uint8Array === false`, but the retrieved bytes were `true`. Keep the real-IDB compressed/corrupt case and a separate public `get` boundary case whose foreign-view precondition is asserted before production backup parsing. The small mock protects the historical cross-realm guard; it does not claim browser persistence proof.
- The replacement append fixture had no existing trailing whitespace, so it did not protect the old line-append trimming rule. A persisted trailing-space/newline fixture now overlaps a line append with a paragraph append and checks both returned snapshots and reopened bytes. Existing concurrent-creation coverage now also asserts each public return value and trims the first addition. `useDaysStore.addTodo` consumes the returned day; Timeline also calls paragraph append.
- All long ASCII query cases used FTS. An explicit unavailable-FTS capability case now executes the real fallback SQL with literal punctuation, a phrase split across lines, and a full page of rejected filter candidates. Exact SQL text is still not an oracle.
- The removed `listAllDays` row-mapping assertion included independent titles and timestamps. Actual stored rows with distinct created/updated values now protect the public mapping and descending order.
- Successful importer receipts, duplicate warnings, dirty no-op provider state, rejected-import tracked revisions, and the initial Drive upload revision are now asserted alongside actual stored outcomes. Invalid repository writes also preserve both providers' dirty state.

No additional material gap was found in the removed cloud protocol declarations: shared dirty/force/no-change/hash/race/conflict behavior has the parameterized real-owner keeper, and Drive-only folder, request-budget, and revision-backup cases remain separate. Importer no-marker/no-valid-days, duplicate/omitted-day errors, explicit replacement, backup order/failure/retention/migration/corruption, literal markers, and whole-archive safety each retain an independent stored-outcome oracle. Factory-call, exact SQL, and FTS-call details remain intentionally retired.

The preservation changes passed 82 tests across the six changed/related owner suites. Targeted ESLint and `git diff --check` passed. Ten temporary controls each failed with an assertion at the intended owner: foreign-view `instanceof` guard; omitted line trimming; discarded append return values; wrong updated timestamp mapping; unusable fallback parameters; zero successful import count; missing duplicate warning; cleaning dirty no-op state; and advancing Dropbox/Drive tracked revisions before a rejected import. Each process completed before another source edit, and all production bytes were restored and compared exactly afterward. A final unmutated run passed. These controls verify the restored protections, rather than treating increased test count as evidence.
