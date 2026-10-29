# M2 Slice 3B3 — Operator-observed canary result

**Recorded 2026-10-28. Status: OPERATOR-REPORTED RUNTIME PASS; METADATA-ONLY OPERATIONAL CLOSEOUT PENDING.**

This document records the **one permitted invocation** of the privately named, harmless Git canary under [the 3B3 one-time authorization](M2_SLICE3B3_ONE_TIME_CANARY.md). It deliberately omits the owner's absolute path, host identity, repository excerpts, and private file digests. The owner's report and the private vault reports are the detailed evidence. No second read is authorized.

## Observed result

The owner supplied the local Command Code TUI result for the one-time canary. It showed:

- Outcome: **CONTENT WAS READ — INTEGRITY VERIFIED**.
- **Three** allowlisted root files read; **two** dependency declarations cited with precise `package.json` line spans.
- **Eight hard checks reported ok**: canonical root identity; three prepared file digests; no unexpected file read; exactly three files; non-symlinked root after read; and correct user ownership.
- Risk caveats still displayed: not a sandbox; hostile concurrent ancestor-directory replacement is not reliably detected or prevented; mount trust unverified in the reader; listing failures can look empty; secret detection is defence in depth.
- The pre-read root/mount gate necessarily returned an approval for the read path to proceed, but its internal result was not separately recorded in the operator's excerpt.
- The exact physical byte count was **not** printed in the observed result. The preparation report lists 917 total bytes for the three files, which is an **expectation, not an observed physical I/O measurement**.

The one-time authorization is **consumed even if post-run metadata verification finds a problem**. Do not re-run, reload or invoke the canary again without a separate owner approval.

## Verification basis and limits

Before execution, Pi reported verifying the local implementation, private harness hashes, isolation flags and unmodified installed mod; its private Stage 1 review was independently inspected. The operator's submitted result is an **operator observation**, not an independently recorded terminal trace. The observed output establishes the displayed verdict and citations; it does **not** establish process exit, absence of later prompts, post-run mod-store integrity or a durable one-shot latch.

The one-time harness and two additive digest/pre-read-gate commits remained **private/local-only**, not pushed or merged into the public repository. `src/index.ts` and the installed `/naildown` were not integrated with the canary.

The operator supplied limited text from the synthetic canary to a ChatGPT conversation afterward. That is distinct from a runtime model submission by the mod; do **not** interpret this test as proof that any future private code is safe to paste into a model.

## Required metadata-only closeout

A subsequent local agent may inspect **only non-canary process/configuration metadata** (e.g. whether the isolated host exited, the live mod-store hash and mtime against its recorded baseline, and whether the reviewed local files remain unmodified). **Do not** run the canary, open/rehash/scan/stat the canary root, resume the host, request consent, capture or replay repository excerpts, or inspect any other real repository. If process exit or a second invocation cannot be independently proven, mark them **NOT VERIFIED** and record the operator's attestation separately.

Save a private, dated closeout report that distinguishes observed outcomes, independently checked metadata, and unknowns. Report no new unit tests if none ran; do not trigger CI.

## M2 milestone boundary

The canary supports the feasibility of bounded, consented repository context on one cooperative Linux host for one harmless prepared repository. **M2 is not accepted as a whole**: the pilot remains dormant, normal `/naildown` integration is not authorized, arbitrary-root provenance/consent is not designed or approved, and the current cooperative security limitations remain. No new real-repository reads, model transmission, persistence, M3, or release are approved.
