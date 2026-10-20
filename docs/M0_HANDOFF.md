# Pi implementation handoff — Nail It Down, Milestone M0

**Status:** AUTHORIZED FOR M0 ONLY (2026-10-20). Repository foundation merged; full v0.1 product specification remains a draft.  
**Milestone:** Host feasibility, no model calls, no repository scanning, no product features beyond a vertical slice.  
**Owner:** Pi coding agent; validation in Command Code; optional independent Codex review.

## Copy-paste prompt for Pi

You are implementing only **Milestone M0** for the public open-source project **Nail It Down**, a Command Code TypeScript mod.

The milestone is tracked by GitHub issue #2. Read [docs/M0_ACCEPTANCE.md](M0_ACCEPTANCE.md) and [docs/REVIEW_GATE.md](REVIEW_GATE.md) first. Work on a branch and open a PR; do not merge it or start M1 without separate review.

Read before touching code:
- `docs/PRODUCT_SPEC.md` (or `docs/PRODUCT_SPEC_DRAFT.md` if not formally approved),
- `docs/ARCHITECTURE_DECISIONS.md`,
- `AGENTS.md`, and
- official Command Code ModApi documentation at `https://commandcode.ai/docs/mods`.

Treat the repository as source of truth. If a requirement conflicts with actual installed ModApi signatures, **report the mismatch rather than silently changing the product architecture**.

### Goal

Build the smallest install-free Command Code mod that proves command registration, one interactive choice, host-backed durable state, and default-deny approval behavior. Do **not** build the full interview engine yet.

### Strict scope

1. Confirm host, Node and npm versions and use actual installed `@commandcode/harness` typing (or available documented types). Record exact results.
2. Implement a default-export `ModApi` factory loadable with `cmd --mod ./src/index.ts`.
3. Register `/naildown <goal>`; display and persist the user-supplied goal.
4. Ask one intentionally simple hard-coded question via `cmd.ui.select` or `cmd.ui.input`; record the user answer to `cmd.store` only after confirmed selection. Include `resume` and `status` as subcommands.
5. Add a separate dummy approval confirmation which defaults to denied; do not permit headless approval. Treat aborted dialogs as no answer.
6. Keep persistence versioned and appropriately scoped to a workspace. The documented `cmd.store` is **per mod**, not per workspace: key records by a stable workspace identity derived from the host-provided cwd (or document a safer tested equivalent). Test isolation between two different workspace paths and ensure the host store write is awaited before claiming success. After a restart, resume without losing confirmed input.
7. Add a short test plan or runnable automated tests for deterministic helpers, plus exact interactive smoke-test instructions. If a test cannot run, say **NOT RUN** and why.
8. Keep changes small and auditable; document assumptions and any command API gaps.

### Explicit prohibitions

- Do not invoke LLMs, `cmd.model.complete`, cloud APIs or paid external services.
- Do not scan/read user repository files or collect secrets.
- Do not write source/implementation files in the target user's working repository during mod operation. Only this project repository's code is being edited by you, and mod state may be written through `cmd.store`.
- Do not add shell/process execution capabilities to the mod.
- Do not create complicated panes, a full decision DAG, acceptance-criteria generation, Markdown export, or multi-agent framework.
- Do not add CI triggered on every push, scheduled pipelines, websites, docker, paid runners, broad dependency matrices, or automatic publishing.
- **The ThinkPad is not a build/test machine.** Source editing and SSH are allowed there; builds/tests must run on a suitable remote resource. If one is unavailable, stop at code and record tests as NOT RUN instead of running them locally.
- No broad refactors, surprise dependencies, or unrelated changes. No commits/pushes/publishing without the user-authorized workflow.

### Acceptance gates

- `cmd mods list` recognizes the mod with no loading warnings.
- `/naildown` appears in interactive autocomplete.
- A selected answer is persisted and survives Command Code exit/restart.
- Cancellation/declined approval does not mark the mock task approved.
- In headless, dialogs default to nonapproval and produce a safe status result.
- No model calls, no subprocesses, no repo inspection, no leaking private data.
- The final report includes exact files changed, commands actually executed, results/evidence, `cmd --version`, any API ambiguities, risks, and next steps.

### Operating environment and evidence requirements

Command Code currently documents Node.js **22+**, `cmd --mod ./src/index.ts`, native UI dialogs, and the mod store. Verify against the actually installed host, and don't silently auto-upgrade tools or modify the user's global environment.

An M0 PR must include actual evidence of a real interactive TUI run, a process-restart recovery test, a cancellation/denial check, and a headless check—or explicitly mark blocked checks as **NOT RUN**. The code can be proposed without claiming M0 is done.

### Work sequence

A. Read the docs and check the environment.  
B. Implement a minimal extension and versioned persistence.  
C. Run unit/type checks **only on permitted compute**.  
D. Perform real host smoke testing where an interactive TUI is available; otherwise explicitly mark it blocked.  
E. Return concise evidence; do not advance to M1 until M0 is explicitly accepted.

**Deliverable:** a working, testable proof-of-concept in the GitHub repository, not a speculative architecture report.