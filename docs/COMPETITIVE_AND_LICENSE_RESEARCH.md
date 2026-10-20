# Command Code Mods: Research Dossier for the First Three Releases

**As of:** 2026-10-20  
**Status:** Research and feasibility review; **not** an approved implementation specification.  
**Proposed sequence:** (1) PlanProbe (working name), (2) cross-agent handoff (name pending), (3) safety guard (name pending).

## 1. Executive findings

1. **All three principal upstream reference codebases checked carry MIT licenses:** Matt Pocock's `skills` (2026 Matt Pocock), Kyle Little's `handoff-skill` (2026 Kyle Little), and `kenryu42/cc-safety-net` (2026 J Liew). MIT generally permits copying, modifying, commercially distributing and sublicensing code with the required license and copyright notices retained. A license grants no trademark rights.
2. **PlanProbe should not be a renamed `grill-me`:** Matt Pocock's `grilling` already supports design-tree dependency ordering, frontier-based multi-question rounds, recommended answers, codebase fact-finding, and user approval. Meaningful differentiation should come from a reliable native workflow with explicit state, facts/assumptions/decisions separation, documented output, targeted UX, and reproducible outcome evaluation.
3. **Cross-agent handoff is a competitive category:** Matt Pocock's `handoff` skill, Kyle Little's `handoff-skill`, `@hypabolic/relay` for Pi, `@masyv/relay`, and Agent Relay already provide variants. Avoid the brand **Relay**, already in use by several relevant offerings. Differentiate with verifiable Git-backed task snapshots, deterministic/redacted exports, source pointers, provenance, and safe import on Command Code.
4. **Safety controls are mature elsewhere:** `cc-safety-net` already supports many coding agents, GUI policy configuration, modes, rulebooks, wrappers, redaction, audit logging and a library API. Do not claim a simple shell-substring guard is a competitive product. Consider a thin, thoroughly tested Command Code adapter or a narrowly differentiated native safety policy manager.
5. **Command Code has a powerful but experimental TypeScript ModApi.** It supports `addCommand`, model calls, state/store, UI, hook interception, and distributable npm/Git packages. Crucial limits: `beforeToolCall` runs after the built-in permission check, the UI is not identical across TUI/desktop/headless, and ModApi signatures can change.

## 2. Legal and licensing diligence

| Source | Confirmed licensing | Implication | Action |
|---|---|---|---|
| `mattpocock/skills` root LICENSE | MIT; copyright 2026 Matt Pocock | Can reuse/adapt identifiable files and instruction text subject to retention of license notices | Pin commit and include original MIT notice with substantial adapted content |
| `klittle32/handoff-skill` LICENSE | MIT; copyright 2026 Kyle Little | Can adapt code/templates with same notice rule | Preserve the notice if copying implementation/templates |
| `kenryu42/cc-safety-net` LICENSE | MIT; copyright 2026 J Liew | Can wrap, fork or adapt licensed code with notice | Prefer upstream library adapter if feature and license permit; test/pin version |
| `CommandCodeAI/command-code` registry repository | No root LICENSE observed during review; root contained `.github`, `mods`, and `readme.md` | Public GitHub does **not** independently authorize source-code reuse | Use documented APIs and independent implementation; do not copy repository code without a clear grant |
| Command Code ModApi docs and Command Code Terms (updated 2026-09-20) | Published mod API; terms reserve company IP/trademark rights; shared-content representations required | Independent compatible mods are encouraged, but no affiliation or endorsement is granted | Use “for Command Code” descriptively; no official logos/endorsement claims |

### Practical policy for this project

- Default to independent implementation informed by lawful study of source; give visible upstream credit.
- If copying/adapting substantial code or prompts, retain original MIT copyright + permission notices. Preserve any additional third-party notices and inspect dependency licenses separately.
- Maintain `THIRD-PARTY-NOTICES.md`, `DEPENDENCIES.md` or equivalent SPDX/SBOM inventory, source commit hashes, and records of which files were adapted.
- Avoid names or presentation confusingly similar to upstream projects or Command Code's own official mods. GitHub/npm name availability **is not** trademark clearance; search Canadian and US trademark registries and common-law use before release.
- Publishing an MIT-derived project as an MIT project is permissible, but `LICENSE` should distinguish copyright in original upstream material versus original work from our team.
- Review user data handling: prompts, plans, paths, transcripts, credentials and diffs may contain confidential data. Never publish those in a package or telemetry. Don't upload user work without explicit authorization.
- Security marketing must not promise unbreakable protection. False assurance is particularly risky for a product that advertises preventing destructive actions.
- This is engineering/legal research, **not legal advice**; formal counsel is appropriate for trademark clearance, any non-MIT upstream, material commercial licensing, or public security guarantees.

