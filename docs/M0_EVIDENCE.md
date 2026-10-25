# M0 evidence report — Command Code host feasibility

**Milestone:** M0 only. Implementation branch `feat/m0-commandcode-host-spike`.
**Contract:** [M0_ACCEPTANCE.md](M0_ACCEPTANCE.md) · **Handoff:** [M0_HANDOFF.md](M0_HANDOFF.md) · **Issue:** [#2](https://github.com/beyondhumanwork/nail-it-down/issues/2)
**Date of runs:** 2026-10-20 / 2026-10-21 (UTC).

This report records what was actually executed and observed. Where a check could not be run, it says
**NOT RUN** and why. Nothing here is inferred from documentation alone.

---

## 1. Environment

| Item | Value |
| --- | --- |
| Command Code | **1.84.0** (`cmd --version`, npm package `command-code@1.84.0`) |
| Host install | `/home/ahmed/.bun/install/global/node_modules/command-code` (existing installation) |
| Node (host machine) | v24.12.0 |
| npm (host machine) | 11.6.2 |
| OS (host machine) | Archcraft Linux, kernel `7.2.11-arch1-1`, x86_64 |
| Unit tests / typecheck machine | macOS 13.7.8 (x86_64), Node v24.12.0, npm 11.7.0 |
| TypeScript | 5.9.3 (devDependency) |
| `@types/node` | 24.19.2 (devDependency) |
| Runtime dependencies | **none** |

Unit tests and typechecking ran on the macOS machine. Interactive host verification ran on the
Linux machine, because that is the only machine with Command Code installed and signed in.
The Linux machine was used **only** for lightweight manual host verification — no builds, test
suites, CI or deployments ran there.

The action interface used in every hand-written test below is
`cmd --mod <repo>/src/index.ts --trust --skip-onboarding --no-auto-update`.
`--trust` suppresses the workspace trust prompt and turns on the host's permission bypass; the mod
never runs a tool, so that setting has no bearing on anything this report claims.

---

## 2. What was built

```
src/index.ts              mod factory, slash command, the M0 flow
src/host/modApi.ts        the ModApi slice this mod uses (types only, no runtime import)
src/core/commands.ts      argument parsing (goal vs status/resume/help)
src/core/record.ts        record schema, validation, pure transitions
src/core/persistence.ts   workspace-keyed reads/writes over a minimal key/value store
src/core/workspace.ts     workspace identity from the host-provided cwd
src/core/copy.ts          every user-facing string
test/fakeHost.ts          fake host mirroring observed host behaviour
test/*.test.ts            57 unit tests
```

The host adapter is deliberately thin: `src/host/modApi.ts` is a type file, and `src/index.ts`
touches exactly three host members — `addCommand`, `ui.select`, `store.get/set/delete`. `exec` is
absent from the command-context type, so a stray process call cannot compile.

M0 saves one record per workspace: the goal, one hard-coded answer, and (only when explicitly
confirmed) an approval timestamp.

---

## 3. Reproduce the checks

### 3.1 Unit tests and typecheck (any machine with Node 22.18+)

```bash
npm install          # devDependencies only: typescript, @types/node
npm run typecheck    # tsc --noEmit
npm test             # node --test test/*.test.ts
```

Observed result on macOS 13.7.8 / Node 24.12.0:

```
TYPECHECK=OK
ℹ tests 57
ℹ pass 57
ℹ fail 0
```

### 3.2 Interactive host smoke test

```bash
# Inspect the host-managed per-mod store; do not delete it as test cleanup.
# A single store file may contain records for multiple workspaces.
ls ~/.commandcode/mods/.store/

cd /tmp && mkdir -p m0-ws-one m0-ws-two

cmd --mod /path/to/nail-it-down/src/index.ts --trust --skip-onboarding --no-auto-update

# inside the TUI
/nail                  # autocomplete must list /naildown with its description
/naildown Add subscriptions to my app
                       # answer the question, then answer the approval question
/naildown status
/exit                  # then start Command Code again in the same directory
/naildown status       # the answer is still there
```

Repeat from `/tmp/m0-ws-two` to see that the two workspaces do not share state.

A terminal multiplexer is convenient because a dialog that steals focus is easier to inspect, but
it is not required.

---

## 4. Acceptance matrix — results

Each row quotes observed output. Full transcripts and screen captures were produced interactively;
the excerpts below are verbatim.

| ID | Check | Result | Evidence |
| --- | --- | --- | --- |
| M0-01 | Loads via `cmd --mod ./src/index.ts` with no load errors | **PASS** | `cmd mods inspect ./src/index.ts` → `hooks: none`, `registers: slash command`, `reaches: persists data (cmd.store)`, `imports: none`. TUI started on `Command Code v1.84.0` with no mod warning rows, and `/naildown` executed. |
| M0-02 | `/naildown <goal>` registers, appears in autocomplete, keeps full goal text | **PASS** | Autocomplete row: `/naildown   Settle what you are building before anything gets built`. Typed goal `Add "workspace" subscriptions, then ship v2?` came back byte-identical in the message and in the store. |
| M0-03 | One hard-coded question; one explicit choice recorded | **PASS** | Modal rendered `Who is going to use this?` with four options and their consequences; `Down` + `Enter` on `One team`; store recorded `answer.answer = "One team"`, `questionId = who-uses-this`. No model call (see M0-10). |
| M0-04 | Cancellation creates no answer and no approval | **PASS** | `Esc` on the question → `No answer was recorded, so nothing is approved.` Store for that workspace: `status: "awaiting_answer"`, no `answer`, no `approvedAt`; the other workspace's record was untouched. |
| M0-05 | Answer persists across **process exit and restart** | **PASS** | `/exit` → tmux server gone and no `command-code` process remained → fresh `cmd --mod` process → `/naildown status` reported `Goal: Add "workspace" subscriptions, then ship v2?`, `Answer: One team`. Repeated after an approval: `Approval: approved 2026-10-21 00:42 UTC (test only)`. |
| M0-06 | Two workspace paths do not share answers | **PASS** | In `/tmp/m0-ws-two`: `Nothing is saved for this workspace yet (/tmp/m0-ws-two).` while `/tmp/m0-ws-one` kept its record. One store file, two distinct keys: `session.v1:/tmp/m0-ws-one`, `session.v1:/tmp/m0-ws-two`. |
| M0-07 | Failed write is handled and never reports saved | **PASS** | Store file made read-only (`chmod 0444`), then: goal write → `I could not save your goal to disk: EACCES: permission denied, open '…/src.json'` + `Nothing is approved, and restarting Command Code would lose it.` and the question was not asked; answer write → `I could not save your answer to disk: EACCES: …` + `The question stays unanswered`, and the store on disk stayed `awaiting_answer`. Approval-write failure is covered by unit test only. |
| M0-08 | Approval defaults to No; denial cannot persist approval | **PASS (after a design change, see §5.2)** | `ui.confirm` pre-highlighted `Yes`, so it was rejected. The approval now uses `ui.select` with the refusal first: observed `❯ 1. No, do not approve` / `2. Yes, approve`. `Enter` on the default → `Not approved: you chose not to approve.` with no `approvedAt` in the store. Explicit `Yes, approve` → `Marked approved, as a test.` and `approvedAt` written. |
| M0-09 | Headless cannot approve or invent an answer | **NOT RUN (blocked by host)** | `cmd -p` does not dispatch mod slash commands; the text becomes a model prompt. See §5.4. There is therefore no host path that reaches the handler headlessly, so the mod cannot approve anything there — but the host-side behaviour is unverified, not proven. |
| M0-10 | No model calls, subprocesses, repo scans or implementation writes at runtime | **PASS** | `cmd mods inspect`: `hooks: none`, `reaches: persists data (cmd.store)`, `imports: none`. Source scan for `cmd.model`, `cmd.exec`, `cmd.process`, `fetch(`, `require(`, `node:fs`, `child_process`: no matches. The `/tmp/m0-ws-two` project has **no session transcripts** — no model turn ever ran there. See §5.5 for the two unrelated headless model runs. |
| M0-11 | Schema/version present; unknown or corrupt values fail safely | **PASS** | Unit tests cover unknown version, missing version, non-object, incomplete answer, and "answered without an answer". Host test: a record was rewritten to `schemaVersion: 99` and Command Code restarted → `Saved data for this workspace cannot be read by this version: saved data uses schema version 99, this version expects 1` … `I left it untouched.` The file was unchanged and then restored. |
| M0-12 | Documentation lists real limitations and which checks ran | **PASS** | This document, plus the PR body. |

---

## 5. Host API findings

These are the differences between the published docs and the installed host (1.84.0). Each was
confirmed by reading `dist/cli.mjs` and/or by observation in a live session.

### 5.1 `@commandcode/harness` is not published

The docs and every bundled example import `type {ModApi} from '@commandcode/harness'`. That package
returns 404 from the npm registry, so a standalone mod cannot typecheck against real typings.
`src/host/modApi.ts` therefore declares the slice this mod uses, transcribed from
`dist/bundled/mod-builder/reference/*.md` and `dist/cli.mjs`. It is a hand-maintained contract and
must be re-checked when Command Code changes.

### 5.2 `ui.confirm` cannot default to No

The implementation is effectively:

```js
confirm: async ({title, message}) => {
  const picked = await askQuestion({
    questions: [{question: message ? `${title}\n${message}` : title, options: [{label: 'Yes'}, {label: 'No'}]}],
    hideCustomInput: true,
  });
  return picked.answers[0]?.selectedOptions[0] === 'Yes';
};
```

The host pre-highlights the first option, so the modal opens on **Yes** and `Enter` approves. That
contradicts "dummy approval defaults to No". `ui.select` is the only dialog whose first option can
be the refusal, so approval now uses a `select` with `No, do not approve` listed first. Only the
literal approval label counts as approval, and a dismissed dialog (`undefined`) does not.

Observed in the live TUI:

```
Approve this? Nothing will be built from it.
❯ 1. No, do not approve
     Nothing is approved. This is the safe answer.
  2. Yes, approve
     Records a test approval and nothing else. No plan, no code.
```

### 5.3 `ui.select` returns the label, not a value

Dialog options are `{label, description?}` and the resolved value is the selected **label**
(`options.some(o => o.label === picked) ? picked : undefined`). The pane `select` *element* has a
`value` field; the dialog does not. The mod therefore stores labels and never relies on a value field
that does not exist.

### 5.4 `cmd -p` does not dispatch mod slash commands

Print mode calls `runHarnessQuery` → `harness.runTurn({userInput})`; it never calls
`parseSlashCommand` or the command resolver that the interactive TUI uses. A headless
`cmd -p '/naildown status'` sends that text to the model as a normal prompt.

This blocks M0-09. It also means the host's documented headless dialog defaults (`select` →
`undefined`, `confirm` → `false`) cannot be reached through this mod's command in 1.84.0. Those
defaults are covered by unit tests against `test/fakeHost.ts`, which mirrors them — that is a
modelled check, not host evidence, and is not claimed as one.

