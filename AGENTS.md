# Agent instructions — Nail It Down

These instructions apply to Pi, Codex, Command Code, and other coding agents contributing to this repository.

## Source of truth and current state

- Current phase: **pre-alpha**. M0 and M1 are technically accepted; M2 Slices 1–3A are accepted for synthetic-only scope, and 3B1 is technically accepted (`docs/M2_SLICE3B1_ACCEPTANCE.md`). The owner **approved cooperative Option A for developing M2 Slice 3B2**, including its known parent-directory race limitation (`docs/M2_OPTION_A_DECISION.md`). **Only dormant, synthetic-fixture-only 3B2 development is authorized** under `docs/M2_SLICE3B2_CONTRACT.md`. Actual user/project repository reads, live `/naildown` integration, persisted evidence/consent, model calls, CI, beta or release remain unauthorized.
- Read `docs/PRODUCT_SPEC_DRAFT.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/M0_HANDOFF.md`, and this file before coding.
- The full PRD remains **proposed**. Accepted code covers M0, M1 and M2 Slices 1–3B1 under their narrow gates. The owner accepted the cooperative threat-model **for 3B2 pilot development only**; the [decision memo](docs/M2_REAL_WORKSPACE_SECURITY_DECISION.md) remains a design reference, not authorization to inspect real files. See `docs/M2_SLICE3B2_CONTRACT.md`, `docs/M2_OPTION_A_DECISION.md`, and earlier M2 acceptance records. Real-repository canaries, M2 completion, exports, model calls and later milestones require separate approval.
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
