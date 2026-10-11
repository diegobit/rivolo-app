# UI test audit: editor and search boundaries

The editor tests now exercise the installed CodeMirror extensions through a real `EditorView`. Unicode tags are checked in the rendered document, and todo mouse tests dispatch events through the public pointer extension. The private implementation helpers no longer need exports for tests. The shared todo parser keeps one table of Markdown preservation cases.

The desktop search test now checks the current accessible group, `Show results as`. Its previous selector looked for a button named `Toggle result mode`, which no longer exists. An actual mutation demonstrated the difference: exposing the forbidden desktop toggle passed the old assertion and failed the repaired assertion.

## Deletion and retention record

| Candidate and original location | What the old test detected | Production callers and history | Remaining proof and deletion unlocked | Risk and focused check |
| --- | --- | --- | --- | --- |
| C6: `lists every match and offers no Days/Lines toggle`, `src/routes/Timeline.desktopChat.test.tsx:631` | Appearance of the obsolete button label, not the current toggle | `Timeline` renders `SearchModePills`; desktop omission introduced in `7837046`, controls renamed in `480c065` | Replace the old negative assertion with absence of the actual group. The same test still requires both matches. No production behavior or mocks removed | Wrong desktop wiring previously escaped detection. Run `npm test -- src/routes/Timeline.desktopChat.test.tsx src/routes/timeline/SearchModePills.test.tsx` |
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

## Validation

- Focused owner and sibling run: seven files, 76 tests passed.
- Full Vitest suite: 74 files, 649 tests passed. Six fewer expanded cases than the 655-case baseline; all canonical parser inputs remain covered.
- `npm run build` passed, including TypeScript, Vite and PWA generation.
- ESLint passed for every changed TypeScript file; `git diff --check` passed.

The first cold focused run logged an SQLite WASM resource-path error from the existing mocked Timeline test's real teardown flush. The subsequent focused and full runs passed. This lane did not change the database owner or add a success-supplying database mock to hide it.

## Browser-dependent cleanup

CSS-token, inline-transform, copied sample-height, and synthetic end-scroll cases remain until the built-app browser equivalents pass. Their contracts include selected capsule alignment, preview dimensions, mobile containment and 44px tap targets, preserved drafts across layout changes, and actual clamped follow/read scroll positions. Retained security races, save ordering, consent, sync guards, parser action validation and gesture state tests are not candidates for replacement by model judgment.
