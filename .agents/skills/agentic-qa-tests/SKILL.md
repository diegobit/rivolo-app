---
name: agentic-qa-tests
description: Executes the Agentic QA (AQA) workflow consisting of Testing, Verification, confirmed-bug planning, and inconclusive-finding reporting. Use this when the user asks to run AQA, Agentic QA, or QA testing on the project.
---

# Agentic QA (AQA) Workflow

This skill executes the Agentic QA (AQA) workflow, which consists of four distinct phases: Testing, Verification, Planning, and Inconclusive Findings Reporting.

To ensure that each phase operates with a clean context, you MUST use the built-in `general-purpose` subagent for each step. Do NOT perform the steps yourself in the main conversation. Chain the subagents sequentially, waiting for each to finish before starting the next.

## Workflow Steps

### Step 1: Run QA Tests
- Generate the current timestamp (`YYYYMMDD-HHMMSS`).
- **Delegate to a subagent**: Instruct the `general-purpose` subagent to read `.Codex/skills/agentic-qa-tests/run-qa-tests.md` and execute the QA testing phase as instructed. Tell it to use the timestamp you generated to save the final report in `tests/agentic-qa-tests/runs/<YYYYMMDD-HHMMSS>/REPORT.md`.
- Wait for the subagent to complete and return the path to the report.

### Step 2: Run QA Verification
- Only start this after the Step 1 subagent is completely finished.
- **Delegate to a NEW subagent**: Instruct a fresh `general-purpose` subagent to read `.Codex/skills/agentic-qa-tests/run-qa-verification.md` and the `REPORT.md` produced in Step 1.
- Tell it to verify the bugs and save the verification report as `VERIFICATION.md` in the same `<YYYYMMDD-HHMMSS>` directory.
- Wait for the subagent to complete and return the path to the verification report.

### Step 3: Distil Bugs into Fix Plans
- Only start this after the Step 2 subagent is completely finished.
- **Delegate to a NEW subagent**: Instruct a fresh `general-purpose` subagent to read `.Codex/skills/agentic-qa-tests/run-qa-planning.md` and the `VERIFICATION.md` produced in Step 2.
- Tell it to distill every confirmed bug into an actionable fix plan, saving them as Markdown files in `tests/agentic-qa-tests/runs/<YYYYMMDD-HHMMSS>/plans/AQA-<DATE>-<N>-plan.md` (e.g. `AQA-20231024-001-plan.md`).
- Wait for the subagent to complete and return the paths to the generated plans.

### Step 4: Report Inconclusive Findings
- Only start this after the Step 3 subagent is completely finished.
- **Delegate to a NEW subagent**: Instruct a fresh `general-purpose` subagent to read `.Codex/skills/agentic-qa-tests/run-qa-inconclusive-findings.md` and the `VERIFICATION.md` produced in Step 2.
- Tell it to analyze every flaky or inconclusive finding and save the report to `tests/agentic-qa-tests/runs/<YYYYMMDD-HHMMSS>/inconclusive-findings/REPORT.md`.
- Wait for the subagent to complete and return the path to the inconclusive findings report.

### Completion
Once all four subagents have completed sequentially, present a concise summary of the QA run to the user in the main conversation, including the paths to the generated reports and plans.
