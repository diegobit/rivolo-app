# Test ownership

Before adding or removing a test, name the observable failure it detects and its
owner. Keep a fast contract test when it independently protects syntax, storage,
security, migration, cancellation or failure recovery. Complexity and speed do
not decide value. Avoid expected values computed by the production function,
SQL-aware fake databases, mocked import success, and utility-class assertions.

Use real SQLite/IndexedDB for repository and durability outcomes; use current
migrations for D1 repository proofs. Route external HTTP for provider protocols.
Browser journeys use the built app and real editor/stores/save queue; mock only
external I/O. Source files must not expose helpers or reset globals solely for
tests. Injection remains appropriate when it owns an actual I/O boundary.

Before deleting a declaration, record its name/location, failure, callers,
history, keeper, deletion unlocked, risk and focused command in `docs/testing/`.
Run the keeper first. Deliberately break the relevant owner and prove it fails
when replacing weak coverage; restore source exactly. Do not retire a class or
layout assertion until browser geometry or behavior proves its contract.

`npm test` excludes `tests/e2e/` and ignored agent-QA scratch runs. Use
`npm run test:e2e` for a fresh build and both browser engines, or
`npm run test:e2e:built` after building. Keep physical installed-PWA and live
provider/model checks distinct from these automated results. Follow
[the journey/evidence manifest](../docs/testing/journeys.md) for agent missions.

Do not edit source/tests while Vitest is running in the same checkout. Parallel
lanes need independent worktrees. Preserve the first failure and its diagnosis;
retries cannot be reported as a clean first-attempt pass.
