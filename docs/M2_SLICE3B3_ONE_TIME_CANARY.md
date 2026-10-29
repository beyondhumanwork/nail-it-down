# M2 Slice 3B3 — one-time canary authorization and review gate

**Owner approval:** 2026-10-28. The owner explicitly authorized **one bounded, read-only invocation** against the **single pre-prepared, non-sensitive Git canary on the ThinkPad X240 running Linux**. The exact canonical path and three file hashes are specified in the owner's private conversation and the private [3B3-P preparation handoff](M2_SLICE3B3_PREPARATION.md). **Do not put the owner's home-directory path or personal machine identifiers in a public artifact.**

**Main baseline:** `758926b7218f2170bde3a6705b47faf5da895545`, prior to this authorization. **This is a separate authorization from Option A pilot development.** It neither extends to another root nor allows repeat scans, arbitrary path selection, live `/naildown` wiring, publication or release.

## Mandatory staged execution

**Stage 1 — prepare the one-time harness, but do not inspect the canary.**

- Use the existing dormant `runWorkspacePilot` and bounded reader/evidence core without weakening any checks. The existing test harness authorizes only a newly minted fixture; do not repurpose it to accept arbitrary paths.
- Prepare a **private, uninstalled, exact-root-bound** disposable Command Code `--mod` harness. Keep the owner's absolute path only in local, restricted (0600) material or private handoff—not in the public Git repository, a PR, console transcript, model context or published test output.
- Bind the authorization to the **one owner-named canonical path** and a human-verifiable inventory/hashes. Do not derive authorization from `cmd.cwd`, args, environment overrides, user input, `permittedParents`, mod trust or previous approvals. The user must still type the exact root and explicitly grant on the native refusal-first dialog.
- Inspect harness source for arbitrary-root capability, dynamic overrides, network/model transmission, persistence, shell execution, and unsafe cleanup. Run unit tests only against disposable synthetic fixtures on MacBook; do not read this prepared Git repo through the runtime reader. Lightweight installed-host API inspection is allowed.
- **STOP for independent review of the exact local harness contents and verification evidence before Stage 2.** The owner-approved one-time read is not an exemption from review.

**Stage 2 — one actual canary invocation only after independent review.**

- On the ThinkPad, freshly confirm the canonical root identity, ownership, mount provenance, unchanged three-file inventory and expected hashes **after the host's explicit grant and inside the single bounded invocation**; do not perform hidden target-root metadata or file content reads before native consent. If any check is unavailable or differs, **NO READ** and report the blocker. A hash comparison must use bytes read within the approved budget, not a second out-of-budget file read.
- The native UI must disclose the proposed exact root, seven-name allowlist, up to six selected files, 32 KiB per file, 96 KiB physically read total, 250 lines per file, 100 root entries, no-model/no-network/no-persistence guarantee and the unresolved hostile parent-swap race. If disclosure fails, refuse. The refusal choice is first; dismissal/headless/unexpected values refuse with zero target filesystem operations.
- Permit **one attempted command invocation** in the isolated local host session; do not auto-retry, auto-approve or run a second canary. Exit and unload the harness after that attempt. No installed-mod changes, no persistent consent, telemetry, evidence or project writes.
- Render evidence **only in the local human TUI**; do not pipe raw repository excerpts or absolute paths into the coding agent's model context. The private handoff should include only bounded outcome metrics, citation locations and safe verification results, not the file excerpts.
- Maintain the existing cooperative-only threat model: the Node reader cannot reliably prevent or detect hostile ancestor swaps. Local ext4 evidence is contextual, not a sandbox guarantee.
- Capture whether the independent local native consent was given, bytes and file counts, line-number validity, verified/stale/refused status, unchanged file hashes, repository Git remote absence and unchanged live M1 store. Do not silently treat a missing listing as proof of absence.

## Never authorized by this one-time approval

Any other repository or machine; a second read; using the test root to broaden authorization; live `src/index.ts` or `/naildown` integration; sending source or excerpts to a model, cloud provider or network; writing to the project; new dependencies/CI, remote Git pushes, release or M3.

## Handoff

Pi must first deliver a **Stage 1 harness-for-review handoff**, including a private exact-path binding, how it is enforced, the reviewable full source and its hash, synthetic-only test results, and explicit **NOT EXECUTED** status. After independent review, a separate Stage 2 execution prompt may be issued. Neither this file nor the prior owner's chat approval is proof that the runtime canary has been run.
