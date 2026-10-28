# Architecture review gate

**Historical M0 status:** Host-feasibility spike formally accepted — 2026-10-25 (with documented M0-09 exception).
**Current M1 status:** The scoped deterministic interview passed technical acceptance on 2026-10-27; see [M1 acceptance and limitations](M1_ACCEPTANCE.md). The full product v0.1 specification remains DRAFT. M2 and later work are not authorized.

The project owner authorized continued development after approving the repository foundation on 2026-10-20. This is recorded as permission to proceed with the narrowly defined **M0 technical feasibility spike only**, not blanket acceptance of every future product, privacy, branding, or release decision.

## M0 decisions accepted provisionally

1. **Host:** Single Command Code TypeScript mod, thin host adapter, independently testable core; interactive TUI first.
2. **Interview:** M0 uses only a hard-coded question. Later model reasoning never counts as user approval.
3. **Privacy:** M0 performs no repository inspection, external model calls or telemetry. Host-backed storage persists the small test goal and confirmed answer; do not assume encryption.
4. **Operations:** Pi implements M0; real Command Code validates host behavior; Codex review is optional at this stage. No builds/tests on the constrained ThinkPad or automatic CI.
5. **M0 scope:** Register `/naildown`, show goal, ask one question, persist and resume after restart, and default-deny dummy approval. No unrelated features.

## M0 execution conditions

- Source of truth: [M0 handoff](M0_HANDOFF.md), [M0 acceptance matrix](M0_ACCEPTANCE.md), and [agent instructions](../AGENTS.md).
- Host signatures are verified against official documentation as of October 20, 2026; actual installed host version, behavior and SDK typings still require testing.
- Work in a dedicated branch; submit a PR for review before merge.
- Report each acceptance item as **PASS / FAIL / NOT RUN**, with actual evidence.
- **Stop after M0**; M1 or later requires a separate decision.

## M0 formal acceptance — 2026-10-25

- M0 status: **ACCEPTED** by the product owner on 2026-10-25.
- M0-09 remains a documented host exception (headless `-p` does not dispatch mod slash commands), not a passing test.
- Evidence: 11/12 acceptance checks on Command Code 1.84.0; 57 unit tests and typecheck passed (not rerun on 1.88.0); owner-operated interactive verification on 1.88.0 confirmed default-deny and restart persistence; source inspection found no breaking changes.
- At the time of this M0 acceptance, the full v0.1 specification remained a draft and M1 and later required separate authorization. The later, scoped M1 technical decision is recorded in [M1_ACCEPTANCE.md](M1_ACCEPTANCE.md).

## Decisions still open for full product sign-off

- Final v0.1 product behavior and question/decision state model.
- Exactly what optional repository data may be read and sent to a model, and how consent is recorded.
- Persistence migration/deletion model, security failure modes and export semantics.
- Release branding and distribution requirements.
- Full product acceptance/evaluation matrix.

See [PRODUCT_SPEC_DRAFT.md](PRODUCT_SPEC_DRAFT.md) and [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md). GitHub issue #1 remains open until the complete product baseline is accepted. This page records the historical M0 gate; the M1 decision is separate.
