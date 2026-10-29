# M2 Slice 3B1 — Real-workspace threat-model decision and secret-scanner hardening

**Authorization:** APPROVED for **Slice 3B1 only** — 2026-10-28.  
**Baseline:** `main` at `19193497709304256dac3726bad845b644939a2b` after [M2 Slice 3A acceptance](M2_SLICE3A_ACCEPTANCE.md).  
**Historical authorization:** This document authorized design/research and narrow scanner hardening only. **Current disposition:** implementation technically accepted on 2026-10-28; see [M2 Slice 3B1 acceptance](M2_SLICE3B1_ACCEPTANCE.md). The [security decision memo](M2_REAL_WORKSPACE_SECURITY_DECISION.md) remains PROPOSED and no owner risk acceptance or live repository pilot is authorized.  
**No authority to read a real project repository at runtime, including the Nail It Down checkout, or to wire filesystem access into `src/index.ts`.**

## Why this gate exists

M2 Slices 1–3A show a consented, capped, source-cited filesystem preview **only against generated synthetic fixtures**. The OS reader still has a parent-component replacement race because root validation and path-based open are not atomic. `permittedParents` is caller-supplied and is not an independent trust anchor. The installed Command Code host v1.88.0 is not a filesystem sandbox and does not currently expose a mod-callable built-in read tool. Do not confuse Command Code's project-mod trust prompt (which does not gate user-scope or `--mod` mods) with Nail It Down's own file-reading consent.

The current core also has an observed pathological cost in its long-base64-like secret pattern:
`/(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[0-9])[A-Za-z0-9+/]{40,}={0,2}/`.
The repeated unanchored lookaheads may re-examine long homogeneous input. This must be characterized and corrected before permitting wider project data exposure.

## Deliverable A: decision-grade threat model — **no runtime integration**

Create `docs/M2_REAL_WORKSPACE_SECURITY_DECISION.md` in the feature branch, clearly marked **PROPOSED / owner and independent-review acceptance pending**. Assess these options:

1. **Recommended candidate for v0.1:** Opt-in read-only inspection of **cooperative, user-controlled local workspaces** with explicit per-invocation selection and consent. No claim to resist an attacker concurrently replacing an ancestor directory, modifying files maliciously, or operating inside an untrusted repository. Insecure/uncertain roots -> idea-only. No network or model transmission.
2. **Stronger isolation:** Platform-specific OS-enforced containment / directory-fd-relative access / isolated process, if protecting against hostile concurrent path replacement is a product requirement. Research actual supported APIs and cost/portability; do not implement this or introduce native addons, subprocesses, packages, privileges, containers or daemons in Slice 3B1.
3. **Idea-only fallback:** Defer all real repository reads until stronger guarantees exist.

Document explicitly:
- Protected assets (private source, credentials, user consent, local filesystem, resulting citations and potentially future model context).
- Trust boundaries and threat actors (trusted developer, other local processes, untrusted git checkout content, dependencies, symlinked/nested roots, mounts, network filesystem, adversarial concurrent writers); say which are **in scope** and **out of scope** for the recommended candidate.
- How a *future* runtime would obtain the workspace root: `cmd.cwd` is a host-supplied string, **not authorization**. Propose an explicit user-facing root display/confirmation before any filesystem metadata or candidate-file read, with realpath/identity validation **after** consent. Refuse unclear, symlinked or swapped roots, or any root not specifically allowed by the chosen trust model. Do not persist consent or silently re-use it.
- Consequences of project vs user-scope vs `--mod` loading. Command Code's host trust gate does not replace consent to read.
- A **no repository-to-model transmission** policy. Local reading consent does not authorize model disclosure. No shell, network, file writes, transcript excerpts or persistent evidence in this stage.
- Exact allowlist and ceilings from M2 Slice 3A (6 files, 32 KiB/file, 96 KiB physically read, 250 lines/file, 100 root entries) and honest stale/unreadable/error outcomes; the current line-budget is **post-read** whereas physical-byte bound is pre-read.
- Parent-swap TOCTOU, descriptor checks, path-inode/time stamp limits, alternate-reader physical cap assumption and the lack of an error channel for `list`. Recommend mitigations inside the cooperative threat model, and identify risks that **cannot be eliminated** without OS-enforced containment. **Do not label a detection strategy race-free.**
- Platform-specific evidence (installed Node, Command Code 1.88.0, Linux/macOS gaps), authoritative current Node and host docs with URLs/dates, and whether `openat`/dirfd or equivalent is *actually exposed* by the installed runtime. No guessing.
- A **decision table** scoring options by user value, operational complexity, portability, risk, and build/test cost; concrete recommendation, accepted-risk language, **go/no-go criteria** for a later opt-in pilot, and unresolved questions (no more than 5).
- Reproducible **future** negative tests on owned **synthetic fixtures only**: refused consent before metadata, canonical path disclosure, root/parent replacement, casefold/symlink/mount ambiguity, error vs empty listing, device/FIFO behavior and provenance staleness. Do not create hostile races against a real project.

