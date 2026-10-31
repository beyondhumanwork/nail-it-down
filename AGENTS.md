# Agent instructions — Nail It Down

These instructions apply to Pi, Codex, Command Code, and other coding agents contributing to this repository.

## Source of truth and current state

- Current phase: **pre-alpha**. M0/M1 accepted. M2 Slices 1–3B2 narrowly accepted; 3B3 is **TECHNICAL PASS — OPERATIONAL VERIFICATION INCOMPLETE**; M2-6 (Linux filesystem trust) and M2-7C (model-context replay: **VERIFIED EXCLUDED** on Command Code 1.88.0) are merged. M2-8 adds `/naildown context` **behind a default-off, session-scoped host flag** (`experimentalRepositoryContext`): enabling the flag is not consent, the command takes no arguments, and three separate refusals can stop it. The no-arguments rule prevents a path being *accepted*, used or echoed; it cannot prevent the host recording the typed text first, because Command Code writes slash-command history before the mod runs. The gate is **never** persisted and normal `/naildown` does not inspect files. **Normal-session persistence was never established** — the host tests ran only with `--no-session`, so any interactive pilot must stay in that verified isolated mode. No production activation, real-repository read, model call, CI, release or M3 is authorized.
- Read `docs/PRODUCT_SPEC_DRAFT.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/M0_HANDOFF.md`, and this file before coding.
- The full PRD remains **proposed**. Read `docs/M2_SLICE4_CONTRACT.md`, `docs/M2_SLICE3B3_CLOSEOUT.md`, `docs/M2_SLICE3B3_ONE_TIME_CANARY.md`, `docs/M2_SLICE3B2_ACCEPTANCE.md` and `docs/M2_OPTION_A_DECISION.md`. The former one-time canary root is privately named and **must not be re-read**; do not publish the private path. Synthetic harness-created fixtures are permitted only as stated in the M2-4 contract. A user-typed path, `cmd.cwd`, and caller-provided `permittedParents` do not independently authorize reading. Cooperative Option A does not eliminate hostile concurrent parent swaps or same-filesystem bind mount ambiguity. M2 completion, live integration, routine reads, exports, model calls, M3 and beyond need further approval.
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
