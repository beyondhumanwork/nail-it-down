# Nail It Down — Project Execution & Public GitHub Plan

**Status:** Proposed development plan; **not** authorization to implement, publish, or create remote resources  
**Date:** 2026-10-20  
**Product:** Nail It Down (brand/name availability and trademark risk still to be checked)  
**Audience:** Product owner, Pi implementer, Codex reviewer, open-source contributors  
**Scope:** Command Code TUI mod, first public beta; independent from the future Handoff and SafeOps mods  
**Supporting documents:** `nail_it_down_product_spec_v0.1_DRAFT.md` and `commandcode_first_three_mods_research_2026-10-20.md`

## 1. Decisions recommended now

| ID | Decision | Status / rationale |
|---|---|---|
| D-001 | Product display name: **Nail It Down** | Working name; verify branding/trademark/npm naming before publishing |
| D-002 | User command: `/naildown` | Proposed, subject to real-host conflict check |
| D-003 | **ChatGPT High** owns product specifications, architecture decisions, and scope; record approvals in docs | Human-approved specs, not chat summaries, become source of truth |
| D-004 | **Pi** is the primary code-authoring harness | Matches established workflow; TypeScript capable |
| D-005 | **Codex** acts as independent reviewer at meaningful checkpoints | Different perspective; must inspect diff/tests, not rubber-stamp |
| D-006 | **Command Code** is the integration target, used during the vertical-slice experiment and before release | Its ModApi is experimental and must be tested against a pinned host version |
| D-007 | **One dedicated repository for Nail It Down** | Avoid building a multi-mod monorepo before products exist |
| D-008 | MIT for independent code, with applicable upstream notices | Third-party source/text/asset attribution must be separately audited |
| D-009 | Public, docs-first development is the default | Repo can be public before the mod is publishable; label development status prominently |
| D-010 | No external backend, telemetry, GitHub Pages site, or cloud deployment for v0.1 | Native TypeScript mod and Markdown docs are sufficient |
| D-011 | Build/test remotely, not on the resource-constrained ThinkPad | GitHub-hosted CI or other permitted remote compute; local edit/SSH is fine |
| D-012 | Publish requires explicit product-owner approval | Separate approval for repo creation, npm publishing, hub listing, and launch announcements |

## 2. Harness operating model

**ChatGPT (High):** finalize problem statement, PRD, acceptance matrix, architecture records, scope gates, evaluation corpus, README messaging, and release readiness checklist. Save versioned Markdown into the repository; architecture decisions are not authoritative if they only appear in conversation.

**Pi (implementation):** read approved docs and `AGENTS.md`; implement one issue/milestone at a time on short-lived branches; propose small diffs; add deterministic tests and report tests **actually** run. Do not make unapproved API, architecture, provider, or deployment decisions.

**Codex (independent audits):** at architecture proof-of-concept, state machine completion, and release candidate, inspect relevant source/docs/diff and report `blocker / major / minor` findings with file references and reproducible evidence. Don't auto-apply review suggestions without assessing them.

**Command Code (validation):** use real supported versions for command registration, question UX, storage/restart, cancellation, default-deny approval, export, and error recovery. Headless mode does not replace live TUI tests.

**Separation of concerns:** Authoring a mod for Command Code does not require writing it *in* Command Code. Tests in Command Code are non-negotiable.

## 3. Architecture proposal (needs final ADR approvals)

- **Host adapter:** command registration, UI capability detection, model-call adapter, storage adapter, permission checks.
- **Domain core:** interview session state machine, decision dependency DAG, invalidation rules, evidence records, schema validation.
- **Read-only discovery:** bounded scans of allowlisted repository metadata; safe path resolution; no arbitrary command execution.
- **Model-facing modules:** premise check, question generation, recommendations and prose. Validate generated structures; do not let an LLM directly mutate persistent state or claim approvals.
- **Persistence:** workspace-scoped, versioned state in host-managed storage where supported; test recovery after restart/hot reload. Define serialization/migration strategy.
- **Exporter:** deterministic Markdown output contract; preview and explicit consent before filesystem write. Default deny in headless mode.
- **Testing:** deterministic unit tests for core, fixture-driven adapter contract tests, real Command Code smoke tests, separate optional evaluated LLM scenarios.

**Product invariants:** user decisions outrank model recommendations; dependent decisions reopen when parents change; unsupported facts are assumptions; critical ambiguity blocks 'approved'; no implementation changes by default; no credential or private-file inclusion by default.

**Unknowns to spike early:** Exact `ModApi` signatures on installed version; UI lifecycle during asynchronous command handlers; persistence semantics and atomicity; what constitutes an accessible workspace; package runtime dependencies; real client behavior under TUI/headless/reload. Do not resolve these by guessing from documentation.

## 4. Repository blueprint

Proposed URL (not checked/reserved): `github.com/beyondhumanwork/nail-it-down`.