This document is a recommendation, **not** authorization to read real repositories. The separate owner's runtime pilot gate must decide what threat model to accept.

## Deliverable B: one bounded secret-detection performance fix

Implement a **small, focused change** to `src/core/discovery.ts` and `test/discovery.test.ts` (and a small dedicated test file only if justified), removing pathological repeated scans on long homogeneous synthetic input. Avoid rewriting the complete discovery policy.

- First reproduce/measure the reported slowdown using bounded synthetic 1–32 KiB text with instrumented elapsed time and growing input sizes; use no real source files or actual secrets.
- Identify precisely which pattern(s)/path(s) cause superlinear behavior, including `containsSecretLikeContent` **and** `redactSecrets`. Consider a deterministic, near-linear tokenizer/scanner for candidate base64 runs instead of multiple unanchored lookaheads; keep other secret patterns and their semantics unless test evidence requires a narrow change.
- Preserve detection and redaction for fake AWS/GitHub/OpenAI/Slack/JWT/private-key tokens and valid long mixed-case+digit base64-like candidates. Preserve the regression that a long single-character string is **not** a credential solely because of its length. Check both detection and redaction equality at boundaries and repeated/multiple tokens.
- No secret disclosure in test output. Secret detection is defense in depth, **not a guarantee** that arbitrary real credentials are filtered.
- Tests must demonstrate a meaningful improvement on long homogeneous runs without relying solely on flaky millisecond thresholds; record scaling measurements as supporting evidence, not a cross-hardware performance promise. Include near-ceiling real policy selection with synthetic text to ensure no semantic regression.
- Preserve the **441-test** baseline, run discovery-focused tests, full suite and `tsc --noEmit` on the authorized **MacBook** against exact committed tree; ThinkPad only source work/read-only inspections, no heavy tests. No GitHub Actions or new dependencies.

## Not authorized

No change to `src/index.ts`, existing Command Code mod UX, active M1 sessions or persistence, host config, installed mods, user project files, runtime filesystem reader or consent adapter, synthetic preview composition, external model/provider calls, CI, network calls, shell execution at runtime, release, or M2 Slice 3B2 / M3+. Do not run scanner benchmarks on live/private repository contents. Use synthetic fixtures only.

If the performance fix requires broader changes, report the blocker and stop instead of silently expanding permission.

## Git workflow, acceptance, handoff

Pi works on `feat/m2-slice3b1-threat-model-and-scanner` from merged main, makes only the security decision memo and narrow scanner/core tests, commits and pushes if BHW policy permits, **no PR or merge**. ChatGPT independently verifies the decision memo and code/test results before PR. Code work must not modify any real repository's project contents, beyond the authorized Nail It Down source edit itself.

Save full and short dated Markdown handoffs under `/home/ahmed/limitless/Shared/agent-output/nail-it-down/`, using existing nonblocking Desktop/Limitless GitHub mirror. No sleeping, polling, manual bridge, cron or Actions.

**Acceptance criteria:** evidence-backed explicit recommended threat model, real-workspace go/no-go gate, full preservation of security semantics, scaling improvement documented, 441 previous tests green plus targeted new tests, TypeScript clean, no user repository reads, no host changes, no CI. If uncertainty remains about a material OS guarantee, mark it **NOT PROVEN**.

**STOP after 3B1.** Independent review may accept a design and performance fix; it **cannot** authorize live-project access without a subsequent explicit owner go-ahead for a small runtime pilot.
