# AGENTS

Guidance for coding agents working in this repo.
Keep behavior stable and follow existing conventions.

## Project overview
- Vite + React 19 + TypeScript.
- TailwindCSS utilities plus `src/index.css` for global styles.
- PWA setup via `vite-plugin-pwa` in `vite.config.ts`.
- Local storage uses SQLite in a web worker (`src/lib/sqliteWorker.ts`).
- Sync providers live in `src/lib` and are surfaced via `src/store`.
- Primary routes are in `src/routes`, wired in `src/App.tsx`.

## Commands
- Install deps: `npm install`.
- Dev server: `npm run dev` (Vite, port 5174, COOP/COEP headers).
- Build: `npm run build` (typecheck via `tsc -b`, then `vite build`).
- Preview build: `npm run preview`.
- Lint: `npm run lint` (ESLint flat config).
- Typecheck only: `npx tsc -b`.
- Tests: no test runner configured yet.
- Single test: not available until tests are added.
- If you add tests, update this file with `npm test` and single-test usage.

## Repo layout
- `src/components` for shared UI pieces.
- `src/routes` for page-level route components.
- `src/lib` for domain logic, API wrappers, utilities.
- `src/store` for Zustand stores (`useXStore.ts`).
- `src/assets` for static assets pulled into bundles.
- `src/index.css` for Tailwind base + global styles.
- `src/App.tsx` for routing, `src/main.tsx` for bootstrap.

## Runtime notes
- Vite dev server runs with COOP/COEP headers for SharedArrayBuffer usage.
- PWA manifest lives in `vite.config.ts`.
- The app expects to run fully client-side (no server code here).
- SQLite worker is initialized on demand in `src/lib/db.ts`.

## Environment and secrets
- Dropbox OAuth needs `VITE_DROPBOX_CLIENT_ID` in the Vite env.
- LLM Gemini API key is stored in settings, not in env files.
- Do not commit secrets or generated credentials.

## Code style
Follow existing patterns; keep changes minimal and consistent.

### Imports
- Order: external packages first, then local `../` and `./` imports.
- Use `import type` for type-only imports.
- Some local imports include extensions (`.ts`/`.tsx`); keep file-local convention.
- Avoid unused imports; TypeScript + ESLint are strict.

### Formatting
- 2-space indentation, no semicolons.
- Single quotes for strings.
- Trailing commas in multiline literals and argument lists.
- Prefer `const` and arrow functions for helpers.
- Prefer `type` aliases over `interface`.
- Keep helper functions near their usage when possible.
- Prefer early returns for guard clauses.

### Naming
- Components: `PascalCase`, default exports in route/components.
- Hooks/stores: `useXStore` with camelCase state fields.
- Types: `PascalCase` or `CamelCase` (`Day`, `SyncStatus`).
- Constants: `UPPER_SNAKE_CASE` for true constants.
- IDs like `dayId` follow `YYYY-MM-DD` strings.

### Types and data
- TypeScript `strict` mode is on; avoid `any`.
- Use explicit union types for state or action variants.
- Prefer `string | null` rather than `undefined` in state.
- Use `satisfies` when exporting objects that must match a type.
- Favor `Record<string, T>` for map-like objects.
- When returning optional data, use `T | null` and guard at call sites.

### React and UI
- Function components with hooks (`useMemo`, `useCallback`, `useEffect`).
- Use `memo` when props are stable and renders are heavy.
- Keep JSX dense but readable; avoid unnecessary abstractions.
- Use `className` with Tailwind utility strings.
- Accessibility: use `aria-label`, `aria-hidden`, and proper button types.
- When ignoring async results in handlers, prefix with `void`.
- Prefer `useRef` for mutable caches and timers.

### State and data access
- Zustand stores live in `src/store/useXStore.ts`.
- Store state types are declared near the store.
- Store methods are async and update state via `set`.
- Repositories live in `src/lib` and return domain types.
- Keep side effects (storage, fetch) in `src/lib`, not components.

### Error handling and logging
- Check `response.ok` for fetch calls; throw `Error` with clear messages.
- Use `try/catch` around async flows and set UI error state.
- Prefer `error instanceof Error` when reading error messages.
- Log with `console.info`/`console.warn`/`console.error` using tags.
- Swallow errors only when UX requires it; leave a short comment if non-obvious.

### CSS and assets
- Tailwind is primary; custom styles live in `src/index.css`.
- Shared class strings are in `src/lib/ui.ts`.
- Backgrounds and typography are global; align with existing tokens.
- Asset paths are root-relative (`/logo.png`, `/icons.svg`).
- Keep animations subtle and match existing motion durations.

### Lint/TypeScript constraints
- ESLint uses `@eslint/js`, `typescript-eslint`, `react-hooks`, `react-refresh`.
- `tsconfig` enforces `noUnusedLocals`, `noUnusedParameters`.
- `noUncheckedSideEffectImports` is enabled; avoid casual side-effect imports.
- `erasableSyntaxOnly` means no runtime-only TS syntax.
- Avoid new lint disables unless absolutely necessary.

## Domain notes
- Day entries are keyed by `dayId` (`YYYY-MM-DD`) and stored in SQLite.
- Import/export helpers live in `src/lib/importExport.ts` and `src/lib/markdown.ts`.
- Sync is pluggable; Dropbox is current provider (`src/lib/dropbox.ts`).
- Sync state is tracked in `src/lib/syncState.ts` and exposed via stores.
- LLM chat uses Gemini; prompts and context live in `src/lib/llm` and `src/lib/llmContext.ts`.

## Cursor/Copilot rules
- No `.cursor/rules`, `.cursorrules`, or `.github/copilot-instructions.md` found.

## Notes for agents
- Favor small, reviewable changes; avoid mixing unrelated edits.
- Keep UI changes aligned with existing visual style.
- If you add tooling or conventions, update this file.
- Prefer updating tests or lint rules only when needed for the change.
- Do not remove user data or reset storage without explicit request.
- Avoid destructive git commands; keep working tree clean.
- Confirm new scripts in `package.json` match documentation here.

## Quick references
- App entry: `src/main.tsx`.
- Route shell: `src/components/AppShell.tsx`.
- Timeline view: `src/routes/Timeline.tsx`.
- Settings view: `src/routes/Settings.tsx`.
- Database worker: `src/lib/sqliteWorker.ts`.
- SQLite facade: `src/lib/db.ts`.
- Sync API: `src/lib/sync.ts`.
- Dropbox OAuth: `src/lib/dropbox.ts`.
- LLM API: `src/lib/llm/index.ts`.
- Styles: `src/index.css`, `src/App.css`.

## How to add tests later
- Pick a runner (Vitest recommended for Vite projects).
- Add `test` script to `package.json`.
- Document `npm run test` and a single-test command here.
- Keep tests near code (e.g., `src/lib/__tests__` or `src/lib/*.test.ts`).
