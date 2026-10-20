# Nail It Down — Public GitHub setup checklist

**Status:** Prepared checklist, not evidence of a created/configured repository.  
**Destination:** Proposed `https://github.com/beyondhumanwork/nail-it-down` (must confirm availability and access).  
**Release state:** Planning / pre-alpha.

## Stage A — Create the repository

- [ ] Create a **public** repo in `beyondhumanwork` with name `nail-it-down` (or approved alternative).
- [ ] Repository description: `Turn rough ideas into reviewed, implementation-ready briefs before your coding agent starts.`
- [ ] Topics: `command-code`, `coding-agent`, `ai-tools`, `typescript`, `requirements`, `developer-tools`, `open-source` (subject to GitHub topic availability).
- [ ] Add MIT license with appropriate actual rights holder; ensure original materials are ours, not third-party copyrighted text without notices.
- [ ] Add `README.md` with **pre-release** notice; do not display a fake demo, working install command or CI badge.
- [ ] Add `AGENTS.md` with cost, security, test and architectural guardrails.
- [ ] Add `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/EXECUTION_PLAN.md` and `docs/M0_HANDOFF.md` with dated status headers.
- [ ] Add `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` and templates only when they state a real process/route.
- [ ] Set issue labels and create milestone M0 with an explicit done checklist.

## Stage B — Protect development workflow

- [ ] Disable or tightly control any existing repo or org workflows that would run automatically; inspect GitHub Apps and actions before use.
- [ ] Start without automatic push-triggered workflows. M0 checks are manual or on explicitly selected supported remote compute.
- [ ] Configure `main` protections appropriate to available plan/permissions: no force-push or deletion and reviewable PRs, while avoiding rules that permanently block merges.
- [ ] If CI is later introduced, use standard runners, read-only default token, short timeout, `concurrency` cancellation, no automatic paid LLM evals, no scheduled workflows, no duplicated push/PR jobs.
- [ ] Create issue templates for bugs and features with repro steps, actual Command Code version, OS and expected/observed results.

## Stage C — Make it a high-quality public project

- [ ] First README screen: project name + promise, status, command example (clearly labeled *planned* until implemented), what the mod will and won't do.
- [ ] Demo should be real and reproducible, not a terminal mock presented as tested behavior.
- [ ] Installation instructions only after a verified installation in the tested host version.
- [ ] Privacy doc explains that users' selected model providers may receive approved snippets, and that local persisted state is not claimed encrypted.
- [ ] Compatibility table lists *tested* versions/modes only.
- [ ] Maintainer policy: triage issues, security disclosure, release notes, reproducible tests, support boundaries.
- [ ] Brand/social-preview image after name/trademark check; optional, not a blocker for M0.

## Stage D — Before beta release

- [ ] Validate against original `grilling` behavior on a fixed evaluation set with results publicly stated, including regressions.
- [ ] Manual source/license/dependency audit. Include third-party notices for any protected upstream copies.
- [ ] Confirm npm scope/name and trademark risks separately; GitHub repo name does not imply legal clearance.
- [ ] Dry-run `npm pack` to inspect package; verify no credentials, internal notes or large fixtures are included.
- [ ] Prefer npm trusted publishing if supported; release only on explicit approval.
- [ ] Publish npm package, then request inclusion in the Command Code Mods Hub registry by a PR; these are separate steps.

## Sequencing recommendation

1. Review architecture and spec here in ChatGPT High.
2. Create public repo and commit documentation (no product-code claims).
3. Hand M0 prompt to Pi.
4. Validate actual Command Code behavior, then release increments M1–M5.
5. Only then package/publicize.