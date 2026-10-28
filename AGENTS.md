# Agent instructions — Nail It Down

These instructions apply to Pi, Codex, Command Code, and other coding agents contributing to this repository.

## Source of truth and current state

- Current phase: **pre-alpha**. M0 and all four M1 slices are **merged**; M1 has passed its scoped **technical acceptance** gate as recorded in `docs/M1_ACCEPTANCE.md`. This is not beta sign-off or approval of the full v0.1 product. M2 and all later milestones remain **not authorized**. No public installation or release is available. The M0-09 headless limitation and other M1 caveats remain in the acceptance records.
- Read `docs/PRODUCT_SPEC_DRAFT.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/M0_HANDOFF.md`, and this file before coding.
- The full PRD and broader architecture remain **proposed**. The accepted implementation contract covers M0 and the narrowly scoped M1 deterministic interview, not M2, model assistance, repository reads, export or release. See `docs/M1_ACCEPTANCE.md`, `docs/M0_ACCEPTANCE.md`, `docs/REVIEW_GATE.md` and `docs/ROADMAP.md`. Do not silently treat proposed features as authorized.
- Command Code's public ModApi is experimental. Verify signatures against the installed host and official docs; report mismatches.

## Scope and architecture

- Implemented code today: the M0 mod (local mod load, `/naildown`, one hard-coded question, durable host-backed answer, cancel/default-deny approval, status/resume) and the **M1 interview**: a pure domain core (`src/core/session.ts`, `graph.ts`, `transitions.ts`, `interview.ts`) wired into `/naildown` behind the versioned `session.v2:<workspace>` key. M0 records stay readable and are only migrated through an explicit choice.
- No LLM calls, repository inspection, Markdown export, subprocesses, network requests, background services, or automatic file modification in M0 or M1. The full product interview, repository reading and privacy features are **not** implemented.
- Keep platform integration in a thin adapter. Domain logic should remain deterministic and independently testable.
- An LLM never creates user approval or trusted repository facts. Persist decisions only after user confirmation.

## Resource and operational rules

- **The ThinkPad is not a build or test machine.** Source editing and SSH are allowed there; builds, test suites, CI workloads and deployments must run on deliberate, approved remote compute. If none is available, report checks as **NOT RUN**.
  - *Owner clarification (2026-10-21):* this rule targets resource-intensive work. Lightweight manual verification using software already installed on the machine is allowed — this is how M0's interactive host checks were run, because Command Code is only installed there. Do not repeat unit tests or typechecks on that machine.
- Do not add scheduled workflows, CI on every push, expensive matrix jobs, paid model evaluations, or deployments.
- Do not publish npm packages, releases, modify repository settings, or submit to registries without explicit authorization.
- Work on a short-lived branch, keep changes focused, and use reviewable pull requests. Don't push or merge without the authorized workflow.


## Security and reporting

- Never commit keys, model transcripts, credentials, real private project source, or test artifacts containing secrets.
- No default telemetry or unapproved reads of users' repositories.
- Use actual executed tests as evidence. Record host versions, observed behavior, failures and remaining unknowns.
- Do not claim installation or platform support based only on mock tests.

## Completion report

State: files changed; work done; commands/tests actually run with results; exact host versions when available; problems; risks; proposed next step. Stop at the milestone boundary.
