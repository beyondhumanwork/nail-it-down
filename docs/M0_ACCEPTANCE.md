# M0 acceptance matrix — Command Code host feasibility

**Status:** Execution checklist; no check has been run or passed yet.
**Date:** 2026-10-20.
**Owner:** Pi for implementation and evidence collection; product owner for acceptance.

## Environment

Before coding, record actual versions without upgrading automatically:

- `node --version`, `npm --version`, `cmd --version`;
- operating system and execution environment (remote capable machine, not the constrained ThinkPad);
- installed harness typings, ModApi signatures, and the official docs URL consulted.

Official docs currently state Node.js 22+ is required; shipped ModApi signatures are experimental. [Command Code mods](https://commandcode.ai/docs/mods) and [quickstart](https://commandcode.ai/docs/quickstart).

## Test cases

| ID | Check | Evidence needed | Result |
| --- | --- | --- | --- |
| M0-01 | Mod loads using `cmd --mod ./src/index.ts` without registration/load errors | Actual command output with version | NOT RUN |
| M0-02 | `/naildown <goal>` registers, appears in TUI autocomplete, and preserves complete goal text | Screen/terminal record, steps and exact input | NOT RUN |
| M0-03 | One hard-coded question appears; one explicit choice is recorded | Actual TUI interaction, no model call | NOT RUN |
| M0-04 | UI cancellation creates no answer and no approval | Record before/after state | NOT RUN |
| M0-05 | Answer persists across **process exit and restart**, not just hot reload | Repeatable steps and status output | NOT RUN |
| M0-06 | Two workspace paths don't share answers | Separate workspace test | NOT RUN |
| M0-07 | Failed store write is handled and never reports saved | Controlled fault or mocked store failure | NOT RUN |
| M0-08 | Dummy approval defaults to No; an explicit denial cannot persist approval | TUI and store state | NOT RUN |
| M0-09 | Headless mode cannot approve or invent an answer | Headless command and status output | NOT RUN |
| M0-10 | No model calls, spawned subprocesses, repository scans, or implementation writes at mod runtime | Code review and observed execution | NOT RUN |
| M0-11 | State schema/version present; unknown/corrupt stored values fail safely | Unit checks with invalid data | NOT RUN |
| M0-12 | Documentation lists actual limitations and executed vs unexecuted checks | M0 PR body and evidence report | NOT RUN |

**Pass criteria:** M0-01 through M0-12 must be **PASS** or receive an explicit, documented exception for a blocked environment check; do not claim completed host feasibility without a real TUI restart demonstration. Tests that are not run are not passes.

## Out of scope

No model integration, repository reader, question graph, Markdown export, backend, releases, auto-CI, paid services, or registry submission.

## Delivery

- Pi works in a focused branch and opens a PR linked to [issue #2](https://github.com/beyondhumanwork/nail-it-down/issues/2).
- Report files changed and exact command results. Sanitized evidence only.
- Stop at M0; the product owner reviews the PR and separately authorizes M1.