## 3. Mod 1 — PlanProbe (working name)

**Proposed short positioning:** “Find what your agent doesn't know before it builds.”  
**Potential command:** `/probe` (check reserved command names during implementation).  
**Product category:** context-aware design interview and implementation readiness.

### Direct competitors and lessons

| Competitor | Existing capability | Our opportunity |
|---|---|---|
| Matt Pocock `grilling` + `grill-me` | Dependency tree; frontier questions in rounds; recommended answer; env fact-finding; user-controlled completion | Native Command Code UX and reliable persisted state; visible decision ledger and acceptance contract |
| Matt Pocock `grill-with-docs` | Interview + domain-modeling; writes glossary and qualifying ADRs | Avoid delegation/load failure; record all meaningful decisions even when not ADR-worthy |
| `murilobauck/specsmith` `prompt-grill` | Structured interviews and spec.md generation | Fewer files, no framework commitment, better core usability |
| Specsmith CLI / specsmith.ai | Interactive requirement refinement and detailed specs | Lightweight mod with no extra account/service and native host model |
| `grill-with-docs` issues #426, #475, #1123 | Delegated dependent skills fail to load or are not installed; Codex does not expose a “Skill tool” | Bundle full essential flow or remove runtime dependency on separately installed skills |
| Matt Pocock issue #244 | Criticize the premise before optimizing the idea | Early “do we need to build this?” objection gate |

### Proposed differentiation that can actually be tested

- **Two evidence lanes:** verified information looked up from existing project files versus assumptions requiring confirmation. Never ask users questions the agent can answer from permitted local project facts.
- **Dependency-aware questioning:** ask only currently unblocked questions; allow small grouped rounds or sequential mode. For every question show a concise reason, a recommended answer and a consequence of the choice.
- **Early premise challenge:** check for conflicting requirements, duplicate existing functionality, unneeded complexity and alternatives *before* investing in detailed implementation questions.
- **Persistent decision ledger:** stable IDs, answer, rationale, status (`decided`, `assumed`, `deferred`, `blocked`), source, and dependency. Resume after interruption without repeating answered questions.
- **Ready-to-build export:** concise Markdown with objective, non-goals, hard constraints, acceptance criteria, decisions, known facts, unknowns and validation plan; generate only after user approval. Export should distinguish draft from approved.
- **Scope discipline:** do not implement anything during interview; don't write into repo by default without approval.
- **One-command installation:** no hidden prerequisite skill packages. Optional adapters/standalone skill later.
- **Model robustness:** test with a capable model and a lower-cost model rather than relying on instruction following alone.

### First-release boundary recommendation

Include explicit `/probe` invocation, local project discovery, interactive question rounds, confirmation of decisions, and one reviewed Markdown spec/brief. Defer autonomously launching implementation, multi-agent dispatch, internet research, enforced CI rules, dashboards, cloud accounts and a full PRD/ADR-management framework.

### Research-stage success criteria

1. For seeded ambiguous tasks, detect important omissions versus a human-authored rubric while avoiding fabricated requirements.
2. Do not re-ask answers recorded in the decision ledger.
3. Never silently mark a fact as verified without evidence.
4. Present questions in dependency-correct order.
5. Do not make code changes or external calls without explicit opt-in.
6. Produce a stable, independently understandable brief usable by a fresh coding agent.

**Naming:** `PlanProbe` is a provisional research-stage suggestion, not trademark/npm-name clearance. `Clarify` is already in prominent use in the AI products ecosystem. Avoid using upstream `grill-me` as our brand.

## 4. Mod 2 — Cross-agent handoff (brand pending)

### Relevant projects

