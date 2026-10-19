# Agent QA receipt: 2026-10-11

Four fresh children ran sequentially: exploration, independent verification,
confirmed-bug planning, and inconclusive reporting. The skill's repaired relative
references and portable child dispatch worked in this Codex/T3 harness. A session
continuation interrupted the first phase-four invocation before it wrote a
report; a fresh child completed that phase afterward.

## Executed evidence

Run directory: `tests/agentic-qa-tests/runs/20261011-144500/` (ignored local evidence).
It contains `REPORT.md`, `VERIFICATION.md`, `plans/AQA-20261011-001-plan.md`,
`inconclusive-findings/REPORT.md`, executable probes and artifact inventories.
Raw traces/video/screenshots remain local; this receipt is the reviewable summary.

The tester used a frozen production build on synthetic origin
`http://127.0.0.1:4188`, plus a real local HTTP SSE provider at port 4189.
Frozen index SHA256:
`308b4d55ab64480bc73ecd486432c85e752530b5d7f6207b433e43ee3159c467`.
It was copied when source HEAD was `9a4d933`; the tester did not compile it, so
copy-time HEAD is not asserted as its compilation identity. The first exploratory
attempt used a changing build; its mixed-build results were retained and replaced
with the frozen-run receipt, not treated as product evidence.

The tester exercised twelve goals and interruption/storage-fallback variants:
normal save/search, repeated todos, archives, appearance, long Unicode notes,
stale tabs, invalid provider configuration, malformed streamed actions, mobile
menu/draft/focus and Chromium offline operation. The frozen broad run had 18
passes, six failures and two inapplicable executions in 44.857 seconds. Four
failures reproduced note interruption; two required corrected provider setup.
Subsequent targeted attempts and their first failures were preserved. Completed
malformed-output SSE proof passed both engines in 4.454 seconds after replacing
service-worker-bypassed route interception with real local HTTP.

Independent verification ran twice per new/saved-note variant and engine: eight
immediate-reload failures and two passing acknowledged-navigation controls,
zero retries, 19.970 seconds. The tester's broader activity took about nine
minutes including harness diagnosis. Runtime was macOS arm64, Node 26.8.2,
Playwright 1.63.0, Chromium 153.0.8010.12 at 1440×900 and WebKit 26.6 in iPhone 13
emulation at 390×664; native T3 narrow exploration used Chrome 154 at 390×844.
Parent regression gates use the same iPhone 13 emulation; supplemental UI-lane proof and the matching before/after screenshots use 390×844.
Children used Codex gpt-6.1-sol with high reasoning effort. Token/cost usage is
not exposed by this harness; no live model or provider account was used.

## Confirmed follow-up: latest edit lost on immediate reload

Severity: high. A new note can disappear; an existing note reopens its older
baseline. Acknowledged navigation-save survives. The save queue and database
lifecycle source are unchanged from `dev` at `3e1fd28`, so the audit exposed a
pre-existing issue. No assertion was removed to hide it.

Minimal reproduction:

1. Start Today in fresh synthetic storage. For the saved-note variant, write a
   baseline, navigate through Settings, reopen and confirm that exact baseline.
2. Enter `Latest interrupted edit café 🙂` in the real editor.
3. Reload immediately, without waiting for the save debounce.
4. Require the latest exact text. The confirmed result is onboarding or the old
   baseline.

The maintained [browser reproduction](../../tests/known-issues/immediate-reload.spec.ts)
runs with `npm run test:pwa-interruption`. Its assertions deliberately retain the
required outcome and currently exit nonzero on both engines. It is separate from
the green normal-save CI gate and has no skip or expected-failure annotation.
All four maintained cases reproduced the same loss against the integrated build.
Promote these cases into the normal browser gate when repaired.

Implementation remains with Diego's existing local plan,
`docs/plans/20261006-pwa-close-local-flush-plan.md`. The AQA plan adds the independently
verified reload evidence to that owner: keep newest pending text through SQL
completion, issue the local snapshot's IndexedDB transaction before the hide
handler returns, and prevent an older in-flight save from overwriting it. This
receipt does not claim that repair or physical process-kill durability.

## Unresolved and unexecuted checks

- Interrupted provider selection is inconclusive: the initial navigation occurred
  before activation/persistence acknowledgment. Establish that acknowledgment's
  contract and reproduce independently before declaring another bug.
- Installed Mac/iOS PWA closure, abrupt process termination, real software keyboard,
  mobile background scrolling and live model answer quality were not exercised.
- Browser J5 proves native stale-tab isolation and recovery, not lease ownership or
  duplicate cloud-sync exclusion. Retained deterministic lease/scheduling tests
  remain their primary owners.
- J3 replacement/backup and J8 OAuth browser proof were added after the frozen
  exploratory run. Their final production-build regression receipts belong to the
  integration run, not this child's exploration.
