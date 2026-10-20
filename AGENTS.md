# Agent instructions — Nail It Down

These instructions apply to Pi, Codex, Command Code, and other coding agents contributing to this repository.

## Source of truth and current state

- Current phase: **pre-alpha planning**; no product functionality has been implemented.
- Read `docs/PRODUCT_SPEC_DRAFT.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/M0_HANDOFF.md`, and this file before coding.
- The PRD and architecture are **proposals pending explicit owner review**. Do not silently treat a proposed design as an approved implementation contract.
- Command Code's public ModApi is experimental. Verify signatures against the installed host and official docs; report mismatches.

## Scope and architecture

- First code milestone is **M0 only**: local mod load, `/naildown`, one hard-coded question, durable host-backed answer, cancel/default-deny approval, status/resume.
- No LLM calls, repository inspection, full interview DAG, Markdown export, subprocesses, network requests, background services, or automatic file modification in M0.
- Keep platform integration in a thin adapter. Domain logic should remain deterministic and independently testable.
- An LLM never creates user approval or trusted repository facts. Persist decisions only after user confirmation.

## Resource and operational rules

- **Do not run builds/tests/deployments on the constrained ThinkPad.** Editing and SSH from it are allowed; use deliberate, approved remote compute. If unavailable, report checks as **NOT RUN**.
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
