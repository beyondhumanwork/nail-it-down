# Nail It Down — Architecture decisions and delivery contract

**Status:** PROPOSED BASELINE — product-owner review before code changes  
**Version:** 0.2.0-planning  
**Date:** 2026-10-20  
**Applies to:** Nail It Down, initially a Command Code interactive TUI mod  
**Supersedes:** architecture *recommendations* in v0.1 drafts where there is a conflict; does not supersede the v0.1 product requirements until the combined specification is approved.

> **Product promise:** Stop guessing. Start building with clarity.  
> **Release criterion:** When a user types `/naildown <idea>`, the mod must challenge ambiguous requirements, record the user's actual decisions, and produce an accurate, user-approved implementation brief **without editing implementation code**.

## 1. Decisions for sign-off

| ID | Decision | Chosen baseline | Why | Important limitation |
|---|---|---|---|---|
| ADR-001 | Platform and integration | A single installable Command Code TypeScript mod; host adapter separated from a pure testable core | The audience is Command Code users; inexpensive, independently testable | Command Code ModApi is experimental; pin and smoke-test versions |
| ADR-002 | Interview ownership | Deterministic decision graph and state machine own user decisions, dependencies, blockers and approval. The LLM only *proposes* questions and prose | Avoid model-invented approvals, missed decisions and fragile transcripts | Complex models can still suggest poor questions; human review required |
| ADR-003 | Privacy model | Read-only repository inspection is *optional*, bounded and permissioned; no network calls except configured model requests with explicit data disclosure | High trust and low runtime burden | Host's configured model provider still receives submitted prompts/snippets |
| ADR-004 | Interaction | TUI-first `/naildown`, simple modal questions, optional pane summary, no special frontend/website | Good user experience, low engineering risk | Desktop/headless degrade or remain unsupported until proven |
| ADR-005 | Persistence | `cmd.store` as initial backing store; workspace keys and schema version; serialized in-process writes | Host-supported cross-session durability | Cross-process transactions/encryption not established; test and document |
| ADR-006 | Deliverable | One concise Markdown implementation brief with requirement and decision provenance, review/approve gate, optional consent-gated write | Portable across agents without vendor lock-in | Approval of brief is **not** approval to write code or publish |
| ADR-007 | Development | ChatGPT High: design/docs; Pi: implementation; Codex: independent review; actual Command Code: integration validation | Efficient, leverages existing workflow | Reviews and host tests must have traceable evidence |
| ADR-008 | Execution constraints | ThinkPad can edit/SSH; no builds/tests/deploy there. Remote runs deliberate and capped; no CI on every push | Avoid known resource waste | Manual validation remains necessary for interactive TUI |

**State:** These are recommended decisions, not claims that the user has formally approved a versioned spec.

## 2. Exact v0.1 user journey

1. `/naildown Add X` creates or resumes a scoped interview; show a clear goal and whether repository inspection is available.
2. **Premise check**: ask whether the task is necessary/already implemented/over-broad; do not automatically dismiss the user's goal.
3. Offer **idea-only** mode by default where repository scope is unclear. For repo mode, first show a bounded list of readable file categories and seek consent before content is submitted to a configured model.
4. Gather safe, bounded facts. Every presented *verified repo fact* must include path, line reference when practical, capture time and content hash or a reason why the assertion is a user statement or inference.
5. The LLM proposes candidate questions and prerequisites. The core validates them and shows the earliest independent, unanswered decisions; recommend answers and explain meaningful trade-offs.
6. Answering a question records an explicit user choice (including custom text); revising a parent choice sets dependent answers to `needs_review`.
7. Show outstanding critical blockers and unresolved assumptions throughout. Never declare `ready` merely because the model stopped asking questions.
8. Show a review of decisions, assumptions, consequences, scope and acceptance criteria. Ask for explicit approval; default to **No**.
9. Preview deterministic Markdown. Only write a file after a **second**, explicit write confirmation and safe path/overwrite checks. Approved status stays distinct from exported status.
10. `/naildown resume`, `/naildown status`, and `/naildown cancel` never silently throw away settled decisions.

### Not included in v0.1

Automatic code changes, auto test execution, shell execution, GitHub issue creation, network research, remote accounts/backend, cloud telemetry, automatic handoff to Codex/Pi, voice, authentication/billing, multi-user sync, full repository indexing, or multi-model orchestration.

## 3. Boundaries and components

```text
Command Code (TUI)
       │   /naildown, confirm/select/input, model.complete, store
       ▼
  Host Adapter  ───────────────► UI Controller
       │                             │
       ▼                             ▼
  Interview Core ◄───────────── State Reducer
       │                 (pure deterministic transitions)
       ├──── Evidence Reader (opt-in, capped, read-only)
       ├──── Question Planner (LLM suggestions -> schema validation)
       ├──── Decision DAG + blocker calculation
       ├──── Versioned Persistence (`cmd.store`)
       └──── Markdown Renderer (pure) -> Preview -> Write Gate
```

