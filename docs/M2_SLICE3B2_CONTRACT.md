# M2 Slice 3B2 — Dormant workspace pilot contract

**Authorized:** 2026-10-28, after owner approval of cooperative Option A and merged [decision](M2_OPTION_A_DECISION.md) in PR #25.  
**Baseline:** `c636e38726f3540e7ebd54d01dc1cf824b0bb2e0`.  
**Scope:** Implement and test a **dormant, independently loaded, synthetic-fixture-only** workspace-selection and evidence prototype. This is not permission to read a real project.

## Implementation

Create a small controller such as `src/host/workspacePilot.ts` and a disposable Command Code `--mod` test harness. Leave `src/index.ts`, the installed `/naildown`, M0/M1 state, evidence policy, OS reader and existing preview unchanged except for a narrowly justified compatibility fix explicitly reported. Reuse the existing reader, refusal-first consent, single-invocation bounded snapshot and source-cited evidence. Do not duplicate the dependency parser.

The harness must create and own **one disposable synthetic workspace** and enforce an exact-root authorization. A typed path, CLI argument, `cmd.cwd`, environment variable, persisted preference or caller-supplied `permittedParents` alone cannot authorize a different root. No reading actual user/SaaS projects or the Nail It Down checkout with the runtime reader, even if entered or consented.

Before **any target-root metadata call**, the pilot must display the exact proposed lexical absolute root, the allowlisted root files, four budgets, exclusions, local-only/no-model/no-persistence commitments and the parent-directory swap race disclosure, then present a native **refusal-first** explicit consent choice. Verify the real Command Code 1.88.0 `ui.input` API before using it. Default Enter, Escape, headless, refusal, malformed selections and thrown dialogs refuse with **zero target-root filesystem operations**. Consent expires when the invocation ends.

Only after consent and fixture authorization may the pilot resolve/check the root; refuse missing, symlinked, replaced, unexpectedly canonicalized, unsupported or ambiguous targets. Treat cloud-sync and remote-mount status as **NOT VERIFIED** unless a real guarantee is demonstrated; `statfs.type` does not establish trust. Do not assert the reader is a sandbox: the hostile ancestor-directory replacement race remains unprevented under Option A.

Preserve policy limits: **six allowlisted root files, 32 KiB/file, 96 KiB total physical reads, 250 lines/file, 100 shallow entries**. Display up to two mechanically verified dependency citations from one per-invocation snapshot; no fabricated absence, no whole-file content. Unreadable, stale, unsafe, changed and unknown-listing outcomes fail closed or explicitly say unverified. Idea-only continuation works without reading.

## Tests and handoff

Use **only harness-owned synthetic fixtures**. Test root/consent disclosure, zero-operation denial (including metadata), path override attempts, canonical-root surprise, root replacement, safe symlink/FIFO/nonregular refusal, limits, secret-like synthetic content, source citation accuracy, stale provenance, error-vs-empty ambiguity, cleanup and unchanged M1 storage. Record limitations if impossible to distinguish errors under the existing reader interface. Maintain all **452 baseline tests**, run full suite and `tsc --noEmit` on **MacBook**, no heavy test/build on ThinkPad. Optional isolated Command Code 1.88.0 TUI smoke test may inspect synthetic fixtures only.

No new dependencies, runtime subprocesses, model or network requests, telemetry, stored consent/evidence, workspace writes, CI, releases, installed mod changes or M3 work. Write full and short dated handoffs to the established Limitless vault path, with nonblocking mirror sync.

Pi branch: `feat/m2-slice3b2-dormant-workspace-pilot`; commit/push, **no PR or merge**. Stop for independent review.

**Next gate:** A *separately authorized* real-repository canary requires the owner to identify the exact path/platform after a clean review. This document does not name or approve one.