A future milestone could expose a non-interactive surface another way (for example an explicit
`--mod-option`-driven status command that the model is never given), but that is a product decision,
not an M0 fix.

### 5.5 `store.set` updates memory before disk

```js
set: async (key, value) => { memory.set(mod, {...memory.get(mod), [key]: value}); await writeFile(...); }
```

A rejected write leaves the new value visible to `store.get`. Without a countermeasure, the same
session's `/naildown status` reported an answer that never reached disk — a false claim by another
route. `save()` in `src/index.ts` now restores the last good record (or removes the key) when a
write fails, and re-verified in the live host:

```
◼ I could not save your answer to disk: EACCES: permission denied, open '…/src.json'
Nothing is approved.
Goal saved: Rollback check. The question stays unanswered.
◼ Workspace: /tmp/m0-ws-two
Goal: Rollback check
Answer: none yet            ← matches disk, no false "saved"
```

### 5.6 Store layout, naming and command parsing

- `cmd.store` is **one JSON file per mod**: `~/.commandcode/mods/.store/<mod-name>.json`. The mod name
  comes from the loaded path, so `src/index.ts` produced `src.json`. Workspace isolation is therefore
  the key (`session.v1:<workspace>`), as intended by the architecture.
- `store.get` is synchronous; the file is read before the factory runs, and parse errors fall back to
  an empty store silently. Corrupt data is not surfaced by the host — the mod has to validate, which
  it does (`M0-11`).
