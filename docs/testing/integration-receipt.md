# Test suite integration receipt

The audit replaces success-supplying database/import/auth mocks with real storage
and protocol owners, adds a small production-build browser suite, and makes
agent exploration independently verifiable. It retains inexpensive syntax,
migration, security, cancellation, race and failure contracts. The suite's value
improves without a deletion quota or a unit/E2E ratio target.

Implementation: `test/real-boundaries` in `/Users/diego/code/dg/rivolo-test-suite`.
Initial audited baseline: `830e548`; merged and refreshed `origin/dev`: `3e1fd28`.
The feature is proposed against `dev`; neither `dev` nor `main` is merged by this
work. Plan directions with no equivalent proof remain retained follow-ups.

## What changed and what remains

| Owner | Retired or repaired layer | Primary proof |
| --- | --- | --- |
| Local storage/search/import/sync | SQL-ignoring parity, exact SQL/index calls, assumed import success, factory-count provider proof | Shipped SQLite WASM, actual IndexedDB, complete archive exports, rejected replacements, rollback/restore, external HTTP provider fixtures |
| MCP repositories and transport | SQL-aware Map fakes, copied migration schema, overridden authenticator, timezone getter used only by a test | Every current migration in SQLite, real credentials and Worker.fetch, SDK HTTP initialize/list/read/write, workerd/local D1 smoke |
| Editor/search | Duplicate parser matrix/route alias, test-only helper exports, obsolete forbidden-control selector | Canonical Markdown matrix, actual EditorView decorations/events/updates, current desktop Lines absence |
| Thin Agent Access clients | Six success request/response copies | Actual browser callback, encrypted session cookies, token lifecycle and CSRF; Google enable and both error-message tests stay |
| Browser layout/streaming | One impossible jsdom end-scroll assignment | Native clamped following/read/unseen/reflow, actual citation destination, full post-reload archive with exactly one insertion |
| Agent QA | Broken references and harness-specific dispatch | Four fresh sequential children with executable observations, independent verification, confirmed-bug plan and inconclusive report |

Detailed candidate/history/caller/keeper/risk records and controls:
[storage](storage-audit.md), [MCP](mcp-audit.md), [editor/UI](ui-audit.md),
[browser](browser-audit.md), [Agent Access](mcp-browser-audit.md), and the
[74-file historical inventory](inventory.md). A subsequent
[UI consolidation](ui-consolidation.md) retires another 12 fast cases and three
files, folds the real portal into tray composition, and extends existing browser
journeys for toggles, fonts, reminder persistence/destination and actual geometry.
It changes no production code.

## Validation actually run

Final macOS arm64 execution: Node 26.8.2, Playwright 1.63.0; Chromium desktop
1440×900 and WebKit iPhone 13 emulation 390×664. CI installs Node 24 and both
browser engines on Ubuntu; its result is separate from this local receipt.

| Command | Result |
| --- | --- |
| `npm test -- --reporter=json --outputFile=/tmp/rivolo-ui-consolidation/final-tests.json` | 71 files, 658 passed, zero failed/skipped; 7.59s runner interval |
| `npm run lint` | Passed |
| `npm run build` | Passed: app/Pages TypeScript, Vite and generated PWA worker; existing bundle-size warning remains |
| `npm run test:e2e:built` | 28 passed in 38.9s, zero retries; one desktop execution explicitly inapplicable to the narrow-menu contract |
| `E2E_PORT=4195 npm run test:e2e:built -- --grep 'missing profile\|offline'` | Three passed in 4.8s; alternate HTTPS, callback and offline ports work |
| `npm run test:mcp-runtime` | Passed: actual local workerd/D1 migrations, metadata, initialize/list, auth, GET 405 and revocation across re-enable |
| Skill frontmatter validator and relative-reference checks | Passed; all four AQA phases invoked successfully |
| `git diff --check` | Passed |
| `npx playwright test --config playwright.interruptions.config.ts` | Four intended-outcome failures, reproducing the named pre-existing interruption defect; not included as a green result |

Fast tests, lint, build, default E2E and runtime smoke were rerun after the UI
consolidation. Alternate-port, skill-validator and known-issue results are from
the preceding campaign and were not rerun for this follow-up.