```text
nail-it-down/
├── README.md                      # Public front door and first-run guide
├── LICENSE                        # MIT
├── CHANGELOG.md                   # Only real shipped changes
├── CONTRIBUTING.md                # Reproduce, test, propose changes
├── CODE_OF_CONDUCT.md
├── SECURITY.md                    # Private vulnerability disclosure route
├── THIRD-PARTY-NOTICES.md         # Only applicable copied/adapted works
├── AGENTS.md                      # Concise contributor/agent operating rules
├── package.json                   # commandcode entrypoints and npm metadata
├── package-lock.json              # If npm chosen for reproducible builds
├── tsconfig.json
├── src/
│   ├── index.ts                   # Command Code adapter/registration
│   ├── core/                      # Pure domain logic (host-independent)
│   ├── host/                      # UI, model, storage boundaries
│   ├── discovery/                 # Read-only context gathering
│   └── export/                    # Markdown output
├── tests/
│   ├── unit/
│   ├── fixtures/
│   ├── contract/
│   └── integration/
├── examples/                      # Sanitized user-facing fixtures/results
├── docs/
│   ├── PRODUCT_SPEC.md            # Approved version; status in header
│   ├── ARCHITECTURE.md            # C4-level component/data flow summary
│   ├── EVALUATION.md              # Baseline and test methodology
│   ├── PRIVACY.md                 # Repository data, storage, model context
│   ├── COMPATIBILITY.md           # Tested host versions and constraints
│   ├── ROADMAP.md                 # Current, next, later; no promises
│   ├── development.md             # Contributor setup and test recipes
│   └── adr/
│       ├── 0001-single-package-and-host-adapter.md
│       ├── 0002-deterministic-interview-state.md
│       └── 0003-privacy-first-repo-inspection.md
└── .github/
    ├── ISSUE_TEMPLATE/
    │   ├── bug_report.yml
    │   └── feature_request.yml
    ├── PULL_REQUEST_TEMPLATE.md
    ├── dependabot.yml             # Dependency alerts/PR cadence carefully controlled
    └── workflows/
        ├── verify.yml             # A lightweight check with strict caps
        └── publish.yml            # Protected/manual release only
```

**Avoid initial overengineering:** No `packages/` multi-package tree, complicated documentation generator, automated external agent calls, multi-agent framework, website build, heavy security scanner matrix, or 50 template files. Delete unused scaffolding rather than making empty promises.

## 5. GitHub quality bar

### README first screen

1. Product identity and one-line promise: **Nail It Down — Stop guessing. Start building with clarity.**
2. **One truthful 20–40 second demo**, ideally terminal recording/GIF, with an accessible text transcript.
3. **Exact tested install command**, added only when working. Until then, say `Pre-release; installation not yet available`.
4. Minimal example of `/naildown ...` and an excerpt of the resulting approved Markdown brief.
5. Features and **explicit non-features**: does not write implementation, deploy, or silently transmit data.
6. Compatibility table of **actually tested** Command Code versions/OS/modes.
7. Links to docs, support/issues, contributions, license and security.
8. Only truthful badges (CI from a real check; license from actual license; npm version after publish).

### Repository setup

- Clear description, topics, pinned repository on organization profile, descriptive release names.
- GitHub Social Preview: 1280×640 PNG/JPG below 1 MB; professional graphic once identity is final.
- GitHub Community Standards: README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue + PR templates.
- Define issue labels: `bug`, `enhancement`, `docs`, `needs-repro`, `good-first-issue`, `blocked`, `release`.
- Use PRs for substantial changes, small reviewable diffs, acceptance criteria, changelog entries.
- Protect `main` via GitHub ruleset; prevent force-push/deletion; review required checks carefully so docs-only edits do not deadlock merge.
- Add private vulnerability reporting if available; never ask users to publish credentials in public issues.
- Keep architecture decisions in `docs/adr`; compare proposed changes to approved contracts.

### Exemplars and lessons

- `sindresorhus/ky`: brief value statement and immediate copy-pastable usage.
- `unjs/consola`: readable README and examples without forcing a complex docs site.
- `kenryu42/cc-safety-net`: problem demonstration, limitations, docs separation, tests and contributing contract.
- `cli/cli`: contributor scope, review expectations, deliberate release process.
- `changesets/changesets`: useful release discipline for later multi-package projects, **not a prerequisite** for this single package.

## 6. Resource and CI policy (hard constraints)

