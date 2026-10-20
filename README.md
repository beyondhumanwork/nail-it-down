# Nail It Down

**Stop guessing. Start building with clarity.**

Turn a rough software idea into a questioned, documented, **user-approved implementation brief** before a coding agent starts implementing it.

> **Status: Pre-alpha — planning and host feasibility.** Nail It Down is **not available for installation**. The interface and capabilities described below are planned, not yet working or tested. We are developing a native [Command Code](https://commandcode.ai/) TypeScript mod in public.

## The problem

Coding agents can implement vague requests confidently while silently choosing the wrong scope, assumptions, data model, or edge-case behavior. Nail It Down is designed to surface those decisions *before* implementation.

## What we're building

- **Investigate, then ask.** Offer a no-repository-access idea mode; if approved, inspect bounded read-only project context instead of asking for facts already in code.
- **Challenge the premise.** Highlight hidden assumptions, conflicts, and simpler alternatives.
- **Resolve decisions deliberately.** Ask dependent questions in the right order and explain meaningful trade-offs.
- **Keep durable context.** Track chosen answers, unresolved questions, and changed decisions.
- **Produce a reviewable brief.** Preview requirements, non-goals, acceptance criteria, and verification steps; require explicit user approval.

### Planned experience — illustrative only

~~~text
/naildown Add subscription billing

Nail It Down (planned)
Goal: Add subscription billing
Question: Who owns the subscription?
  • Each user
  • Each workspace
  • Something else

Review pending decisions and trade-offs
→ Approve a brief, or revise answers
~~~

This is **not** an actual recording or proof that the mod currently works.

## Safety by design

The proposed mod will **not** edit implementation code, execute shell commands, auto-deploy, create remote accounts, or approve a plan on the user's behalf. Repository inspection will be opt-in and bounded. The configured model provider may receive user inputs and explicitly shared snippets; model calls can incur provider usage costs. Local host-backed persistence is not assumed encrypted.

See [privacy design](docs/PRIVACY.md), [security policy](SECURITY.md), and the [draft architecture](docs/ARCHITECTURE_DECISIONS.md). Implementation and privacy assurances remain **unverified until tested**.

## Current stage

**Now:** Review the product architecture and prove the basic Command Code API integration (milestone **M0**).

**Not yet:** Packaging, an installation command, supported-version claims, CI badges, npm release, or Mods Hub listing.

Read the [roadmap](docs/ROADMAP.md), [draft product specification](docs/PRODUCT_SPEC_DRAFT.md), [execution plan](docs/EXECUTION_PLAN.md), and [M0 implementation handoff](docs/M0_HANDOFF.md).

## Development

The repository begins documentation-first. Proposed development process:

1. Approve the architecture and product baseline.
2. Implement **M0 only** using Pi, on a small reviewable branch.
3. Validate the real TUI behavior in Command Code, record actual versions and test evidence.
4. Request an independent review at major milestones.
5. Add features incrementally; publish only after a verified release gate.

See [AGENTS.md](AGENTS.md) for coding-agent constraints and [CONTRIBUTING.md](CONTRIBUTING.md) for contributor guidance.

## Inspirations and originality

The problem and research were informed by existing open-source agent skills, notably [Matt Pocock's grilling workflow](https://github.com/mattpocock/skills). Our objective is an independently implemented, testable host-native workflow, not a rebranded copy. Any future copied or adapted third-party code must carry the required notices. See [research](docs/COMPETITIVE_AND_LICENSE_RESEARCH.md) and [third-party policy](THIRD-PARTY-NOTICES.md).

## Project

- **Maintainer:** [Beyond Human Work](https://github.com/beyondhumanwork)
- **Contributing:** [Guide](CONTRIBUTING.md)
- **Issues:** [Report a bug or suggest a feature](https://github.com/beyondhumanwork/nail-it-down/issues)
- **Security:** [Disclosure policy](SECURITY.md)
- **License:** [MIT](LICENSE)

Built in the open, with functionality claims added only when verified.
