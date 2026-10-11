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
[74-file historical inventory](inventory.md).

## Validation actually run

Final macOS arm64 execution: Node 26.8.2, Playwright 1.63.0; Chromium desktop
1440×900 and WebKit iPhone 13 emulation 390×664. CI installs Node 24 and both
browser engines on Ubuntu; its result is separate from this local receipt.

| Command | Result |
| --- | --- |
| `npm test -- --reporter=json --outputFile=/tmp/rivolo-final-tests.json` | 74 files, 670 passed, zero failed/skipped; 6.72s runner interval |
| `npm run lint` | Passed |
| `npm run build` | Passed: app/Pages TypeScript, Vite and generated PWA worker; existing bundle-size warning remains |
| `npm run test:e2e:built` | 28 passed in 28.2s, zero retries; one desktop execution explicitly inapplicable to the narrow-menu contract |
| `E2E_PORT=4195 npm run test:e2e:built -- --grep 'missing profile\|offline'` | Three passed in 4.8s; alternate HTTPS, callback and offline ports work |
| `npm run test:mcp-runtime` | Passed: actual local workerd/D1 migrations, metadata, initialize/list, auth, GET 405 and revocation across re-enable |
| Skill frontmatter validator and relative-reference checks | Passed; all four AQA phases invoked successfully |
| `git diff --check` | Passed |
| `npx playwright test --config playwright.interruptions.config.ts` | Four intended-outcome failures, reproducing the named pre-existing interruption defect; not included as a green result |

The browser runner uses actual Pages handlers and migrated SQL for Agent Access,
HTTPS cookies and real consent form navigation. It simulates only external
provider HTTP. A separate secure loopback HTTP listener serves the same build
for the generated service worker and real SSE fixture, avoiding untrusted TLS
and mixed-content harness failures. No production security policy is relaxed.
First failures and corrected fixture/locator diagnoses remain in the lane and
QA receipts; retries do not conceal them.

## Independent preservation review

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
| Test files | 14,911 | 15,080 | 13,699 | −1,381 |
| Shared test support | 6 | 6 | 325 | +319 |
| Tests and support combined | 14,917 | 15,086 | 14,024 | −1,062 |

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
replace lease/duplicate-sync contracts. Remaining CSS/setter/attention candidates
stay until their exact replacements exist. This PR establishes the automated
owners and QA workflow, not complete release/device/live coverage.