- `mattpocock/skills` `handoff`: MIT. Writes a task-tailored Markdown handoff to temp, references existing artifacts, redacts sensitive details. Manual prompt-based transfer.
- `klittle32/handoff-skill`: MIT. Goal-directed cross-platform transfer with portable templates and structural/output verification scripts.
- `@hypabolic/relay`: Pi extension. Imports Claude/Codex/Grok/OpenClaw sessions; normalizes and archives inert transcripts; searchable history; seeds Pi safely.
- `@masyv/relay`: Captures Claude JSONL and offers several destination adapters and local clipboard/handoff workflow.
- `dbisina/relay` and `AgentWorkforce/relay`: more comprehensive cross-agent handoff/orchestration systems.

### Viable differentiation

- **Command Code native:** one-command creation of a **read-only, reviewable** handoff packet, using permitted Command Code session APIs and Git metadata.
- **Verifiable status:** distinguish evidence observed on disk/Git from agent-asserted work. Include branch, commit, dirty files, files referenced, tests actually run versus tests merely described, blockers, failed approaches, decisions and next action.
- **Provenance:** record when and from which workspace/commit the packet was generated, along with stale-state warnings if repository state changes.
- **Privacy:** strip known secret patterns, exclude env files and sensitive paths by default, review packet before export; avoid sending transcripts to outside services.
- **Portable artifact:** human-readable Markdown and optional machine-readable JSON sidecar, versioned schema; no required daemon or credentials.
- **Receiver workflow:** initially copy/paste into Pi, Claude Code or Codex. Defer automatic importing of foreign transcripts and agent launching until host-specific behavior is validated.

### Technical caveat

Command Code's documented `cmd.session` persistence interface is for a mod's own custom entries; it does **not** promise arbitrary access to the full transcript. `cmd.sessions` supports tree/compaction/navigation, not session creation or switching. We must test which session information is available before promising automated capture. Fallback: user-provided goal/context plus Git inspection and available session events.

### Risks

Sensitive-data leakage; hallucinated “tested/passed” claims; stale Git state; committing handoff artifacts containing secrets; untrusted imported instructions treated as orders. Use a review-first export and “untrusted context” boundary when consuming packets.

**Name:** Do not use `Relay` alone; multiple directly relevant coding-agent projects already use it. Pick and clear a distinctive new name during this mod's spec stage.

## 5. Mod 3 — Safety controls (brand pending)

### Principal upstream

`kenryu42/cc-safety-net` is MIT and substantially beyond simple keyword matching: supports numerous coding agents, multiple policy presets, interactive GUI, team rulebooks, shell-wrapper detection, one-liner detection, secret redaction, audit logging, and a public `checkCommand` library API.

Other relevant implementations: `dekrom/claude-code-safety-net`, `yurukusa/claude-code-safety-net`, `compilerbauer/claude-code-safety-net` (check exact lineage/license of any code adapted from these individually).

### Product recommendation

A generic reimplementation of safety-net is low-differentiation and exposes us to unnecessary security liability. Evaluate a **native Command Code policy adapter** integrating an audited upstream engine, plus improved Command Code-aware permissions, per-project policy explanation and rule dry-run tests. If an adapter is not technically or strategically compelling, defer this mod and elevate CI Budget Guard instead.

### Minimum safety model

- Intercept `beforeToolCall`; recognize coverage boundaries beyond shell (file edit/write APIs, if exposed); rely on host permission enforcement as a separate layer.
- Use modes: audit, confirm-on-risk, block-on-high-risk. Hard-coded “all safe” behavior must never be implied.
- Be explicit about bypasses: `beforeToolCall` occurs *after* built-in permission check; can miss external processes and unobserved tooling. No sandbox; mods themselves execute with user permissions.
- Refuse to silently auto-approve unsafe operations. Don't log raw secrets; tested redaction before audit log writes.
- Test against quoting, symlinks, path traversal, wrappers, argument concatenation, interpreter one-liners, encoded commands, platform differences, false positives, and unrecognized commands. Unknown behavior should have an explicit configured fallback.
- Publish a threat model and limitations with the first public version.

## 6. Command Code technical fit and constraints

