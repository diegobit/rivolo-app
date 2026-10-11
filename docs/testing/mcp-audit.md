# MCP boundary audit

The MCP tests now exercise the current D1 migrations and real authenticated HTTP requests through `Worker.fetch`. Provider HTTP remains deterministic so retries, concurrent revisions, and ambiguous uploads can be reproduced without touching an account. Security and data-loss contracts remain in focused suites; replacing a SQL-aware Map with SQLite does not make those contracts redundant.

## Authoring gate

Add a test when it names a public contract and a credible regression, identifies the owning suite, and fails when that regression is introduced. Prefer the existing owner over another copy of its fixtures. Preserve independent expectations for public limits, cookie attributes, secret handling, and exact redirect rules. Test-only exports or production dependency overrides need a production caller; the timezone getter and remote authenticator overrides had none and were removed.

Primary owners are `providerProfiles` for credential lifecycle and retargeting, `mcpPersonalTokens` for PAT isolation, `mcpOAuth` for consent/code/token rules, `mcpWriteIdempotency` for durable claims, the provider-source suites for safe file writes, and `remoteMcpServer` for authenticated SDK requests. The SQLite helper loads every sorted migration from the repository and is also usable by browser fixtures. It contains no copied application schema or SQL-specific mock answers.

## Cleanup decisions and evidence

| Candidate | Actual failure detected before | Production callers | Remaining proof and replacement | History | Deletion unlocked | Risk | Focused verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SQL-aware `FakeD1` blocks in profile, PAT, API, idempotency, and remote suites | Orchestration errors, while Maps supplied uniqueness, UPSERT conditions, and revocation behavior | Provider enable endpoints, token endpoints, remote bearer authentication, durable writer | Shared current-migration SQLite now verifies constraints, trigger revocation, isolated token deletion, replay, concurrency, and retries | `7c4877b`, MCP persistence and safe-write work | Five FakeD1 implementations; copied cleanup schema; OAuth hardcoded migration list | High without SQL replacement; SQLite cannot reproduce every workerd behavior | `node scripts/run-vitest.mjs run src/test/providerProfiles.test.ts src/test/mcpPersonalTokens.test.ts src/test/mcpAgentAccess.test.ts src/test/mcpWriteIdempotency.test.ts src/test/mcpOAuth.test.ts src/test/remoteMcpServer.test.ts src/test/mcpCleanup.test.ts` |
| `mcpWriteTools`: “resolves add_to_today with an injected profile time-zone getter” and direct date-helper cases | Getter invocation and forwarded date | Remote server supplies a profile timezone string | Actual SDK calls under a fixed clock cover UTC, west/east day boundaries, and invalid timezone refusal | `7c4877b`, additive tools | Getter union/resolver, exported date helper, optional date injection; production writer injection stays | Medium: date boundary must remain explicit | `node scripts/run-vitest.mjs run src/test/mcpWriteTools.test.ts src/test/remoteMcpServer.test.ts` |
| `mcpAgentAccess`: “keeps existing provider refresh cookies SameSite=Strict” | Shared helper header values | Provider exchange/refresh and MCP enable endpoints | `googleOAuth` independently pins both provider cookies; MCP suite still pins its encrypted Lax session | `60b6897` shared cookie extraction; `7c4877b` OAuth navigation | One duplicate assertion block | Low with both keepers | `node scripts/run-vitest.mjs run src/test/googleOAuth.test.ts src/test/mcpAgentAccess.test.ts` |
| `mcpWriteSafety` mixed file | Drive post-upload revision advancement, first note in an empty file, and retarget/revocation refusal | Remote provider source and profile repository | Exact Drive outcomes moved to `googleDriveNotesSource`; real-SQL retarget/revocation cases moved to `providerProfiles` | `7c4877b`, final protect-write fixes | Entire mixed suite and duplicate provider fixtures | Low for ownership move; high for deletion without preserving cases | `node scripts/run-vitest.mjs run src/test/googleDriveNotesSource.test.ts src/test/providerProfiles.test.ts` |
| Thin `agentAccess` client suites | Fetch shape and error forwarding | Settings hooks and panels | Retained pending browser-to-real-API cookie, CSRF, enable, token-create/revoke, and consent proof | `7c4877b`, settings bridge | Nothing in this commit | Medium/high until browser replacement passes | Existing client/hook/panel suites plus browser Agent Access campaign |

The declaration inventory and original locations were recorded in the full test-suite audit before edits. Keeper test names above remain searchable after ownership moves.

## Stronger contracts

The remote suite uses the actual SDK client and streaming HTTP transport for initialization, listing, reading, writing, and replay. It obtains actual encrypted provider profiles, PATs, and PKCE OAuth grants from the production repositories. Read-only and write-only OAuth grants both list their permitted tools and reject a real forbidden call without reaching a provider. Missing bearer auth is genuinely missing rather than supplied by a request helper.

Other repaired claims cover a same-origin refresh without the CSRF header, equivalent normalized input producing one durable write, scheduled cleanup actually deleting expired rows, more than one cleanup chunk, independently pinned public limits, and access/code/refresh expiry boundaries. Read-tool protocol cases verify pagination, truncation, recent nonempty days, search, todos, tags, mentions, missing days, and range errors through the SDK.

## Mutation checks

Each mutation was applied alone, exercised by its owner, and restored before subsequent runs. All failures were assertion failures against the changed contract, rather than import or compilation errors.

| Mutation | Keeper failure |
| --- | --- |
| Reclaim an existing durable operation with UPSERT | Replay called the writer twice instead of once |
| Remove PAT revocation's profile ownership condition | Another profile could revoke the token: 200 instead of 404 |
| Remove the profile retarget UPSERT guard | Dropbox and Drive retargeting unexpectedly resolved |
| Force `add_to_today` to UTC | West/east timezone calls forwarded the wrong day |
| Enable write tools for every principal | Read-only OAuth listed a forbidden write tool |
| Remove the mutation CSRF-header guard | Refresh returned 401 instead of the required 403 before authentication |

## Runtime verification and limits

`node scripts/test-mcp-runtime.mjs` creates an isolated temporary local D1 database, applies the actual migrations with Wrangler, starts the real Worker in workerd, and verifies discovery, unauthenticated challenges, authenticated SDK initialization/listing, GET rejection, profile revocation, and refusal to revive an old PAT after re-enable. It uses generated fixture credentials and never calls a live provider. It removes the temporary database and stops the Worker afterward.

Focused suites, TypeScript application/Worker builds, and lint passed. The local workerd/D1 smoke passed. SQLite-backed tests do not establish hosted D1 concurrency, deployed Cloudflare bindings, or a live Dropbox/Google contract. Browser consent navigation and session-cookie behavior need the separate browser campaign; the existing thin client suites remain until that replacement passes.