The browser runner uses actual Pages handlers and migrated SQL for Agent Access,
HTTPS cookies and real consent form navigation. It simulates only external
provider HTTP. A separate secure loopback HTTP listener serves the same build
for the generated service worker and real SSE fixture, avoiding untrusted TLS
and mixed-content harness failures. No production security policy is relaxed.
First failures and corrected fixture/locator diagnoses remain in the lane and
QA receipts; retries do not conceal them.

## Campaign preservation review

The independent reviews below cover the campaign before the focused UI
consolidation. That follow-up has a separate assertion-preservation review and
13 owner controls in its receipt; no new independent AQA run is claimed.

Storage review restored ten missing assertions/variants: cross-realm storage,
trimming and append receipts, metadata, fallback query execution, import receipts,
and provider state after refused/no-op imports. Ten deliberate owner mutations
failed the intended keepers; source was restored byte-for-byte before baseline
runs. Six additional storage-lane controls also caught their owner changes.

MCP review found no reachable lost security contract after 99 focused passes.
The old narrowed-PAT mock represented a state rejected by the migration CHECK;
it was not restored by bypassing that constraint. Narrow OAuth scopes still
have real denial proof. Six MCP controls, consent form-policy and client-CSRF
controls caught real failures. Protocol/cookie/migration contracts remain.

Independent UI/integration review and the final read-only release review found no blocking regression or lost contract. The release reviewer independently read the final test/browser and four known-issue failure receipts.
It prompted exact post-reload insertion counting and full J3 replacement/backup
UI coverage; both were added and passed. Rendered Unicode/events and current
Lines controls have caught mutations. The browser controls catch wrong citation
targets, executable fenced examples, inverted resize anchoring and ignored native
storage announcements. Reverting only citation scheduling survived two later
repetitions: the initial offscreen failure and its timing-sensitive repair are
reported without claiming deterministic race calibration.

The audit skill's OpenClaw-specific testing/crabbox/check-changed/autoreview/PR
skills and scripts are not installed here. Rivolo commands, actual local runtime
checks and independent preservation reviews are the explicit substitutes; this
receipt does not claim those unavailable tools ran.

## Line counts

Counts include tracked text plus the final new files; generated/ignored artifacts,
images, docs and skill prose are excluded. Test files include `.test.*` and
`.spec.*`; support is `src/test/helpers`, browser helpers and setup. Inline old
fake databases count as test-file lines, which explains much of their reduction.

| Category | Initial `830e548` | Merged `dev` `3e1fd28` | Final | Change vs merged dev |
| --- | ---: | ---: | ---: | ---: |
| Production TS/source | 26,072 | 26,265 | 26,282 | +17 |
| Tooling/config/package text | 13,800 | 13,800 | 14,109 | +309 |
| Test files | 14,911 | 15,080 | 13,596 | −1,484 |
| Shared test support | 6 | 6 | 325 | +319 |
| Tests and support combined | 14,917 | 15,086 | 13,921 | −1,165 |

Production adds the narrowly demonstrated consent/mobile fixes and citation
ordering, while removing unused getter support, private helper exports and the
route shim. New support executes real owners rather than supplying their SQL or
successful import behavior. More expanded cases now protect real outcomes;
raw case count is not the optimization target.

## Follow-ups and limits

[Fresh agent QA](agent-qa-run.md) independently confirmed immediate-reload loss
of the latest edit: eight failures, two passing normal-save controls. The
maintained known-issue probe keeps its intended assertion and exits nonzero.
Repair belongs to the existing PWA-close plan before lifecycle durability can be
claimed. Interrupted provider selection remains inconclusive.

Physical installed Mac/iOS PWA closure, process termination, software keyboard,
background scroll, deployed bindings, live provider consent and live model
quality remain untested here. WebKit offline emulation is inconclusive; Chromium
exercises the generated worker offline. J5's native stale-tab proof does not
replace lease/duplicate-sync contracts. Remaining CSS and setter candidates
stay until their exact replacements exist; the retired UI batch is recorded
separately. This PR establishes the automated
owners and QA workflow, not complete release/device/live coverage.

## Batch A persistence sync follow-up — 2026-10-18

