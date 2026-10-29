# M2 Slice 4 — Dormant synthetic-only root selection and reader correctness

**Owner authorization (2026-10-28):** scoped implementation and tests **only**, after 3B3 closeout. Authorizes one review PR for the two local-only 3B3 commits, plus an investigation and smallest-necessary implementation of reader listing and physical-byte accounting, and a separate synthetic-only M2-4 prototype. **No merge without further explicit approval.**

**Baseline:** public `main` at authorization: `621321e4509b86fd17cb9bfb1a984479335fcae2`. Consult `AGENTS.md`, [3B3 closeout](M2_SLICE3B3_CLOSEOUT.md), [3B2 acceptance](M2_SLICE3B2_ACCEPTANCE.md), and [Option A](M2_OPTION_A_DECISION.md).

## Stage 0 — Preserve and review existing local commits

- Preserve and inspect `a20a98fb057a76e5604e2e4f1fee474dfa74dea3` (additive digest) and `5201b14423c8ed909dc88ee335563c91af56de54` (pre-read gate), and the untracked reviewer patch.
- Verify origin, diffs, scope and test evidence. **Create a focused review PR** for these exact commits after pushing the already reviewed source branch; no unrelated changes and no merge. Do not publish the owner's private canary harness, absolute filesystem paths, source excerpts or test fixture hashes. Do not rewrite the branch or force-push to hide provenance. If provenance differs, STOP and report.
- The code PR is a review artifact, **not** permission to integrate or execute the canary.

## Stage 1 — Listing errors and physical-byte accounting

**Listing:** `RepositoryReader.list('')` currently returns `readonly ReaderEntry[]`; the OS adapter can map a failed directory enumeration to `[]`, which is indistinguishable from an actually empty directory. Prefer a discriminated **success/failure listing result** propagated through the pure domain selector, snapshot cache, OS adapter and the preview/pilot. A failed or incomplete list must never produce an absence claim, successful inspection or authorized candidate reads; it must fail closed with a bounded, non-sensitive reason. A genuinely empty, successfully enumerated directory remains distinguishable. Use synthetic injectable filesystem/reader failures; no real-repository test.

**Physical bytes:** the preview's snapshot currently accounts successful returned `ok` buffers, not bytes consumed by an `fs.readSync` that later returns a refusal (changed file, short read or read error). Audit and implement a **single-invocation aggregate physical-byte ceiling** that includes all positive underlying OS read counts, even when a file is rejected after reading. Preserve `maxFileBytes=32 KiB`, `maxTotalBytes=96 KiB`, max files/lines/root entries and the seven-name allowlist. Never claim the ceiling is physical if measured bytes are merely successful selected bytes. Instrument/simulate short reads, file growth and read errors; if the design cannot enforce a bound across the pipeline without a structural change, explain it and stop before a misleading implementation. Reject old/unobservable injected readers' accounting or qualify what the contract actually guarantees; do not silently overclaim.

**History/privacy investigation:** independently inspect the installed Command Code **code or documentation**, not the owner's `history.jsonl` contents. Determine where global input history is written, whether `--no-session` covers it (observed: it does not), and whether an actually supported way to disable or isolate history exists in version 1.88.0. Probe only with synthetic commands in a disposable host profile if possible, without real repository reads, private-history inspection, model turns or persistence of sensitive material. If no verified mitigation exists, report **NOT VERIFIED** and preserve the unresolved privacy gate. Do not patch Command Code itself under this authorization.

## Stage 2 — Dormant root-selection prototype (synthetic only)

- Use a **harness-created, owned, disposable synthetic workspace** as the ONLY permitted root. The general module must not embed a specific real-workspace path, and a human-typed root, `cwd`, CLI args, environment variables, ambient configuration, `permittedParents` or consent text **alone** cannot establish the independent authorization to inspect a different target.
- Decouple **proposal** from **authority**: a native human input supplies an exact lexical root proposal; the isolated harness supplies a separate exact-root authorization scoped to its own fixture. The proposed root must match the harness-owned authorization **before any metadata read of the proposal**.
- After displaying the exact root, allowlist, budgets, local-only privacy commitments and race limitation, request separate **explicit refusal-first native consent**. Missing/disappearing UI or malformed consent refuses with zero target-root filesystem operations. No implicit auto-consent.
- After grant, re-use accepted canonical-root validation, pre-read gate (where applicable), bounded reader, source citations and strict inventory/evidence result handling. No evidence if required integrity checks fail. No model/provider submission, no source/evidence or consent persistence. An idea-only path works without a repository read.
- The synthetic harness must provide a second, different fixture to verify **arbitrary typed roots are refused**, not silently accepted. The harness may authorize its **own** fixture; do not turn the proposed root into a general authorization by merely deriving `permittedParents` from it.
- Leave `src/index.ts`, installed `/naildown`, M1 persistence/session format and the private one-time 3B3 harness unchanged. Keep M2-4 dormant behind an isolated opt-in test harness. No real repository, including the prepared canary, may be inspected through this prototype.

## Tests and review gates

- Unit tests and typecheck on MacBook (not resource-intensive tests on ThinkPad); optional lightweight isolated Command Code 1.88.0 synthetic-fixture TUI checks.
- Explicit test cases: default-deny/dismissal/headless; zero metadata/read on refusal or wrong proposal; absent `notify`; canonical-root surprise; ownership/mount/pre-read refusal; listing throws/fails mid-iteration versus genuinely empty; physical bytes consumed then rejected; budget exhaustion; strict no-excerpt-on-failed-verification; no source persistence/model prompt; unaffected M0/M1.
- Record exactly which tests ran and separately mark OS/host behaviors NOT VERIFIED. Do not infer platform parity from Node mocks.
- No CI, Actions, new paid dependencies, npm publication, deployment, release, production integration, M3/model calls, or other real-root canaries.
- Stage 0 PR and M2-4 PR **remain unmerged for independent review**. If a public code artifact would reveal the private canary path or payload, STOP rather than publish.
- Save full and short dated private handoffs with implementation evidence, decisions and remaining risks. Stop after submission for independent review. **This authorization is not M2 completion or general repository-read authorization.**
