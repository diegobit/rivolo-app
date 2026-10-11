# UI test consolidation

Follow-up to PR #47 at `3a7f1a6`. This batch keeps production unchanged and
consolidates overlapping UI proof. The existing CI runs Vitest, lint, the built
app in Chromium desktop/WebKit mobile, and the MCP runtime smoke.

## Candidates recorded before retirement

| Exact declaration/location | Actual failure; production caller/history | Remaining keeper and deletion unlocked | Risk / focused command |
| --- | --- | --- | --- |
| `offers a Lines toggle in the phone composer, next to the filters`; `hides the Lines toggle in the desktop card but keeps the filters`; `switches between whole days and matching lines from the Lines toggle`, `src/routes/timeline/SearchModePills.test.tsx` | Wrong layout visibility or mode callback. `Timeline` renders the chips; desktop cards originated in `7837046`, current composer chips in `bfa3b06`. | Extend J1 in `tests/e2e/local-journeys.spec.ts` with initial state, TODO visibility and both directions. Retire three declarations, retaining the independent prevented-mousedown contract. | A one-way toggle does not prove returning to whole days. `npm run test:e2e -- --grep J1`; focused Vitest chip/Timeline suites. |
| `persists an individual title font choice`, `src/store/useSettingsStore.test.ts`; `offers individual title and body font pickers in advanced mode`, `src/components/settings/AppearanceSection.test.tsx` | Wrong font callback or title setting write/state. `Settings` invokes the store actions; appearance controls originated in `7837046`. | J4 selects real title/body fonts and reloads the real database. Add initial picker defaults and computed title font. Retire two mocked happy-path declarations. | Keep preset key compatibility, both body-font mappings, defaults, migrations and failures. `npm run test:e2e -- --grep J4`; focused appearance/settings-store Vitest. |
| `previews the selected background at the font sample height on mobile`, `src/components/settings/AppearanceSection.test.tsx` | Only catches utility-class/sample-copy changes; does not measure height. `Settings` renders the preview; `7837046`. | Extend J4 with visible sample versus preview geometry, fixed background and rendered strong opacity; desktop preview hidden. Retire one class-only declaration and remove its duplicate class assertion from the retained advanced-controls test. | Keep basic/advanced controls and the distinct System-theme action. Geometry must fail when the preview becomes a fixed incorrect height. `npm run test:e2e -- --grep J4`. |
| `renders into the tray container`, `src/components/BottomTrayPortal.test.tsx` | Wrong default target or missing portal content. `Timeline` uses default tray and custom header undo target; `7837046`. | Extend `keeps the portal target mounted across mobile mode changes` in `BottomTrayRow.test.tsx` with the real portal, real default target and content surviving all modes. Remove the standalone file/setup. | Preserve target DOM identity, launcher order and custom-target production behavior. `npm test -- src/components/app-shell/BottomTrayRow.test.tsx src/components/BottomTrayPortal.test.tsx`. |
| `returns both setup notices for a new user`; `excludes configured or dismissed notices`, `src/lib/setupAttention.test.ts`; `builds the shared Timeline and Settings attention list in priority order`; `omits inactive runtime attention items`, `src/lib/attention.test.ts`; `renders runtime attention as a non-dismissible Settings banner`; `keeps setup reminders dismissible`, `src/components/settings/AttentionBanner.test.tsx` | Setup filtering, priority/destinations/dismissibility and visible banner callbacks. Helpers serve Settings/AppShell; `676346a` introduced setup attention, `ebb8a5a` unified warnings. | One composed `AttentionBanner.test.tsx` suite uses both real helpers and renders their output. Preserve all six contracts with fewer fixtures/declarations; remove two helper test files. | The composed suite protects helper-to-banner integration. Store failure/dismissal and AppShell attention tests stay. J4 additionally proves real Settings scroll destination and dismissal after reload. Focused banner, AppShell and settings-store Vitest; J4. |
| `centres scroll-to-today above the desktop launcher capsule`; `marks the mobile scroll-to-today control for the phone layout`, `src/components/app-shell/BottomTrayRow.test.tsx` | Only catches class/DOM changes; does not prove alignment or touch size. AppShell decides when to show the button; positioning refined in `61ffe2e`, mobile composition in `bfa3b06`. | Extend J3's actual imported timeline with enough content to scroll; measure desktop capsule centering/clearance, mobile viewport centering/44px and rendered icon size in timeline/search. Retire two declarations only after that proof. | Scroll thresholds and mode transitions must use real page scroll, not mocked rectangles. `npm run test:e2e -- --grep J3`. |