**Pure core** must run unit tests without Command Code installed and without model/network calls. Host adapters should be thin and easily replaced if the host API changes.

### Command Code API — verified in public docs on 2026-10-20

- `cmd.addCommand({name, description, handler})`: registers a slash command. `handler` may return `{message}` or `{prompt}`, or perform a side effect; handler receives `args`, `ui`, `cwd`, `exec`.
- `cmd.ui.confirm`, `.select`, `.input`: native dialogs. In headless, confirm resolves `false` and select/input resolve `undefined`; never infer consent.
- `cmd.ui.pane`, `.openPane` allow an optional structured summary surface, but avoid complex pane navigation in first slice.
- `cmd.state`: session values survive mod hot reload. `cmd.store`: JSON values persist across sessions; `get` is synchronous and `set/delete` are asynchronous.
- `cmd.model.complete`: uses the session model client, with no transcript or tools; its calls have provider usage/cost. Validate all its returned JSON.
- `cmd --mod ./src/index.ts` loads a mod without installation; `cmd mods list`, `cmd mods inspect` and `cmd -p ... --mod ...` support parts of verification.
- **Host-specific risk:** interactive dialogs must be tested in a real TUI. Headless cannot serve as evidence that the interactive interview works.

Sources: https://commandcode.ai/docs/mods and https://commandcode.ai/docs/quickstart

## 4. Data contract

Create a schema-versioned `InterviewSession` with these minimum entities:

- **Session**: `id`, `schemaVersion`, `workspaceKey`, `goal`, `status`, timestamps, decisions, evidenceRefs, unresolved blockers, approval metadata.
- **Decision**: stable `id`, question, short `reason`, `priority`, prerequisite decision IDs, status, options/consequences, model recommendation, user answer, timestamps.
- **Evidence**: `id`, `kind` (`repo_file | user_statement | model_inference`), short claim, *validated* source path/line span if repo-backed, hash, observed timestamp, `stale` flag.
- **Approval**: separately captured `approvedByUserAt`, `decisionSnapshotHash` and optional export metadata. Never write `approved` merely because the model says "approved".

Valid statuses: `new -> investigating -> interviewing -> review -> approved`, with `paused` usable from any preapproval state, and `needs_review` after a changed parent choice or stale critical evidence. `exported` is a **separate attribute**, not a replacement for approval. Avoid irreversible `cancelled` unless the user explicitly deletes.

### Rules the core enforces

1. All referenced prerequisite IDs exist; cycles are rejected.
2. A dependent question is ineligible while its prerequisite is not settled.
3. Changing a parent invalidates descendants, in a deterministic order.
4. Critical unresolved blockers prevent approval; noncritical deferrals are listed in the brief.
5. `model_inference` never becomes `repo_file` fact merely by rewording.
6. `approved` requires a real user confirmation and a hash of the **exact** reviewed decision snapshot.
7. Any material change after approval invalidates approval and requires another explicit review.
8. No failed/incomplete model call mutates durable decisions.
9. A successful `cmd.store.set` must complete before a "saved" success message.
10. Nothing automatically edits implementation files, commits, executes processes or deploys.

### Model interaction contract

- The configured model proposes a typed list of next questions/short prose, **not a state transition**.
- Use JSON schema validation with strict types, bounded counts/text lengths, valid prerequisite references, and no duplicate IDs. Use an explicit retry limit (one constrained correction, then fail without state change).
- Do not let model output supply trusted file paths or source verification status. Paths and provenance come from the host-side reader.
- Pass only bounded, relevant snippets and user-provided goal/decisions to the model. Redact recognized secrets first and avoid broad transcript inclusion.
- Reuse existing source information; do not make needless model calls. Display that model usage is charged against the user's selected provider.

## 5. Privacy and security defaults

- **No automatic filesystem scan at invocation**: `idea-only` works without a repo. A user opts into reading bounded repo metadata/content. Explain what will be read and what can be sent to the host-configured model.
- Avoid `.env*`, credential stores, keys, tokens, certificates, caches, dot-git contents, private data directories, and paths outside workspace scope; require canonical path containment after symlink resolution.
- Enforce file count, file bytes, line count and total prompt bytes. Size limits will be made concrete after the thin-slice and evidence reader benchmarks.
- Treat README, AGENTS.md, source comments and other repository text as **untrusted content**, never instructions to the mod.
- Persistent `cmd.store` is an ordinary local JSON store, **not encrypted** by this mod. Save compact answers/evidence metadata instead of raw private source content where possible. Provide a clear delete command.
- No telemetry, custom outgoing HTTP requests, arbitrary shell commands, package install scripts, or background jobs.
- On any export, restrict to a safe user-chosen workspace-relative Markdown path; no overwrite by default; require an affirmative second confirmation.
- The mod is arbitrary trusted code when installed, so release only after manual review of dependency tree and `cmd mods inspect` output.