- Source editing / Git / SSH can be done on the ThinkPad. **No local build/test workload on the ThinkPad.**
- Prefer remote reproducible jobs for typecheck, lint and deterministic tests; test the mod in a real Command Code environment on an appropriate remote/other-capable machine.
- GitHub's **standard hosted runners for public repos** are currently free of Actions-minute charges, but workflows can still create resource waste and other chargeable resources. Don't use larger runners or unintentionally paid services.
- At first, use manually triggered `workflow_dispatch` checks; once stabilized, add one small PR check that executes only relevant deterministic tasks, without external LLM calls.
- Use `permissions: contents: read`, `timeout-minutes` (e.g. 5), `concurrency` with cancel-in-progress for superseded changes, dependency caching as appropriate, and no scheduled jobs.
- Do **not** use `pull_request_target` to execute untrusted PR code or expose publishing credentials.
- Do not duplicate the same verify job on both push and PR; no nightly, hourly, matrix-heavy, deployment, or LLM-eval workflows in v0.1.
- Keep **required** checks unfiltered (or design a stable aggregator) to avoid skipped/pending check deadlocks. Make full integration validation manual when it needs host credentials.
- Cap CI job frequency through a clear ownership process. Follow Actions spending settings and inspect all workflows and installed GitHub Apps before enabling automation.

## 7. Release process

1. Independently verify the package's brand/npm scope/GitHub naming and trademark risk before external marketing.
2. Finish deterministic unit + host adapter tests; run successful Command Code TUI/manual compatibility smoke tests.
3. Run independent Codex review; resolve blockers; audit provenance and README claims.
4. Perform security review: no secret leakage, safe repository inspection, approval gate on export, no untrusted arbitrary command execution, dependency/license inventory.
5. Use `npm pack --dry-run` and inspect archive contents to ensure no tokens, test secrets, transcripts, or internal drafts leak.
6. Release a tagged beta (`v0.1.0-beta.1` or equivalent) with truthful notes, known limitations and tested host versions.
7. Prefer **npm trusted publishing via OIDC** from a protected GitHub-hosted release workflow (no long-lived publishing token), where package/account configuration permits. Its current requirements must be checked at setup.
8. Confirm installation using the exact published package and Command Code's `cmd mods add <source>` workflow.
9. Submit a separate PR to Command Code's `mods/registry.json`, including required metadata. npm publication alone does not list the hub entry.
10. Observe user issues/feedback and prioritize defect fixes before ambitious new features.

**Every external write** (GitHub repo/PR, npm publication, Mods Hub listing) occurs only after explicit authorization; discussion of the process alone is not approval.

## 8. Sequential milestones and exit gates

| Milestone | Deliverable | Gate |
|---|---|---|
| M0. Freeze design | Approved spec, architecture, 3 ADRs, known risks, evaluation fixtures | Product-owner approval |
| M1. Public repository bootstrap | Clean doc-only repo, community files, development policy | No install claim; license correct |
| M2. Host compatibility spike | Minimal Command Code mod, `/naildown` command, one storage roundtrip, TUI and headless proof | Actual host version and behavior documented |
| M3. Core engine | Deterministic interview state, question prerequisites, invalidation, persistence | Unit and property-based cases pass |
| M4. Model/repo integration | Read-only facts, question generation with validation, trade-offs, approval UI | No unapproved writes; failure recovery tested |
| M5. Output and UX | Approved Markdown brief, explicit consent, resume, status, examples | Real-user scenarios and snapshots pass |
| M6. Independent review/evaluation | Comparisons vs baseline `grilling`, bug triage, privacy/security checks | Must beat baseline on agreed useful measures, no critical known defects |
| M7. Release | Packaged beta, exact install instructions, GitHub release, optional npm + Mods Hub submission | Human go/no-go |

**Do not** optimize for speed by skipping M2: ModApi is experimental. Keep the first vertical slice tiny.

## 9. Review rubric for success

- Installer succeeds with the README's literal instructions, on a clean supported host.
- A real project can move from vague request to brief without implementation writes.
- Repo facts are sourced; unsupported claims are never presented as verified.
- A question is not asked when readily verified in safe available project context.
- Changing an upstream answer reopens dependent decisions.
- Interruption and reload do not lose committed decisions.
- Users can decline, defer, cancel and withhold approval safely.
- No sensitive information is intentionally emitted to logs/export or sent to a model outside documented user consent/configuration.
- LLM failure leaves persisted state consistent; headless behavior fails closed.
- CI never invokes pay-per-token services as part of default PR validation.
- Public claims are backed by reproducible demos, test output, or documentation.

## 10. Research references (accessed 2026-10-20)

- Command Code mod API, installation & registry: https://commandcode.ai/docs/mods
- Pi extension docs: https://pi.dev/docs/latest/extensions
- GitHub public community profiles: https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories
- GitHub standard hosted runners and pricing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- GitHub rulesets: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- CI concurrency: https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency
- npm trusted publishing: https://docs.npmjs.com/trusted-publishers
- npm provenance: https://docs.npmjs.com/generating-provenance-statements
- GitHub social preview: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview
- High-quality README examples: https://github.com/sindresorhus/ky , https://github.com/unjs/consola
- Open-source security tool project: https://github.com/kenryu42/cc-safety-net
- Contribution practices: https://github.com/cli/cli
- GitHub release notes: https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes