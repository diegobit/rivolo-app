# UI test audit: editor and search boundaries

The editor tests now exercise the installed CodeMirror extensions through a real `EditorView`. Unicode tags are checked in the rendered document, and todo mouse tests dispatch events through the public pointer extension. The private implementation helpers no longer need exports for tests. The shared todo parser keeps one table of Markdown preservation cases.

The desktop search test checks the actual result-mode control. At the audited baseline this was the `Show results as` group; after merging current `dev` it is the `Lines` button. Its previous selector looked for a button named `Toggle result mode`, which no longer existed. Exposing the forbidden desktop control passed the old assertion and failed each repaired assertion against its corresponding UI version.

## Deletion and retention record

| Candidate and original location | What the old test detected | Production callers and history | Remaining proof and deletion unlocked | Risk and focused check |
| --- | --- | --- | --- | --- |
| C6: `lists every match and offers no Days/Lines toggle`, `src/routes/Timeline.desktopChat.test.tsx:631` | Appearance of the obsolete button label, not the current toggle | `Timeline` renders `SearchModePills`; desktop omission introduced in `7837046`, controls renamed in `480c065` | Replace the old negative assertion with absence of the actual control: the group at the original baseline, the `Lines` button after upstream `bfa3b06`. The same test still requires both matches. No production behavior or mocks removed | Wrong desktop wiring previously escaped detection. Run `npm test -- src/routes/Timeline.desktopChat.test.tsx src/routes/timeline/SearchModePills.test.tsx` |
| C7: `matches the string-based toggle result for the same input line`, `src/lib/editor/todoExtensions.test.ts:31` | The indented input already present in the adjacent matrix; no string helper was called | `DayEditorCard` installs `todoPointerHandler` and `todoKeymap`; shared marker parsing introduced in `449ff19` | Delete the misleading duplicate. The indented Markdown output remains in `todoMarker.test.ts`; actual decorated, indented marker click is checked in the editor event test | Preserve correct line targeting and Markdown. Run `npm test -- src/lib/editor/todoMarker.test.ts src/lib/editor/todoExtensions.test.ts` |
| C7: direct `toggleTodoAtPos` fixture matrices, `src/lib/editor/todoExtensions.test.ts:9` and `:21` | Parser outputs through a direct internal helper call | `todoPointerHandler` uses the helper internally; no other production module imports it | One canonical parser matrix in `todoMarker.test.ts` keeps all seven valid and five non-todo cases, round trip, cancellation and repeated cycles. A smaller event table covers all three marker positions and both adjacent non-marker positions. A decorated second-line click checks the public DOM target path. Remove only the helper's export, keeping its live implementation | Separate parser semantics from event routing without replaying the whole fixture inventory. Run `npm test -- src/lib/editor/todoMarker.test.ts src/lib/editor/todoExtensions.test.ts src/routes/timeline/syntaxHighlight.todos.test.tsx` |
| C8: direct `findTagHighlightRanges` cases, `src/lib/editorHighlights.test.ts:5`, `:11`, `:20` | Internal range objects for accented, decomposed, non-Latin and mid-word tags | `buildTagDecorations` is the only production caller; `DayEditorCard` installs `editorHighlights`. Regression introduced in `689d591`, “Fix Unicode hashtag highlighting” | Preserve every Unicode input through visible decorations in an actual editor. Add an edit from a word suffix to a separate hashtag, then a mention, to check updates. Remove helper export; keep the private parser and plugin | Decoration registration and updates could break while direct parser tests passed. Run `npm test -- src/lib/editorHighlights.test.ts src/lib/editor/wrapSelection.test.ts` |
| Route shim and its fixture file, `src/routes/timeline/todoToggle.ts` and `todoToggle.test.ts` | The shared parser through an alias; the wrapper had no separate behavior | `Timeline` imported the function alias; `syntaxHighlight` imported its display regex. Extraction `a389357` originally protected Markdown corruption; `449ff19` later unified the parser | Move the complete semantic test file to `src/lib/editor/todoMarker.test.ts`. Import the function directly in `Timeline`; keep the display regex private to its only caller. Delete the three-line route shim | No parser cases dropped. Search write persistence remains a browser/storage concern; deterministic parser and event contracts stay. Run the marker, editor event, syntax control and Timeline desktop tests |

The public event tests use CodeMirror's installed `domEventHandlers`, `EditorView.posAtDOM`, rendered decorations and document updates. Where a test specifies a marker position, `posAtCoords` supplies only the hit-test coordinate because jsdom has no layout. It does not supply the toggle behavior. Browser tests still own actual hit testing, native touch delivery and scrolling.

## Mutation evidence

Each mutation ran in isolation after a passing focused baseline. Source and tests were restored before the next run.

| Temporary mutation | Observed result |
| --- | --- |
| Render the result-mode toggle on desktop, with the obsolete negative assertion | The old test passed despite the forbidden group being visible |
| Render the result-mode toggle on desktop, with the repaired group assertion | The desktop test failed on the visible `Show results as` group |
| Restrict the production tag regex to ASCII letters and digits | All four rendered-editor tests failed: partial accented token, missing combining/non-Latin tags, illegal mid-word tag and edit behavior |
| Skip rebuilding decorations after document edits | The editor update test failed when the separate hashtag was not decorated |
| Remove the todo marker position guard | Both outside-marker event cases failed because the note changed |

The existing ArrowDown paging test also now waits for the observable focus result, just as it already waits for the newly rendered result page. The first focused run exposed a transient assertion before React's focus effect completed. No production scheduling behavior was changed.

## Original cleanup validation against `830e548`

