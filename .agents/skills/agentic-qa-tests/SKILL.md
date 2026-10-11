---
name: agentic-qa-tests
description: Executes the Agentic QA (AQA) workflow consisting of Testing, Verification, confirmed-bug planning, and inconclusive-finding reporting. Use this when the user asks to run AQA, Agentic QA, or QA testing on the project.
---

# Agentic QA (AQA) Workflow

This skill executes the Agentic QA (AQA) workflow, which consists of four distinct phases: Testing, Verification, Planning, and Inconclusive Findings Reporting.

Use a fresh delegated child for each phase through the harness's available subagent interface (for example Codex `spawn_agent` or T3 `delegate_task`). `general-purpose` is a Claude-specific agent type, not a required tool name. Chain the four phases sequentially; wait for a child to finish before starting the next. If delegation is unavailable, report that limitation instead of claiming independent verification.

Read [the journey manifest](../../../docs/testing/journeys.md) before delegating. Give children user goals and independent outcome contracts, the exact checkout/build, isolated fixture IDs, and the run directory. They may execute committed Playwright regressions; use T3 collaborative preview tools when available for interactive exploration. Test only synthetic local data. Live provider/model checks require dedicated test accounts authorized by the user and a bounded cost.

Record passed, failed, inconclusive, inapplicable and untested scenarios separately, with the evidence fields in the manifest. Diagnose locator failures as harness issues before calling them product defects. Do not remove an assertion, skip a critical journey, weaken a security outcome, or change production code to make a run pass.

## Workflow Steps

### Step 1: Run QA Tests
- Generate the current timestamp (`YYYYMMDD-HHMMSS`).
- **Delegate to a fresh child**: Instruct it to read [run-qa-tests.md](run-qa-tests.md) and execute the QA testing phase. Tell it to use the timestamp you generated to save the final report in `tests/agentic-qa-tests/runs/<YYYYMMDD-HHMMSS>/REPORT.md`.
- Wait for the subagent to complete and return the path to the report.

### Step 2: Run QA Verification
- Only start this after the Step 1 subagent is completely finished.
- **Delegate to a NEW child**: Instruct it to read [run-qa-verification.md](run-qa-verification.md) and the `REPORT.md` produced in Step 1.
- Tell it to verify the bugs and save the verification report as `VERIFICATION.md` in the same `<YYYYMMDD-HHMMSS>` directory.
- Wait for the subagent to complete and return the path to the verification report.

### Step 3: Distil Bugs into Fix Plans
- Only start this after the Step 2 subagent is completely finished.
- **Delegate to a NEW child**: Instruct it to read [run-qa-planning.md](run-qa-planning.md) and the `VERIFICATION.md` produced in Step 2.
- Tell it to distill every confirmed bug into an actionable fix plan, saving them as Markdown files in `tests/agentic-qa-tests/runs/<YYYYMMDD-HHMMSS>/plans/AQA-<DATE>-<N>-plan.md` (e.g. `AQA-20231024-001-plan.md`).
- Wait for the subagent to complete and return the paths to the generated plans.

### Step 4: Report Inconclusive Findings
- Only start this after the Step 3 subagent is completely finished.
- **Delegate to a NEW child**: Instruct it to read [run-qa-inconclusive-findings.md](run-qa-inconclusive-findings.md) and the `VERIFICATION.md` produced in Step 2.
- Tell it to analyze every flaky or inconclusive finding and save the report to `tests/agentic-qa-tests/runs/<YYYYMMDD-HHMMSS>/inconclusive-findings/REPORT.md`.
- Wait for the subagent to complete and return the path to the inconclusive findings report.

### Completion
Once all four subagents have completed sequentially, present a concise summary of the QA run to the user in the main conversation, including the paths to the generated reports and plans.
