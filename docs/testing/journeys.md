# QA journey contracts

Use a fresh browser context and synthetic local data for each independent mission.
The built app must use real CodeMirror, SQLite WASM, IndexedDB, stores, parser and
save queue. Route external provider/model HTTP only. Two-tab scenarios deliberately
share one context; unrelated scenarios do not. No production reset flags/globals.

| ID / fixture | User mission and starting state | Independent success oracle | Prohibited changes / failure paths | Environment |
| --- | --- | --- | --- | --- |
| J1 / `daily-unicode` | Clean app; create today's note, edit twice, navigate, reload | Latest exact text and todo state reopen from durable storage; search returns that note | No truncation or overwritten prior text; test immediate reload before debounce separately | Chromium desktop, narrow WebKit |
| J2 / `search-occurrences` | Import two notes with repeated and cancelled todos, Unicode tags and literal `%` | Tag/open-todo filters find the intended occurrences; toggle one result, reopen, inspect both notes | Other occurrences unchanged; cancelled todo remains cancelled; desktop has no result-mode control, mobile supports Days/Lines | Both |
| J3 / `archive-recovery` | Existing local note; import/export valid archive, attempt invalid replacement, perform valid replacement then restore | Downloaded archive contains exact dated blocks; rejected replacement preserves notes; actual backup restores old text after reload | No silent destructive import, skipped backup, or capped export; >10k volume belongs to storage integration | Both; provider HTTP fixture for replacement |
| J4 / `settings-readiness` | Clean setup; change theme/fonts/provider through settings; dismiss setup notice | Settings reopen with saved selections; font/sample geometry fits viewport; configured provider can send | Save/sync errors cannot be dismissed as setup notices; no secret exposed | Both |
| J5 / `shared-tabs` | A/B share origin/storage; A edits and saves | B shows stale/read-only state; after reload it has exact A text; closing A lets B claim lease | No write/sync on stale B; no duplicate owner | Both; BroadcastChannel and storage fallback separately |
| J6 / `chat-safe-write` | Seeded source note; configured deterministic external SSE | Stream renders, citation opens exact source, approved insertion persists once | Literal examples and rejected/aborted responses do not write; do not claim success after error | Both; model answer quality is a separate live eval |
| J7 / `mobile-overlay` | Scrolled timeline, unsent draft, mobile keyboard | Menu/chat close preserves draft and scroll; focus returns; controls fit and have effective 44px targets | No background scroll or clipped composer; distinguish browser keyboard emulation from physical iOS | Narrow WebKit; desktop reflow where relevant |
| J8 / `agent-fixture` | Test-owned provider account and current migrated local D1; real Pages/Worker entry points | UI enable/create/revoke; browser allow/deny callback has original state; SDK initialize/list/read/write changes only fixture note | Wrong PKCE, replay, absent bearer, revoked session/token and read-only write calls denied; no cross-profile access | Both browsers + SDK HTTP + local Wrangler runtime |

## Evidence receipt

For each exercised mission record:

- ID, status (`passed`, `failed`, `inconclusive`, `inapplicable`, `untested`), exact command or browser steps.
- Commit/build and uncommitted diff identity, timestamp, seed/fixture IDs, synthetic origin/storage, runtime and harness/model.
- Browser/version, viewport/touch/keyboard assumptions; fresh context or shared tabs.
- Expected outcome declared before execution; actual UI, HTTP result and independently inspected persisted data.
- Screenshot/trace/log paths for failures, minimized reproduction, second attempt without retries concealing the first.
- Wall time and available token/cost usage; say unavailable when the harness does not expose it.
- Created artifact paths and retention decision; verification verdict from a fresh child.

One successful mission does not mark an entire scenario family covered. Record
unexecuted paths explicitly. Failed locators require inspection and corrected
locators, not weakened assertions. Exploratory agents cannot waive deterministic
security/storage gates. Physical installed iOS/Mac PWA behavior and live LLM
grounding/cost checks remain separately reported until actually exercised.
