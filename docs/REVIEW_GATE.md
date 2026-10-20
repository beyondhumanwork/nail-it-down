# Architecture review gate

**Status:** Open — product-owner sign-off required before Pi begins M0.

This repository contains *proposed* planning documents, not a frozen release contract.

## Decisions proposed for approval

1. **Host:** Build a single Command Code TypeScript mod, with a thin host adapter and deterministic, testable core. Interactive TUI first.
2. **Interview:** The LLM may suggest questions and prose, but only explicit user actions can create decisions and approval. Later changes invalidate affected approvals.
3. **Privacy:** No repository reads at invocation by default; bounded, consent-based inspection later. Host provider receives disclosed prompts/snippets; no separate backend or telemetry.
4. **Operations:** Pi implements; Codex reviews key milestones; Command Code is the integration target. No builds on the low-power ThinkPad or automatic CI on pushes.
5. **M0 scope:** Load the mod, register `/naildown`, ask a hard-coded question, persist confirmed answer through restart, and default deny approval. Nothing else.

## How to approve

Review [product draft](PRODUCT_SPEC_DRAFT.md), [architecture](ARCHITECTURE_DECISIONS.md), and [M0 handoff](M0_HANDOFF.md). Record any changes in an issue or PR. Once agreed, update status and date in the relevant documents, then explicitly authorize M0 implementation.

**Until then: no implementation assignment or claim that the specification is approved.**
