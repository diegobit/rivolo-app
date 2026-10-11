# Built-app browser proof

The Playwright runner serves the production build. Notes use the shipped SQLite
WASM and actual IndexedDB; the editor, save queue, stores and parser are real.
Each independent test receives fresh browser storage. Chromium desktop and narrow
touch WebKit exercise distinct input/layout risks. Traces, videos and screenshots
are retained on first failure; retries are disabled. CI uploads the report and
failure artifacts. Tests are excluded from Vitest discovery.

## Diagnosed first attempts

- Wrong archive marker and missing `- ` todo prefixes were fixture errors; the
  real importer/search rejected them. Correct fixtures use the public archive
  syntax, not a mocked successful receipt.
- Reload before the 400ms settings persistence debounce lost selections. Normal
  durability checks now observe the actual persisted-revision signal before
  reload. Immediate-close durability is separately diagnosed in agent QA and
  the existing PWA-close plan; it is not claimed fixed by normal-save success.
- CodeMirror virtualizes long documents; absence from its mounted DOM is not an
  independent archive oracle. Export/download inspects exact full dated blocks.
- A full `page.goto` immediately after a todo click unloads the app. Normal
  navigation uses the UI Settings link and real route-unmount flush before
  reload. The intended repeated occurrence must change; cancelled and other
  notes must remain byte-for-byte present in the exported archive.
- The latest `dev` composer changed Menu's accessible name and replaced the
  Days/Lines group with a Lines button. Locators follow that public control;
  desktop absence must forbid the actual Lines button, not the removed group.
- Native OS sharing is outside the browser driver. The export test chooses the
  supported download capability; archive generation and serialization remain
  production code.
- WebKit `setOffline(true)` rejects even service-worker navigation with an
  internal engine error. This matches [Playwright issue 42775](https://github.com/microsoft/playwright/issues/42775).
  The offline spec is Chromium-only; WebKit/iOS offline and installed-PWA
  process-close behavior remain inconclusive/untested, not passed.

## Confirmed mobile owner defects

After merging `dev` at `3e1fd28`, J7 measured the new composer Menu at 40px and
failed its 44px touch-target outcome. The shared phone Menu/Timeline chips,
Send/Clear controls and phone filter chips now use 44px minimum dimensions.
Desktop launcher sizing is unchanged. Before/after images accompany the PR.

The inline Menu chip preserves focus in the draft when opening. Dismissal still
tried to focus the covered shell launcher. The same WebKit scenario failed
`toBeFocused` on the original draft before the fix. The menu now captures and
restores the actual prior focused element, preserving keyboard/editor input.
Its existing direct-launcher focus and Escape/scroll-lock component contracts
remain in place. The passing candidate is recorded after combined validation.

## Scope

Fast syntax, migration, cancellation, save-failure, race and security regressions
remain where their independent contracts are cheaper and clearer. Browser
success does not authorize blanket removal of those tests or unproved CSS
assertions. Agent exploration uses the separate journey/evidence manifest;
it is not the sole merge gate. Final counts, mutation controls, review results
and named follow-ups are recorded in the integration receipt.
