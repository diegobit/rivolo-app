# Plans

| Plan | Status | Blockers |
| --- | --- | --- |
| [OneDrive daily sync](2026-10-01-onedrive-daily-sync.md) | implemented; real-account, iOS/PWA and multi-device checks listed in the plan are not recorded as run | — |
| [Daily sync for Dropbox and Google Drive](2026-11-13-daily-sync-provider-parity.md) | explicit Dropbox and Drive upgrades, daily attribution, relay and hosted Agent cutover in PR #34 | Real Dropbox and Drive account tests, including Drive revision visibility and duplicate creation. Validate Worker budgets on realistic histories before rollout. |
| [OneDrive Agent access on the hosted MCP](2026-11-19-onedrive-agent-access.md) | wip: phase 1 committed on `feat/onedrive-agent-access` | Phases 3 and 4 wait on the open decisions listed in the plan (agent author label, relay publish scope, credential breadth). |
