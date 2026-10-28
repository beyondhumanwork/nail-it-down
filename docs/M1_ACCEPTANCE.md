# M1 technical acceptance — deterministic interview

**Decision:** ACCEPTED for the scoped M1 technical milestone on 2026-10-27.
**Type:** Engineering acceptance, not beta sign-off, release authorization, or approval of the full v0.1 specification.
**Authoritative merged implementation:** [PR #12](https://github.com/beyondhumanwork/nail-it-down/pull/12), merge commit `6f7126e14f76703a9a6faadeaab637eb0365b55e`.
**M2 and later:** Not authorized by this decision.

## What was accepted

M1 meets the [roadmap](ROADMAP.md) gate: deterministic invalidation and explicit approval are tested in the core and demonstrated through the real Command Code host. The narrow implementation includes:

- A validated, versioned interview schema, with a three-decision graph and deterministic prerequisite-aware question selection.
- Recorded user-confirmed answers; revisions and transitive stale-answer invalidation; explicit reconfirmation; noncritical deferral; pause/resume.
- Readiness calculated separately from explicit approval. The default choice in the native approval dialog is refusal. Undecided answers, assumptions and unresolved critical decisions cannot authorize approval.
- `session.v2:<workspace>` persistence, while preserving legacy `session.v1:<workspace>` records. M0's dummy approval is never promoted to M1 approval. Starting fresh or migrating requires an explicit selection.
- Defensive persistence error handling: a rejected write attempts to restore the exact previous raw value, including unreadable data. If rollback also fails, the user is told the saved state is uncertain.

The M0 baseline was previously accepted. M1 Slices 1–4 are now merged through PRs #9–#12.

## Verification evidence

- **Commit reviewed:** `11b55af9d2e9fd20bd4d3fc519e841b1e21cfe53`, the final corrected Slice 4 head.
- **Automated tests:** 239/239 passed; TypeScript `tsc --noEmit` exit 0, as executed and reported by Pi on the MacBook against a `git archive` of that exact commit. The independent reviewer examined the source and regression tests; the reviewer did not separately rerun the test commands.
- **Real-host evidence:** Command Code v1.88.0, isolated Linux/TUI smoke tests driven through tmux. Observed root/dependent ordering, deferral behavior, pause, native refusal-first approval, persisted status after restart, explicit approval, revocation on revision, and retained M0 keys. The final correction round also observed the unreadable-M0 keep/fresh dialog: default keep made no v2 record; explicit fresh preserved the v1 record.
- **Failure-path evidence:** Fake-host tests cover rejected writes, restoration of prior valid and unreadable records, rollback uncertainty and previously approved-session messaging.
- **CI:** No GitHub Actions runs or workflow changes for the implementation/merge.
- **Detailed reports:** Private Limitless vault, `Shared/agent-output/nail-it-down/2026-10-27-m1-slice4-implementation-handoff.md` and `2026-10-27-m1-slice4-review-corrections.md`. Reports are mirrored asynchronously; their availability is not a merge gate.

## Accepted limitations and release conditions

The following are *not* represented as passing checks:

1. **Real-host fault injection absent.** The new migration keep/fresh interaction was observed on Command Code 1.88.0, but raw-rollback and failed-approved-edit scenarios were exercised only with the fake host.
2. **Headless M0-09 remains.** Headless slash-command dispatch is unsupported in the tested host; fake-host tests do not change this limitation.
3. **No cross-process storage transaction.** Writes are serialized inside one mod process; two Command Code processes on the same workspace are not proven race-free.
4. **No runtime syscall trace for AC20.** No model, repository, filesystem or network operations were established through code inspection/static tests, not an instrumented OS-level negative test.
5. **Unprompted human usability check remains.** The TUI smoke test used scripted keystrokes in a real host, on one host version. A person must complete an unprompted interactive session before any beta.

Additional scoped limitations: no public installer or release; no repository inspection, consented evidence reader, model-assisted questions, Markdown export, or production privacy claims. Those belong to separately approved later milestones.

## Authority boundary

This record closes the *M1 technical* gate only. It does **not** authorize M2/M3/M4, publication, CI setup, host upgrades, global configuration changes, or a general product launch. The draft full product specification and its broader privacy, model and export choices remain open.

Source-of-truth details: [AGENTS.md](../AGENTS.md), [Roadmap](ROADMAP.md), and the historical [M0 review gate](REVIEW_GATE.md). GitHub issue #1 remains open.
