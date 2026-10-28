# M2 Slice 3A — isolated interactive evidence preview

**Decision:** APPROVED for M2 Slice 3A only — 2026-10-28.  
**Verified baseline:** `main` at `3a43ca00dc7c96984bcf0a894f4997bdcae622ed`, after [M2 Slice 2 synthetic acceptance](M2_SLICE2_ACCEPTANCE.md).  
**Goal:** Demonstrate the complete interaction: **explicit consent → bounded OS read of a disposable synthetic project → mechanically verified evidence → human-readable TUI result**, with a refusal/idea-only alternative.

This is a working UX demonstration, **not authorization to inspect a real repository**, production integration, generalized safety claims or a model-assisted agent. No changes to installed/global Command Code mods.

## What to implement

- A small, testable composition layer, e.g. `src/host/repositoryPreview.ts`, consuming the **existing** `requestRepositoryReadConsent`, `createNodeRepositoryReader`, `selectCandidates`, `declaredDependencyEvidence` and `reverifyEvidence`. Don't duplicate policy, credential filters, evidence extraction, budgets or consent rules.
- A **test-only** or disposable `--mod` harness that registers a distinct preview slash command (e.g. `/naildown-preview`) **only in an isolated Command Code process**, never in `src/index.ts` and never in the installed `/naildown` mod. The test harness must mint/own the synthetic workspace within a dedicated `mkdtemp` parent. Both its absolute root and the only permitted parent are provided by the harness, **never by an arbitrary slash argument, `cmd.cwd`, project config, environment variable, or stored user-controlled record**. Caller-supplied `permittedParents` is not proof of trust.
- The preview should display an understandable default-deny disclosure, what is read (fixed root allowlist, at most 6 files, 32 KiB each, 96 KiB total, 250 lines/file, 100 root entries), and explicitly **no content sent to a model or external provider**. Only the exact affirmative label permits opening the synthetic reader. Dismissal, refusal, headless, unavailable UI and malformed selections must cause zero **candidate-specific reads**; test the zero-read contract.
- After consent, display a **small deterministic summary**: selected root filenames and safe high-level status, one or two real mechanically verified dependency declarations from synthetic `package.json`, each with workspace-relative path and one-based line span. Any excerpt must be bounded/redacted, and no entire file content must be surfaced. Do not invent features or negative facts from a bounded scan.
- Missing/unreadable/oversized/changed/unsafe evidence must be shown as unavailable, stale, or unverified, not silently treated as a confirmed absence. Idea-only/refused flow must work with no filesystem access and no stored consent. Consider re-verification of an already captured synthetic evidence item after a deliberately changed synthetic manifest; no fake citations.
- Keep the UI simple: native `ModUi.select` and ordinary command result text; no custom panes, model turns, indexer, new persistence or generic plugin framework. Keep `src/index.ts`, `src/core/discovery.ts`, existing M1 session, approval and storage modules untouched.

## Security and runtime gate

- **Synthetic roots only:** all preview fixture bytes are generated in and owned by the test harness. Never use the Nail It Down checkout, another user project, home directory, private vault or global Command Code state as the read target.
- The existing OS reader has unresolved parent-component swap TOCTOU, caller-controlled `permittedParents`, single-platform evidence, timestamp precision limits, possible list-error-as-empty semantics, and no demonstrated device-node fixture. Keep these limitations in UX/reporting and never claim a secure general-purpose filesystem sandbox.
- The UI must not accidentally allow reads from other processes through arbitrary text arguments, environment overrides, stored state or implicit current working directory.
- No persistent evidence, raw source content, selected paths, preview sessions, telemetry or consent. Do not send project context to a model, call shell or network from runtime source, trigger agent turns, or write into a real workspace. Test harness may create and safely clean up **its own** disposable files only.
- Preserve the M0/M1 runtime `/naildown` behavior and all **399 existing tests**. No new runtime dependencies, GitHub Actions, scheduled CI, release or publishing.
- If isolated real-host loading cannot be proven without reading real private paths (e.g. the current workspace), STOP that verification and label it NOT VERIFIED instead of touching live state.

## Acceptance evidence

1. Unit/integration tests: default-refusal, explicit yes, dismissal, unexpected answer, headless and thrown dialog, with zero reader reads without grant.
2. Synthetic-root provenance, no path override from arguments/`cmd.cwd`/untrusted config, and clear response on invalid fixture roots.
3. Positive result is attributable to actual synthetic JSON declaration and correct path/line; unsupported statements do not become verified evidence.
4. Negative fixtures: no `package.json`, malformed JSON, secret in allowed file, symlink, oversized file, over-budget listing, unreadable file, stale/changed dependency, and denied consent.
5. No private path/secret/raw file text leaks into output; displayed copy distinguishes refusal, no match, not verifiable and stale where appropriate.
6. Real Command Code 1.88.0 TUI observation if safely isolated using disposable `--mod` only: refusal first, Enter refuses, explicit yes displays cited synthetic fact, Escape refuses, no installed mod changes, no M1 state touched.
7. On the MacBook, test the **exact committed tree** with targeted tests, full suite and `tsc --noEmit`; report actual counts, OS and Node version. ThinkPad: lightweight TUI observation only, no builds/typechecks/unit suites.
8. Confirm unchanged preexisting implementation files and tests, no model/tool calls, no network/CI, and no repository modifications except authorized source/tests and this approved documentation.

## Git, reporting and stop

Work on `feat/m2-slice3a-interactive-preview` from the verified merge base. Commit and push if BHW policy permits; don't open a PR or merge. Save full/short dated Markdown reports to the existing `Shared/agent-output/nail-it-down/` Limitless path, using the existing non-blocking Desktop/GitHub mirror (no polling/manual bridge). Report exact verified host behavior, test evidence, risks, and proposed next gate.

**STOP after Slice 3A.** Real-repository access, live `src/index.ts` integration, M2 Slice 3B, M3, model calls, runtime filesystem sandbox claims, general CLI exposure, persistent evidence, CI and release remain unapproved.

## M2 Slice 3B decision (NOT authorized by this contract)

Separately evaluate (a) explicit bounded access under a **clearly restricted cooperative local-workspace threat model**, and (b) stronger OS-enforced containment (platform-specific/isolated process) if hostile concurrent directory replacement must be defended against. No assumption that Node `realpath` + `O_NOFOLLOW` closes parent swaps; no native addon/process/install may be introduced without new approval. Record security tradeoffs and executable negative tests before any live-workspace enablement.