This follow-up refreshes the existing audit PR onto `dev` at `5f1ed2e8` with
merge commit `1c4699d05a2d57e810af5316d28c56ca33f6c60b` and adds exact-value
save gates. The source change is commit
`533d1e02e8b0cb5fb84f27dff08e29ed47f1751f`; this receipt records the exact
tested source. The PR remains open against `dev`:
[PR #47](https://github.com/diegobit/rivolo-app/pull/47). The isolated checkout
is `/Users/diego/.t3/worktrees/rivolo-app/t3-418a42a4`, branch
`test/real-boundaries-persisted-content`.

The source commit changes `tests/e2e/helpers/persisted.ts`,
`tests/e2e/concurrency-chat.spec.ts`, `tests/e2e/local-journeys.spec.ts`,
`tests/e2e/agent-access.spec.ts`, and `scripts/test-mcp-runtime.mjs`. No app
production owner changed.

`tests/e2e/helpers/persisted.ts` reads the native IndexedDB
`keyval-store`/`keyval` value `single-note-db`, copies its bytes to a temporary
SQLite file, and reads synthetic day/settings values with Python 3's standard
`sqlite3` module. It reads only an allowlist of setting keys; provider secrets
are not selected or attached. Python 3 and stdlib SQLite are runtime
requirements. No production code, mocks, sleeps, retries, or timeout changes
were added.

J4 waits for the intended wallpaper, theme, fonts, and sync-reminder dismissal
to be present in SQLite before reload; font, preview, and geometry checks stay
in place. J5 waits for both the empty baseline and edited note to be durable,
then keeps real BroadcastChannel and storage-event delivery, stale-tab input
protection, public Reload, and exact reopened text. J6 waits for the complete
provider/model/base URL before navigating to chat and for the exact inserted
day text before final reload; streaming, scroll, citation, safe-insertion, and
archive assertions stay in place. The J1/J2 mobile locators and J8 OAuth
continuation assertions were also updated for the refreshed `dev` UI. The
MCP runtime smoke now authenticates its synthetic GET request before checking
the existing 405 method contract.

### Verification on this continuation

| Command/environment | Result |
| --- | --- |
| `npm test` | 76 files, 700 tests passed |
| `npm run lint` | Passed |
| `npm run build` | Passed; real SQLite WASM and generated service worker; existing large-chunk warning remains |
| `npm run test:mcp-runtime` | Passed after the synthetic authenticated-GET probe correction |

Browser commands and results:

- `npm run test:e2e:built -- --grep 'J1: edit|J2: search toggles|J8: missing profile|J8: tampered profile'`: 8 passed on macOS arm64 across Chromium and WebKit.
- `npm run test:e2e:built -- --grep 'J4:|J5:|J6:'` on macOS arm64: 7 passed, 1 failed; all J4/J5 cases and WebKit J6 passed. Chromium J6 failed the resize-anchor assertion.
- `npm run test:e2e:built -- --output=.playwright-mcp/20261018-batch-a/mac-full-results`: latest full macOS arm64 run was 27 passed, 1 failed, 1 skipped. Chromium J6 still fails the resize-anchor assertion (`remainingScroll` 1050, expected under 2); the same failure reproduced with the original pre-edit J6 spec. An earlier full run also lost the J7 WebKit draft once; J7 passed on the later run.
- `npm run test:pwa-interruption`: all four intended immediate-reload assertions fail. The runner remains enabled and unannotated; product loss is still open.
- In the official Playwright 1.63.0 Noble image on local Linux arm64, `npm run test:e2e:built -- --grep 'J4:|J5:|J6:' --repeat-each=2` produced 14 passes and 2 failures. Both Chromium J6 repeats hit the same resize-anchor failure; all eight WebKit J4/J5/J6 executions passed. J4 and both J5 transports passed in both engines.
- In the same local Linux arm64 image, `npm run test:e2e:built` (4 workers) produced 27 passes, 1 failure, and 1 skip. The failure was J1 WebKit: its page closed while clicking the visible Start Today button. This local arm64 run is separate from hosted x64 CI.

Linux browser logs and retained failure artifacts are under
`.playwright-mcp/20261018-batch-a/` (`linux-j456.log`, `linux-full-e2e.log`,
and their result directories). The latest preserved macOS full-suite output is
`mac-full-e2e.log` with the J6 screenshot, trace, and error context under
`mac-full-results/`. The earlier current-head/original-spec J6 comparison is
under `.playwright-mcp/20261018-batch-a/failures/`.

At the last inspection before this receipt-only commit, GitHub Actions and
Cloudflare checks for PR head `bb38b6c` were running. This receipt commit will
trigger a new hosted run; no hosted CI pass is claimed. The earlier line-count
table above records the preceding UI consolidation and has not been
recalculated for this follow-up. The real note/settings interruption defects,
Batch B, and Batch C remain open. Installed-PWA/iOS behavior and live provider
acceptance remain untested.

## Persistence gate correction round 2 — 2026-10-18

This correction starts from PR #47 head `6b17f20` and changes only tests. No
production persistence or UI owner changed. The PR remains open against `dev`;
Batch B on AIT remains deferred and the Diego backport remains dependent on that
repair.

### Hosted failure at the previous PR head

GitHub Actions run
[`39140669719`](https://github.com/diegobit/rivolo-app/actions/runs/39140669719/job/117714266507)
failed in `npm test` before build, browser, or Worker steps. Vitest reported 699
passed and 1 failed out of 700 tests. The failing 10,001-row export/import test
ran for 5,125 ms against its default 5,000 ms limit. Its real SQLite/WASM and
IndexedDB assertions did not fail; the test exceeded the runner limit during
the four-worker CI run. The isolated test took about 1 second on this Mac.

The same job logged 172 missing-WASM errors from the desktop and mobile
Timeline chat UI fixtures: 112 from `Timeline.desktopChat.test.tsx` and 60 from
`Timeline.mobileChat.test.tsx`. Those UI tests mock their stores and repository
but their unmount cleanup still called the real database flush. The log does
not establish that these messages caused the timeout. The fixtures now stub
only that incidental flush call. The import/export, database, and persistence
owner tests continue to use real SQLite/WASM and IndexedDB.

### Correction and local proof

The large fixture now seeds its 10,001 rows with one recursive CTE rather than
10,001 JavaScript-to-WASM insert calls. It still exports and parses all rows,
checks the oldest day in the unsafe-replacement result, writes and reloads the
full rollback from IndexedDB, verifies its `dayCount` and exact oldest-day
block, then reopens the database and checks the replacement. The backup check
uses the exact stored block rather than parsing the same 10,001-row document a
second time.

Local checks on macOS arm64, Playwright 1.63.0:

| Command | Result |
| --- | --- |
| `node scripts/run-vitest.mjs run src/lib/importExport.test.ts -t 'exports over 10000' --reporter=verbose` | Passed; 734 ms for the test, 1 test selected |
| `npx -y node@24 scripts/run-vitest.mjs run src/lib/importExport.test.ts src/routes/Timeline.desktopChat.test.tsx src/routes/Timeline.mobileChat.test.tsx --reporter=dot` | Passed; 3 files, 56 tests. No missing-WASM errors. |
| `npx -y node@24 scripts/run-vitest.mjs run` | Passed; 76 files, 700 tests |
| `npm test` (Node 26.8.2) | Passed; 76 files, 700 tests |
| `npm run lint` | Passed |
| `npm run build` | Passed; existing large-chunk warning remains |
| `npm run test:mcp-runtime` | Passed; local Worker migrations, metadata, initialize/list, auth, GET 405, and revocation |

The built browser suite ran 29 cases on macOS arm64: 27 passed, 1 failed, and 1
desktop-only mobile-menu case was skipped as inapplicable. J4 and both J5
transports passed in both engines, as did WebKit J6. Chromium J6 again failed
the unchanged resize-follow assertion after narrowing the viewport:
`remainingScroll` was `1050`, expected under `2`. The failure is at
`tests/e2e/concurrency-chat.spec.ts:175`; screenshot, video, trace, and error
context are in `test-results/concurrency-chat-J6-actual-98365--safely-persists-one-insert-chromium-desktop/`.
This is a product behavior blocker to ordinary-gate acceptance. The resize
assertion remains intact; no UI repair was authorized in Batch A.

`npm run test:pwa-interruption` still fails all four immediate-reload checks:
new notes reopen without an editor and saved notes reopen with the baseline
instead of the latest edit. This separate product data-loss defect remains
visible and is not treated as an ordinary gate result.

At the time this correction was prepared, no hosted run had yet started for its
new head. The prior hosted run is failed as recorded above; the correction
requires a new run. No hosted x64 pass is claimed. Independent parent review is
still pending, and the J6 resize-follow failure blocks Batch A acceptance.
