# M2 Slice 3B3-P — Real-canary preparation only

**Status:** authorized for **preparation**, 2026-10-28. A real workspace read is **not yet authorized**.

**Baseline:** [M2 Slice 3B2 acceptance](M2_SLICE3B2_ACCEPTANCE.md), main `d735468b2da17fe1002b692721a3ffdaa4131dae`. The owner said to proceed to the next canary step; this contract intentionally does **not** interpret that as approval to inspect an as-yet-unverified directory. The owner already accepted cooperative Option A for pilot development ([decision](M2_OPTION_A_DECISION.md)).

## Goal

Prepare a small, disposable, genuinely initialized **local Git repository** on the ThinkPad (Linux), containing **only newly written, synthetic, non-sensitive data**. This will be the candidate for a separate, explicitly approved, single-invocation real-root canary using the existing dormant `workspacePilot.ts`. It is distinct from the pilot's `mkdtemp` harness fixture and from every existing BHW project.

The proposed path is under the operator's own local, user-controlled test-output directory. **Do not commit a personal home path, private directory contents or machine identity to this public repository.** The exact canonical path, owner, permissions, filesystem type and expected file hashes must be established by local preflight and reported privately before any read authorization is requested.

## Scope permitted now

1. Verify exact merged main, clean worktree and no unexpected local changes; don't modify installed `/naildown`.
2. Examine **metadata only** for the proposed test-output parent. Verify the dedicated candidate path is **absent** before creating it. If it already exists, stop; do not reuse, inspect, overwrite or delete it.
3. Create one owned directory (restrictive permissions), initialize a local Git repository **with no remote** and write minimal known synthetic `README.md`, `package.json` and `AGENTS.md` content. Their source is authored solely for this canary; do not copy real source files, credentials, local settings or vault data.
4. Record canonical path, OS/Node/Command Code versions, mount-type evidence, directory identity, root-file inventory and hashes of these **newly created synthetic files**. Filesystem-type data is context, **not proof** of local/trustworthy storage. If mount provenance is uncertain, STOP before any canary read.
5. Prepare a plan for a **future** one-time, noninstalled, exact-path-authorized `--mod` harness. It must remain disabled and unexecuted. A typed path, environment variable, `cmd.cwd` or command argument can never widen its authorization. Do not add a general arbitrary-root reader.
6. Save a concise, dated preparation handoff in the existing Limitless vault/agent-output path, with nonblocking mirror sync. Do not persist credentials, copy project contents, push the test repository to GitHub or run GitHub Actions.

## Outside this phase

**No invocation of the Node repository reader against the prepared Git directory.** No loading or running a `--mod` that authorizes that directory, no file-read consent dialog, no actual real-root scan, no model/provider transmission, telemetry, source/evidence persistence, real project access, modifications to `src/index.ts`, installed mods, M1 or M3. No heavy test suite on the ThinkPad, no CI, no deployment. No deletion or cleanup of any path that wasn't created in this preparation step.

## Mandatory next approval

After preparation, propose the **exact canonical absolute path and platform** to the owner, together with the observed local mount and the hash/inventory record. An explicit *second* user approval must name that path and allow **one** bounded read of that one repository. Only after that approval may a separately scoped canary harness/contract be used, with native refusal-first consent inside Command Code as an independent requirement.

If any prerequisite fails, remain in idea-only/synthetic mode and report the blocker. This preparation contract is not proof that a real-workspace canary was run.
