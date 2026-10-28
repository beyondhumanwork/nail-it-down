# M2 Slice 3A — technical acceptance

**Decision (2026-10-28):** ACCEPTED for **isolated synthetic-workspace interactive preview only**. This is not full M2 acceptance or permission to read real repositories.

**Implementation:** [PR #20](https://github.com/beyondhumanwork/nail-it-down/pull/20), merge `9fd27a3e708a5c4a0350eb691cc8e0317e5bf7b8`; reviewed head `d13e1b2680dbb00aee98e1c95a6ee14a11e726e3`. Contract: [Slice 3A](M2_SLICE3A_CONTRACT.md).

## Verified scope

- A separate disposable `/naildown-preview` harness demonstrates default-deny consent, bounded synthetic-file inspection, up to two source-cited dependency declarations, and an idea-only refusal. It is **not installed or imported by live `/naildown`**.
- The synthetic harness creates and cleans its own fixture. No actual user repositories, existing project files or private vault documents are selected.
- An in-memory per-invocation snapshot prevents duplicate physical reads for multiple citations. The guard checks aggregate byte budget before opening another file, relying on the approved OS adapter's descriptor size consistency. The contract limits remain six files, 32 KiB per file, 96 KiB physically read in total, 250 lines per file and 100 root entries.
- Citations are derived by the existing evidence core from the same captured snapshot; no fabricated facts, full-file display, executed repository instructions, stored evidence, model calls, network requests, CI or modifications to M1 state.
- Missing, dismissed, headless, unexpected or refused consent causes no repository read; denied re-verification also causes zero filesystem metadata operations.

## Evidence

Pi reported **441/441 tests passing** and `tsc --noEmit` PASS on the MacBook against an archive of `d13e1b2`. The independent reviewer examined the exact code and tests, but did **not** rerun them. Pi also reported an isolated Command Code 1.88.0 consent-and-citation TUI re-check showing two synthetic dependencies with accurate lines, unchanged live store and no global mod installation. Initial Enter/Escape denial was tested in prior rounds but not rerun in the final round.

An over-budget six-file synthetic fixture contained 102,462 bytes of allowed filenames. After correction, the preview opened five files and physically read **81,987 bytes**, without opening the excess file; the UI correctly records `total-too-large`. Tests also cover changed-file refusal, zero-I/O denial and avoiding extra reads for additional citations. PR #20 triggered **zero GitHub Actions runs**.

## Limits carried forward

1. Parent-path replacement between containment check and file open remains a TOCTOU risk. Node's current path-based reader is **not** a general filesystem sandbox.
2. Caller-supplied `permittedParents` is not independent workspace authorization. Fixture ownership is only guaranteed within the isolated test harness.
3. The physical budget assumes the vetted reader rejects changed size before reading. An arbitrary alternative reader is not certified by the preview wrapper.
4. Snapshot citations are not live verification. Reader errors collapse into a generic unreadable category; listing errors have no distinct error channel.
5. Device nodes, cross-platform filesystems, case-folding, varied timestamp precision, and hostile concurrent mutations remain unverified.
6. The core's secret-like text scanner has a reported quadratic performance case with long homogeneous input; investigate before expanding allowed inputs.
7. Scripted host checks are not an unprompted human beta usability test.

## Authorization boundary

M2 Slice 3A is closed at a **synthetic preview feasibility** gate. **M2 Slice 3B, real-repository reads, live `/naildown` wiring, persisted consent/evidence, model calls, M3+, CI and release remain unauthorized.** The next task is a separate decision on the real-workspace threat model, trustworthy workspace selection and containment guarantees; it is not pre-approved implementation.
