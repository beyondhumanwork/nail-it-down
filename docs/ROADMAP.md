# Roadmap

**Status: proposal.** Milestones are acceptance-gated, not calendar commitments.

| Milestone | Outcome | Gate |
| --- | --- | --- |
| M0 | Host feasibility: load mod, one question, durable answer, default-deny approval | Verified real TUI evidence and restart persistence |
| M1 | Deterministic interview state and dependency graph | Unit tests for invalidation and explicit approval |
| M2 | Optional bounded repository context | Consent, secrets, symlink, path and strict physical-byte ceilings; distinguish listing failures from empty; independently authorized root selection; dormant synthetic integration evidence before any live host wiring |
| M3 | Typed, validated model-assisted questions | Schema/refusal/cost/failure recovery tests |
| M4 | Decision review and Markdown output | Human review and reproducible content tests |
| M5 | End-to-end quality and comparison with baseline | Host test evidence, regressions documented |
| M6 | Packaging and beta publication | Rights audit, tested install, explicit owner authorization |

**Current M2 note (2026-10-28):** 3B3 reached a qualified one-time technical pass, not full milestone acceptance. An actual global input-history write occurred despite `--no-session`. M2-4 is approved for synthetic-only development; normal `/naildown` integration and any further real-workspace read remain gated. See [3B3 closeout](M2_SLICE3B3_CLOSEOUT.md) and [M2-4 contract](M2_SLICE4_CONTRACT.md).

See [architecture](ARCHITECTURE_DECISIONS.md), [M0 instructions](M0_HANDOFF.md), and [draft product specification](PRODUCT_SPEC_DRAFT.md).

Features, scope and sequence may change based on host feasibility and evaluation results. No estimated shipping date is promised.