- Slash commands are parsed with `/^\/([A-Za-z0-9_:-]+)\s*([\s\S]*)$/` against a **single-line**
  message; a newline makes the text an ordinary prompt. Goals are single-line in M0.
- Command handlers may be `async`; the host awaits the handler and renders a truthy `message` as a
  feed row. This mod depends on that and returns a non-empty message on every path.

### 5.7 Modals take focus, and the free-model notice swallows the first Escape

A startup notice ("MiniMax … is free … esc to dismiss") absorbed the first `Esc`; the second
dismissed the question. This is host UI behaviour, not mod behaviour, and it is why the M0-04 run in
§4 took two `Esc` presses. Worth knowing before writing user-facing instructions.

---

## 6. Limitations this milestone accepted

- **Single fixed question.** One question, one answer, one dummy approval. No decision graph.
- **One record per workspace.** Starting a new goal replaces the workspace's previous record; there
  is no history and no `cancel`/`forget` subcommand yet.
- **No headless surface** (see §5.4).
- **Workspace identity is the literal `cwd` string.** Trailing slashes are normalized; symlinked paths
  count as separate workspaces. No `realpath` is performed, because that would mean filesystem work
  the mod is not supposed to do in M0.
- **Storage is not encrypted** and the review copy is unredacted user text. Same caveat as the
  architecture document.
- **`src/host/modApi.ts` is hand-written** and can drift from the host. Re-check it on every Command
  Code upgrade.
- **Approval-write failure** is covered by unit tests only; the live fault injection was used for the
  goal and answer writes.

## 7. Disclosure: two inadvertent headless model runs

While establishing that `cmd -p` does not dispatch mod commands (§5.4), two `cmd -p '/naildown …'`
invocations were run in `/tmp/m0-ws-one`. Both were interpreted as ordinary prompts and consumed
model usage on the session's model (`minimax/minimax-m3.1-flash:free`). The second was stopped after
100 s. Neither was started by the mod; the mod itself made no model requests in any run.

Their transcripts are under `~/.commandcode/projects/tmp-m0-ws-one/` and are the only model activity
associated with this milestone. No secrets were read or printed.

## 8. What was deliberately not done

No model integration, repository reading, file writes, subprocesses, network calls, background jobs,
Markdown export, decision DAG, packaging, npm publication, Mods Hub submission, CI workflows, or M1
work of any kind.

## 9. Recommendation

M0 host feasibility is demonstrated for the interactive path. Ready for independent review. M1 should
not start until the owner decides what to do about:

1. a non-interactive/agent-facing surface (`M0-09`), and
2. whether approval should stay a two-option `select` (it is honest, but slightly less conventional
   than `confirm`).