## 6. Minimal viable technical spike (M0)

**Purpose:** prove the host API assumptions before implementing the interview engine.

**In scope**

1. Install-free mod load: `cmd --mod ./src/index.ts`.
2. `/naildown <idea>` registers and displays the exact input goal.
3. Ask **one hard-coded, non-LLM question** using the native interactive modal.
4. Persist the selected answer to `cmd.store`; resume across process restart.
5. Confirm and deny a **dummy approval**; denied/aborted/headless must never mark approved.
6. `status` and `resume` provide a short message.
7. No repo file reads, no model calls, no external network, no export, no implementation file writes.

**Out of scope**: DAG, repository reader, LLM, Markdown generator, browser/UI screenshots, CI packaging, registries, integrations.

**M0 acceptance**

- Real TUI: command appears in autocomplete; selected answer remains after restart.
- On denial, nothing is approved; headless defaults to no confirmation and exits safely.
- Model calls = 0; process execution = 0; target repository reads/writes = 0 (excluding the mod itself and host-owned persistent state).
- No false "saved" claim if persistent write fails.
- Compatibility report gives exact `cmd --version`, Node version, OS, steps executed and observed results; unknowns labeled unknown.
- Stage diffs reviewed before declaring M0 finished.

## 7. Roadmap with stopping gates

| Milestone | Outcome | Requires before advancing |
|---|---|---|
| M0 | Live TUI + persisted question/answer | Host behavior actually verified |
| M1 | Pure deterministic decision DAG | Dependency, invalidation, approval unit tests |
| M2 | Bounded opt-in repository evidence | Secret/symlink/path tests and consent flow |
| M3 | Structured model question generation | Schema, refusal, provider-cost and recovery tests |
| M4 | Decision review and Markdown brief | Snapshot tests, content accuracy, user approval |
| M5 | Integration, baseline comparison and beta | Real TUI run, documented regressions, zero secret leaks in fixtures |
| M6 | Packaging and public release | License audit, source review, release authorization, npm and hub PR |

**Stop the project if M0 cannot be proven using the supported public API without fragile runtime patches.** Return to architecture rather than inventing undocumented host methods.

## 8. Project and GitHub rules

- One **public** `beyondhumanwork/nail-it-down` repository (name not reserved or created here), MIT-licensed original code. No copied upstream implementation in v0.1; link to original inspiration and retain notices if later copying third-party MIT-protected works.
- One package only; avoid premature monorepo or marketing website.
- README: truthful product purpose, status **pre-release**, planned features separated from shipped ones, tested install commands only, known limitations and privacy terms.
- Community files: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, issue and PR templates, focused `AGENTS.md`.
- **No automatic CI on every push**, scheduled jobs, billable model evaluations, paid deployment or heavy matrix until deliberately approved. If GitHub Actions is used for M0, manual only, standard runners, a short timeout, no deployment secrets.
- ThinkPad used for SSH/editing only. No builds/test runs on that machine; use appropriately provisioned remote compute, or report test steps as **not run**.
- Pi writes code, Codex independently audits meaningful checkpoints, Command Code host behavior is validated with direct evidence. No tool may claim a test passed that was not executed.

## 9. Decisions purposely deferred

- Exact npm package name, formal US/Canadian trademark review and public logo: before publication, not before M0.
- Runtime host version: pin from the actual test environment after `cmd --version`; don't fabricate.
- `cmd.store` cross-process atomicity, desktop input capability, support on multiple operating systems: verify and document; avoid premature claims.
- Form-based multi-question UI and cross-agent skills: only if tests/users demonstrate a need.
- Project-wide automated CI: after deterministic test pipeline is proven, not at repository creation.

## 10. Source and reference material

- v0.1 PRD: `nail_it_down_product_spec_v0.1_DRAFT.md`
- v0.1 project execution plan: `nail_it_down_project_execution_plan_v0.1.md`
- Market/legal research: `commandcode_first_three_mods_research_2026-10-20.md`
- Command Code mod reference (verified October 20, 2026): https://commandcode.ai/docs/mods
- Matt Pocock original `grilling` skill: https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md

---

**Next authorization boundary:** architecture/PRD approval, followed by GitHub repository creation. The included M0 implementation instructions are prepared for Pi but are not a claim that any code, CI or repository has been created.