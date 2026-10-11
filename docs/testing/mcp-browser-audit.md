# Agent Access browser proof

J8 now runs the built app against actual Pages handlers, a current-migration SQLite D1 adapter, and the actual MCP Worker. `scripts/serve-e2e.mjs` loads the server modules through Vite without adding production test exports. Each browser context gets an isolated database identified by an HttpOnly fixture cookie. Dropbox authorization and provider HTTP are deterministic external fixtures; code exchange, session state, encrypted cookies, profile enablement, token creation, and revocation use production code.

The server generates a temporary local TLS certificate because production OAuth configuration requires canonical HTTPS. Configure Playwright with `https://127.0.0.1:4175`, `ignoreHTTPSErrors: true` in both `use` and `webServer`, and `node scripts/serve-e2e.mjs` as its server command. `E2E_PORT` overrides the port; the external loopback callback receiver uses the following port. A separate loopback HTTP listener at `E2E_PORT + 2` serves the same build for service-worker and HTTP SSE journeys without untrusted TLS or mixed-content waivers. The server removes its certificate and closes its three listeners and databases when stopped. These fixture endpoints are confined to the test server.

## Contracts and ownership

`tests/e2e/agent-access.spec.ts` owns five journeys, each exercised in Chromium desktop and WebKit mobile:

- Connect Dropbox through its actual browser callback and exchange, then verify encrypted Strict provider and Lax profile cookies, including HttpOnly paths and Secure attributes.
- Enable Agent Access; reject missing CSRF and wrong-origin API mutations; create a named token; authenticate it through the Worker; verify only its independently computed hash is persisted; dismiss the plaintext token; reload; revoke; disable; re-enable; refuse the old token throughout.
- Submit Allow through the real consent form, reach an external callback, preserve state and issuer, exchange a PKCE code once, rotate its refresh token, and revoke the resulting grant.
- Submit Cancel, reach the callback with state/issuer and `access_denied`, and prove no code or grant was created.
- Refuse consent with missing and tampered encrypted profile cookies before showing Allow or creating a code.

J8 blocks service workers so external HTTP reaches its fixture routes. Other browser journeys still exercise the normal built PWA. The fixture uses an external authorization page with script navigation because WebKit cannot fulfill a routed request with a synthetic 302. The application's callback, state validation, and code exchange remain real. Reload waits for the observable database persistence revision rather than an arbitrary delay; local settings writes have a 400 ms save debounce.

## Confirmed consent failure and narrow repair

The first real Chromium form submission failed with HTTP 400 and “Consent origin is invalid.” The trace showed `Origin: null`: the consent HTML's `Referrer-Policy: no-referrer` suppressed the origin of its own form POST. After correcting only that policy, Chromium still blocked the external redirect under `form-action 'self'`.

The repair applies `Referrer-Policy: same-origin` only to consent HTML and permits only `self` plus the already validated registered callback origin in its form policy. External redirect responses retain `no-referrer`. Default script, frame, and base restrictions remain. The fast OAuth keeper independently pins these headers, rejects a mismatched registered redirect, and continues rejecting attacker and opaque (`null`) consent origins. Accepting `Origin: null` was not required.

The separate `feat/mcp-oauth-chatgpt-compatibility` branch also changes the form policy. Its future integration must retain this origin/referrer repair and resolve that overlapping hunk; this audit does not incorporate its unrelated compatibility changes.

## Replacement gate

| Candidate | Failure previously detected | Callers | Keeper/replacement | History | Deletion unlocked | Risk | Command |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/lib/agentAccess.test.ts` five declarations, originally lines 27–110 | Relative URLs, request body/headers, credentials, metadata forwarding, and request-error messages | `useAgentAccess`, Settings enable/disable/status | J8 now proves real callback/cookie/CSRF/profile lifecycle; backend suites retain invalid targets and provider refusals; hook tests retain visible error handling and stale response behavior | `7c4877b`, Settings bridge | Thin successful request-shape copies can be retired after integrated J8 passes | Keep any distinct unproved error or Google target contract; browser fixture uses Dropbox | `npx playwright test tests/e2e/agent-access.spec.ts` plus surviving API/hook keepers |
| `src/lib/agentAccessTokens.test.ts` four declarations, originally lines 24–74 | List/create/revoke fetch shape, metadata forwarding, error message | `useAgentAccessTokens`, `AgentAccessTokensPanel` | J8 proves real create/list/reload/revoke with encrypted session and one-time plaintext disappearance; PAT/API/hook keepers retain validation, isolation, cancellation, and error behavior | `7c4877b`, token management | Thin successful request-shape copies can be retired after integrated J8 passes | Do not remove distinct stale-response/cancellation contracts as duplicates | Same J8 command plus surviving PAT/hook keepers |

Original candidate declarations are:

- `agentAccess.test.ts:27` “loads status with the profile session cookie”; `:40` “enables Dropbox with the current path and timezone”; `:62` “enables Google Drive with the authoritative file ID and timezone”; `:96` “disables Agent access with credentials”; `:110` “surfaces the server error message”.
- `agentAccessTokens.test.ts:24` “lists metadata with credentials and without caching”; `:38` “creates a named token with the CSRF header”; `:57` “revokes the profile token with credentials and the CSRF header”; `:74` “surfaces sanitized server errors”.

The complete original declaration inventory is in the full audit. After all ten integrated J8 cases passed, the three Dropbox/status/disable success declarations and the three token-success declarations were retired. Google enablement and both error-message declarations remain because J8 does not exercise those outcomes. Hook cancellation, late response, and safety-order contracts remain. Independent preservation review agreed with this split.

## Verification

All ten J8 cases passed with two workers across Chromium and WebKit after the repair. At that earlier lane stage, the browser run against the adapter passed 17 cases, with the desktop exclusion of the mobile-menu case (one inapplicable execution). The final combined run passed 28 cases; see [the integration receipt](integration-receipt.md). The focused OAuth suite passed 13 cases, lint passed, and Pages TypeScript compilation passed. Restoring the old self-only form policy made the Allow journey fail at external navigation; its trace reported the exact `form-action 'self'` violation. The original no-referrer failure and this isolated policy control were retained as evidence before restoring the source. Removing the token client’s CSRF header and rebuilding also made the browser token journey fail: the actual API rejected creation with 403 and the UI showed “Missing CSRF request header.” The source was restored and rebuilt afterward.

Hosted Cloudflare bindings, live provider consent pages, installed iOS PWA behavior, and external MCP clients remain separate deployment/manual checks. These browser results establish the application-to-handler/database contract with reproducible provider responses.