No production seam is introduced or removed. Other tray class assertions and
mobile logo placement remain outside this batch until their exact geometry has
an independent keeper. Each replacement runs before deletion and receives a
deliberate owner mutation; execution receipts follow below.

## Execution receipt

Before retirement, eight focused files passed all 43 cases, including the
original tests and strengthened portal/attention keepers. The strengthened
J1/J3/J4 journeys then passed six executions across both engines. The first J3
attempt incorrectly required `scrollY < 50`; both engines correctly stopped at
56. Inspection confirmed the Today target was in view. The assertion now checks
that target, and the original traces remain under
`/tmp/rivolo-ui-consolidation/first-baseline-results`.

Thirteen compiling owner mutations failed the intended keeper. Each source was
restored byte-for-byte in `finally`, checked by SHA-256, and the final production
diff is empty. Logs remain in `/tmp/rivolo-ui-consolidation/`.

| Mutation / keeper | Observed failure |
| --- | --- |
| Portal default target changed / tray composition | Missing actual draft textbox |
| Attention list reversed / composed banners | Wrong runtime/setup priority |
| AI dismissal ignored / composed banners | Dismissed AI notice unexpectedly included |
| Lines stuck on matched mode / J1 mobile | Expected inactive, received active after second click |
| Lines exposed on desktop / J1 desktop | Expected zero controls, received one |
| Title font persisted as Handlee / J4 mobile | Reload expected Bree, received Handlee |
| Body picker ignores Inconsolata / J4 desktop | Reload expected Inconsolata, received iA Writer |
| Preview forced to 200px / J4 mobile | Expected 156.75px from independent visible sample, received 200px |
| Strong wallpaper uses light opacity / J4 mobile | Expected 0.2, received 0.045 |
| Desktop return button moved left / J3 desktop | Center expected 714.5px, received 598.5px |
| Mobile return button reduced to 32px / J3 mobile | Expected at least 44px, received 32px |
| Reminder persists false / J4 mobile | Dismissed reminder returned after loaded reload |
| Reminder opens AI instead of Sync / J4 mobile | Scroll position expected 606px, received 260px |

The first body-callback mutation failed TypeScript because it left a parameter
unused; it is not counted as test evidence. A compiling mutation then failed J4.
The first two reminder controls escaped weaker draft assertions: absence before
loading and a destination already visible. J4 now waits for the other reminder
after reload and checks the requested section's actual scroll destination,
including CSS scroll margin and native document clamping. The corrected controls
failed; first escaped logs are retained with `-escaped.log` suffixes.

Final gates: 71 Vitest files / 658 passed, zero failed/skipped (7.59s runner
interval); lint and production/PWA build passed. Default E2E: 28 passed in 38.9s,
zero retries, one desktop execution inapplicable to the mobile-menu contract.
The local workerd/D1 runtime smoke passed. `git diff --check` passed.

Compared with `3a7f1a6`: 12 fewer fast cases, three fewer fast test files and
103 fewer test lines. The 15 browser scenarios remain; their existing journeys
have stronger assertions. Production, tooling and shared support have no changes.
Defaults, setting-key compatibility, mappings, migrations, failed dismissal,
focus prevention, launcher order and portal identity remain protected.

Final review compared every removed assertion with its retained owner and read
the mutation failures. The campaign's independent preservation/AQA reviews were
not rerun for this focused follow-up; no new independent review is claimed.
OpenClaw-specific autoreview/check-changed skills remain unavailable here; the
Rivolo gates and explicit controls above are the substitutes.