- Focused owner and sibling run: seven files, 76 tests passed.
- Full Vitest suite: 74 files, 649 tests passed. Six fewer expanded cases than the 655-case baseline; all canonical parser inputs remain covered.
- `npm run build` passed, including TypeScript, Vite and PWA generation.
- ESLint passed for every changed TypeScript file; `git diff --check` passed.

The first cold focused run logged an SQLite WASM resource-path error from the existing mocked Timeline test's real teardown flush. The subsequent focused and full runs passed. This lane did not change the database owner or add a success-supplying database mock to hide it.

## Browser-dependent cleanup

CSS-token, inline-transform, and copied sample-height cases remain until their exact built-app browser equivalents pass. The synthetic end-scroll case is retired after the J6 proof below. Their contracts include selected capsule alignment, preview dimensions, mobile containment and 44px tap targets, preserved drafts across layout changes, and actual clamped follow/read scroll positions. Retained security races, save ordering, consent, sync guards, parser action validation and gesture state tests are not candidates for replacement by model judgment.


## Built-app concurrency and streamed chat

`tests/e2e/concurrency-chat.spec.ts` adds three journeys, each run in Chromium at 1440×900 and mobile WebKit at 390×844. J5 runs both native `BroadcastChannel` and the storage fallback in two pages sharing real SQLite/IndexedDB. The fallback removes only the browser capability before startup. Native event witnesses confirm the transport, while browser pointer/keyboard input confirms the stale editor is inert. The current writer's persisted text survives the old tab's public Reload action and another reload.

Opening a second tab currently writes settings migrations even when their values already exist (`llm.providers` and `llm.schemaVersion`), making the original tab stale. J5 uses the newest tab as the writer, waits for that bootstrap revision, clears witness observations, and then checks a subsequent edit's announcement. It does not assume both tabs remain writable or inject store state.

J6 configures a local OpenAI-compatible provider through Settings. A test-owned HTTP server supplies independently gated SSE chunks; the real browser fetch, AI SDK, context assembly, stream parser, renderer, note insertion and database remain in the path. The journey checks that loaded note text reaches the provider request, partial tags stay incomplete, literal code examples never become note actions, one requested insert persists, and a grounded citation reveals the actual highlighted source below the first screen. CodeMirror's DOM is virtualized, so the reload proof waits for the restored editor and scrolls the real document before inspecting its tail.

The same stream makes the message list scrollable, leaves a reader's actual scroll position alone, exposes New messages, returns to the clamped end, and stays there after width and height reflow. The test waits for the public following state and two rendering frames before resizing; an immediate resize while that state was still settling produced a false failure in the first run.

### Additional retirement

| Original test | Failure it asserted | Callers and history | Stronger remaining proof | Deletion unlocked and risk |
| --- | --- | --- | --- | --- |
| `follows new content while the reader is at the bottom`, `src/routes/timeline/useStickToBottom.test.tsx:30` | Assigning `scrollHeight` to jsdom's unconstrained `scrollTop`, expecting 1000 despite a 200px viewport and a real maximum of 800 | `Timeline` installs the hook for the desktop chat list; `7837046` introduced the desktop chat behavior | J6's real scrolling list follows streamed content, preserves a reader, jumps to the actual clamped end and reanchors after reflow in Chromium and WebKit. Disabling the resize anchor fails the browser assertion | Delete only this synthetic assignment case. Keep both logical unseen-content cases and the live hook. The browser, rather than a fake geometry setter, owns clamping and layout |

Run `npx playwright test tests/e2e/concurrency-chat.spec.ts` against the built app. The focused hook and navigation check is `npm test -- src/routes/timeline/useStickToBottom.test.tsx src/routes/timeline/useCitationNavigation.test.ts src/routes/timeline/useCitationNavigation.test.tsx src/routes/Timeline.desktopChat.test.tsx src/routes/timeline/SearchModePills.test.tsx`.

### Browser mutation evidence

| Temporary mutation | Observed result |
| --- | --- |
| Supply the phone `composer` search layout to the desktop card on current `dev` | C6 fails on the actual visible `Lines` button |
| Scroll a citation to offset 0 rather than its quoted source | J6 fails because the real source destination is outside the viewport |
| Allow action tags inside a code fence | J6 fails: the forbidden example becomes a second action, so the requested single insert is not applied |
| Anchor resize only when the reader is not following | J6 fails the actual end-distance assertion after reflow |
| Ignore database revision storage events while BroadcastChannel is unavailable | J5 sees the native storage signal, but fails because the old editor is not inert |
| Revert the citation ordering change alone | Two Chromium repetitions passed. This control survives and does not establish a deterministic scheduling regression |

All mutation sources were restored before the baseline run. The first resize mutation used a constant false branch and failed TypeScript null narrowing before browser execution; it provides no mutation-test evidence. The valid runtime inversion above is the recorded control.

### Citation owner correction

The browser journey exposed the quoted source remaining below the viewport in both engines. `Timeline.revealDay` queues the containing card's scroll in an animation frame, while the previous citation hook immediately dispatched its quote scroll. When CodeMirror already has measurement work pending, the card reveal can overwrite that earlier destination. The hook now queues its quote lookup after the card reveal. This changes scheduling without changing the matched quote or mode behavior. Existing keyboard activation, repeated-line and stale-line fallback tests remain; the real browser checks the destination. The scheduling-only revert's surviving repetitions are reported above because this race depends on pending layout work.


### Current-dev validation

After merging `origin/dev` at `3e1fd28`, all six J5/J6 engine cases passed with two workers in 21.0 seconds. The five focused navigation/search/scroll files passed all 41 cases. The production build, changed-file ESLint and whitespace checks passed. Browser mutation controls ran against built production code, each in isolation, with source restoration and a final rebuild before the green baseline.