| Capability | API | Important condition |
|---|---|---|
| Native slash command | `cmd.addCommand` | First registered name wins; avoid conflicts |
| Agent prompts and local model calls | `cmd.prompt.submit`, `cmd.model.complete` | Uses configured provider; model calls consume corresponding provider usage |
| UI/interactive questions | `cmd.ui.confirm`, `.select`, `.input`, `.pane` | Desktop and headless support differ; UI pane inputs/selects are not equally interactive everywhere |
| Session-state tracking | `cmd.state`, `cmd.store` | State vs persisted JSON have distinct lifetimes |
| Saved mod-specific notes | `cmd.session.appendCustomEntry`, `getCustomEntries` | Not a general full-transcript export API |
| Detect/stop tool calls | `cmd.hooks({beforeToolCall})` | Runs after permission check; not a full OS security boundary |
| Packaging | `commandcode.mods` + `commandcode.skills` in `package.json` | npm installation does **not** automatically list item in the Mods Hub |
| Discovery | PR to `CommandCodeAI/command-code` `mods/registry.json` | Registry review; metadata and keyword checks |
| Testing | `cmd --mod ./mod.ts`; `cmd mods list`; `cmd -p ...` | `cmd -p` headless confirmations reject, input prompts undefined; must test noninteractive gracefully |

### Resource-conscious development and release

Use local static analysis/unit tests and fake host fixtures without consuming cloud CI minutes. Avoid workflows triggered by every push. For final integration/build/release, use explicit manually initiated jobs with tight timeouts/quotas. No hosted telemetry or external service requirements for MVP. Pin Command Code/API version and dependencies because ModApi remains experimental.

## 7. Phase gates

### Phase A — Research (this document)

Required to advance: licensing checked; competitors identified; differentiated feature thesis; limits and failure modes listed. **Outcome: PlanProbe proceeds to specification.** Handoff proceeds with naming and technical validation; safety guard proceeds conditionally.

### Phase B — PlanProbe specification (next deliverable)

Produce separate approved documents for:

1. Problem definition, users, user journeys and non-goals.
2. Competitor behavior comparison and differentiators.
3. Functional requirements with stable IDs, data model (decision graph and ledger), flows, command interactions, error states, output Markdown schema.
4. Command Code ModApi compatibility matrix including TUI/desktop/headless, security and privacy.
5. Acceptance tests and evaluation fixtures, plus benchmark against baseline `grilling` and `prompt-grill`.
6. Lightweight package/release plan, attribution and distribution checklist, cost-control CI design.

**Do not start coding until the PlanProbe specification is reviewed and accepted.** Then implement, test, package and publish, and apply the lessons to Handoff and Safety.

## 8. Primary references (accessed 2026-10-20)

### Licenses and legal

- https://github.com/mattpocock/skills/blob/main/LICENSE
- https://github.com/klittle32/handoff-skill/blob/main/LICENSE
- https://github.com/kenryu42/cc-safety-net/blob/main/LICENSE
- https://commandcode.ai/terms
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
- https://www.uspto.gov/trademarks/search/likelihood-confusion

### Plan interviewing

- https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md
- https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md
- https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md
- https://github.com/mattpocock/skills/blob/main/docs/productivity/grilling.md
- https://github.com/mattpocock/skills/blob/main/docs/engineering/grill-with-docs.md
- https://github.com/mattpocock/skills/issues/426
- https://github.com/mattpocock/skills/issues/475
- https://github.com/mattpocock/skills/issues/1123
- https://github.com/mattpocock/skills/issues/244
- https://github.com/mattpocock/skills/issues/608
- https://github.com/murilobauck/specsmith
- https://www.specsmith.ai/

### Handoff

- https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md
- https://github.com/mattpocock/skills/blob/main/docs/productivity/handoff.md
- https://github.com/klittle32/handoff-skill
- https://www.npmjs.com/package/@hypabolic/relay
- https://www.npmjs.com/package/@masyv/relay
- https://github.com/dbisina/relay
- https://github.com/AgentWorkforce/relay

### Safety and Command Code

- https://github.com/kenryu42/cc-safety-net
- https://github.com/dekrom/claude-code-safety-net
- https://commandcode.ai/docs/mods
- https://commandcode.ai/mods
- https://github.com/CommandCodeAI/command-code