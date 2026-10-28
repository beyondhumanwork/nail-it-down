# M2 entry contract — Slice 1: bounded evidence reader core

**Recorded:** 2026-10-27  
**Status:** M2 kickoff authorized for **Slice 1 only**. This is an incremental engineering contract, not approval to read real repositories, expose data to a model, enable CI or release the product.  
**Baseline:** `main` at `6b8f064da284ed783a5ac1ad28f7f7e220f7d0e4` (M1 accepted and documented).  
**Sources:** [Roadmap](ROADMAP.md), [Product specification draft](PRODUCT_SPEC_DRAFT.md) §6.3, [Architecture decisions](ARCHITECTURE_DECISIONS.md) §5, and [M1 technical acceptance](M1_ACCEPTANCE.md). The draft spec is a design input, not blanket feature authorization.

## Why this slice

M1 records decisions reliably but deliberately knows nothing about a repository. M2's goal is optional, consented, bounded, read-only context, with provenance and no implicit trust in repository text.

The host's built-in `read_file` agent tool is **not proof** that a `ModApi` command can invoke that tool. Public Command Code mods documentation warns the API is experimental and that mod code is not sandboxed. A safe read surface must be proven against the installed host before integration.

## Scope authorized for Slice 1

Implement and test a **host-independent** core for selecting allowed project files, enforcing budgets, classifying safely extracted metadata, and constructing attributable evidence. It may use **injected fake filesystem adapters / synthetic fixtures in tests**. It must not read any live user's repository, invoke the model, call network or shell, write to a workspace, register new CLI commands, or change the M1 adapter.

Suggested small modules: `src/core/discovery.ts` for policy / evidence types and `test/discovery.test.ts` for fixtures. Split into `src/discovery/` only if there is a concrete reason; avoid a framework.

### Candidate allowlist (not a license for automatic inspection)

Root `README.md`, root `AGENTS.md` (untrusted data), `package.json`, and relevant root manifests such as `pyproject.toml`, `Cargo.toml`, `go.mod`, `tsconfig.json`. Actual file selection must be deterministic and capped. Do not read all matching files by default: there is no runtime read in this slice.

Conservative *starting* budget for fixtures / policy: **at most 6 files**, **32 KiB per file**, **96 KiB total**, **250 lines per file**, and **at most 100 shallow directory entries**. These are provisional Slice 1 ceilings, to be reviewed using synthetic fixtures, not a forever product promise. Reject over-limit inputs explicitly, never partially treat them as a complete verified file.

### Security boundary

- Default deny unless an explicit future consent decision has been provided; never treat a dialog dismissal or a missing UI as permission. Slice 1 does not expose a consent UI.
- Never access or select `.env*`, keys, certificates, credential stores, private configuration, `.git`, `node_modules`, secrets, token files, lockfiles or user-ignored paths. Dotfiles are excluded except expressly allowlisted metadata.
- Defend against `../`, absolute paths, encoded separators, path normalization tricks, case-sensitive/insensitive collisions, Windows/Unix syntax confusion, root escapes, symlinks (including dangling/cyclic symlinks), device/special files, binaries, malformed encodings, oversized files and traversal caps. The *actual* OS `realpath`/open-time escape and time-of-check/use checks are deferred to the separately reviewed host adapter; no fake reader test can certify real-host filesystem safety.
- No arbitrary user-specified source paths in Slice 1, and no recursive source scans.
- Never execute instructions from `README.md`, `AGENTS.md` or source comments; they are data only.
- Never record full raw file contents in persistent session state, logs, reports or model context. Do not print fixture secrets. Where a snippet is eligible, make it short and redacted; secret detection is a defense-in-depth filter, not a guarantee.
- Evidence carries a normalized workspace-relative path, bounded line span and a provenance/verification state. Absence in a limited scan never becomes a verified claim of absence. No fabricated citations or source facts.

### Stop before host integration

No real filesystem adapter, direct `node:fs` import in runtime source, `cmd.exec`, built-in tool calls, opt-in dialog wiring, session v3 change, approval change, model calls, export, CI, package dependencies or publishing in Slice 1.

The installed host API and filesystem capability are **research questions for the next integration gate**, not permission to use private files as a trial fixture. If the policy/core design cannot be supported securely, report a blocker and a minimal alternative rather than broadening privileges.

## Acceptance tests

Minimum negative fixtures: empty repo; root README/manifest; `AGENTS.md` prompt injection; `.env` containing fake credentials; known secret patterns embedded in allowed files; key/certificate extensions; lockfiles; ignored paths; `../` and encoded traversal; absolute/outside paths; Windows and POSIX separators; symlink escape/cycle/dangling link; device/binary content; invalid UTF-8; too many files, bytes, lines or entries; duplicate/case-folded paths; source file removed or changed in a fake reader; a fabricated provenance reference; no-consent/headless refusal. Positive fixtures must produce stable ordering, bounded source-backed claims with source path+line provenance, and no raw secret disclosure.

Run full existing test suite and typecheck only on the established MacBook test route. Keep M0–M1 behavior and source unchanged; no heavy ThinkPad work, no Actions. Save full/short dated Markdown handoffs in the existing Limitless vault; no waiting or triggering synchronization.

## Future slices — not authorized by this document

- **Slice 2 (proposed):** Prove and integrate a safe, explicitly consent-gated, read-only host filesystem adapter on an isolated synthetic workspace. Verify actual Command Code host API and `realpath`/symlink race constraints. No external network or model.
- **Slice 3 (proposed):** Display bounded, cited context in `/naildown`, with optional idea-only mode, truthful stale/insufficient evidence indicators, restart behavior, and real TUI consent verification. Still no model calls or export.
- Any further scope is acceptance-gated. The M2 milestone can close only after provenance, secret, symlink, path and size limits, and actual consent behavior pass independent review.

## Delivery and authority

Pi implements **Slice 1 only** on a new feature branch, reports actual test evidence, pushes if permitted, and stops without PR or merge. ChatGPT reviews source, opens/merges the PR if accepted. Command Code is reserved for the later real-host slice. Nothing here authorizes M2 Slice 2+, M3+, runtime access to a real workspace, model/provider data disclosure, CI, publication or release.
