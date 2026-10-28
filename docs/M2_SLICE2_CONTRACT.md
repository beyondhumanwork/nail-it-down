# M2 Slice 2 — isolated, consent-gated OS filesystem reader

**Authorization:** APPROVED for **M2 Slice 2 only** — 2026-10-28.  
**Base:** `main` at `cd9fcbdfeb0200ef5a2702b38691772a08657d94` (PR #15, M2 Slice 1 merged).  
**Historical authorization:** Slice 2 implementation was authorized here. **Current disposition:** accepted for synthetic-root feasibility only on 2026-10-28; see [M2 Slice 2 acceptance](M2_SLICE2_ACCEPTANCE.md). Real project repository access remains unauthorized.  
**Parent contract:** [M2 Slice 1](M2_SLICE1_CONTRACT.md). Its evidence and budget policies remain authoritative.

## Objective and trust boundary

Prove that the M2 policy can safely read a **small number of actual OS files inside disposable synthetic test workspaces**, and exercise a separate native-dialog consent helper. No live user/project repository, including this Nail It Down source repository, may be used as the read fixture. This is an isolated security experiment, **not deployment of repository awareness**.

The installed Command Code v1.88.0 does not expose a mod-callable `read_file` capability. Direct Node filesystem access is an implementation option only inside a separately reviewed reader module, not an authority granted to the live `/naildown` mod. Mods run with user privileges and are not sandboxed; this experiment cannot prove a universal OS security boundary.

### Authorized deliverables

1. A narrowly scoped synchronous `RepositoryReader` adapter implemented with Node filesystem APIs, in e.g. `src/host/nodeRepositoryReader.ts` (keep OS imports outside `src/core`). It is **not** imported by `src/index.ts` and never activated by the installed mod.
2. Small, explicit consent helper around the existing `ModUi.select` signature, in e.g. `src/host/repositoryConsent.ts`. It has *refuse* first, requires the literal grant label, handles dismiss/headless/unexpected values as refusal, and never causes a read itself. No new persistent consent flag.
3. Tests using **fresh disposable temp directories** populated with synthetic files and fake credentials. All test-created workspace contents and paths must be contained within a known temp fixture root. Clean up only fixtures owned by the test. Never assume the current working directory is a fixture.
4. An optional **isolated Command Code TUI consent-only** smoke test using a temporary test mod/workspace and existing host version, if it can be performed without altering global mods/settings or touching live sessions. No real repository file reads through the installed `/naildown` command.

Do **not** change `src/index.ts`, `src/core/discovery.ts` or the M1 persistence/approval modules merely to wire an experimental read. If essential to correct a discovered Slice 1 security defect, document it as a blocker and obtain review before broadening scope. Avoid new runtime dependencies.

## Required file-open safety rules

The OS-backed reader must implement the existing fixed root allowlist and respect `DEFAULT_BUDGET` as **hard ceilings**: 6 files, 32 KiB each, 96 KiB total, 250 lines each, 100 shallow entries. Caller inputs can only tighten policy.

- **Test workspace provenance:** accept a root only from explicitly constructed test fixtures; reject missing/not-directory roots and symlinked roots, including indirect or unexpected roots. Resolve the canonical root and ensure the candidate remains within it. Treat `cmd.cwd` as an untrusted string, not as proof of consent or workspace trust. Do not read a real repository to test this.
- **Path policy before OS access:** reject arbitrary, absolute, traversing, encoded, nested or non-allowlisted candidate paths using the Slice 1 policy. Directory enumeration is root-only. Do not resolve, stat, or open a forbidden candidate merely to decide it is forbidden.
- **Bounded listing:** do not load an unbounded directory into memory merely to check the 100-entry cap. Stop enumeration at cap + 1, close the directory handle on all paths, and report an over-limit refusal. Reject symlink and special-file entries; treat mismatches between listing and opening as unsafe.
- **Open race defenses:** when supported, open allowlisted files with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`; inspect the **opened descriptor** using `fstat`, require a regular file, and compare with safely captured pre-open identity when available. `O_NONBLOCK` is required to avoid hanging when opening a FIFO before `fstat` can reject it. Use `try/finally` to close every descriptor. Never follow a symlink just because it changed after listing.
- **Root and containment:** check canonical root and canonical candidate containment; avoid vulnerable string-prefix checks (e.g., `/work/a` vs `/work/ab`). A resolved path check by itself does **not** close the resolve/open TOCTOU window. Investigate parent-directory replacement, `openat`/dirfd availability, and race limitations in Node, Linux and macOS; **do not claim race-free containment if it cannot be demonstrated**. Because candidates are root-level fixed names, reduce parent traversal, but treat root swap as a separate threat.
- **Read bound on actual bytes:** inspect `fstat.size` before reading, then read incrementally with an absolute byte cap (at most 32 KiB + 1 for overflow detection). Detect growth, shrinkage and changed-file races; refuse unsafe/mismatched inputs rather than silently truncate or present a partial file as complete. Never decode binary, overlimit or malformed UTF-8 as verified evidence.
- **Errors:** `ENOENT`, `EACCES`, `ELOOP`, platform-unsupported flags, transient replacement and unexpected I/O errors produce bounded, non-secret, recoverable classifications. Do not echo absolute paths, symlink targets, error stacks, synthetic secret strings or file contents.
- **Trust boundary:** no shell execution, `cmd.exec`, network, model calls, outside-workspace files, auto-scanning, background watchers, session writes, exports or changes to approval. Repository documentation remains **untrusted data**.

Where platform capabilities do not provide a demonstrable safety guarantee, report **NOT PROVEN / BLOCKED**, not an invented pass. If the requested guarantee is unachievable within the approved Node-only design, stop rather than expanding scope to native bindings, child processes, elevation or broader filesystem privileges.

## Consent contract

Native `ui.select` must present a plain-language, scoped disclosure of **which root metadata/doc file categories and limits** are being requested. Clearly distinguish local file reading from *future* transmission to an external model, which is **not** permitted in Slice 2. Refusal must be the first and default-highlighted option.

The consent helper returns an explicit outcome; it must never read files. Dismissal, unavailable/headless UI, malformed label or exception -> refusal/no access. No consent inference from invoking `/naildown`, project trust, previous session, or a model-generated statement. No persistence, no re-use in future sessions without a separately approved policy. Tests prove zero reader calls without the explicit granted result.

## Test and acceptance matrix

Automated tests, on the authorized **MacBook** in an isolated archived worktree (no heavy ThinkPad tests), should include:

1. Exact synthetic root allowed; unsafe/nonexistent/symlink root rejected; root path containing symlink components and root replacement risk recorded.
2. Fixed allowlist and deterministic root-entry ordering; no recursive or outside reads; 100/101 entry boundary.
3. In-root regular file accepted; symlink to inside/outside, dangling, self/cycle, and final-component symlink swap refused.
4. Opened-descriptor `fstat` rejects FIFO, socket, directory, device or non-regular entries without hang. Use bounded timeouts in the **test harness** for potentially blocking cases.
5. Oversize file rejected before content read, file growing/shrinking mid-read refused, and exact byte/line/file budgets unchanged.
6. Missing file, permission denied and descriptor/listing disagreement reported without untrusted diagnostic text.
7. Source bytes are fed to the existing Slice 1 `selectCandidates` / `declaredDependencyEvidence` / `reverifyEvidence` without a second policy engine; source-backed facts stay precise; forged source paths remain unread.
8. Fake credential under an allowlisted filename is refused with no raw contents in output, logs or reports; `.env` never opened.
9. Consent helper: refusal first, explicit grant only, Enter/default refusal, dismissed/headless/unexpected/exception refusal, zero reads without consent.
10. Test fixtures cleaned safely, and no live project content is opened. No changes to the real `/naildown` registration or M1 storage.

Retain the existing **338-test** baseline and run full tests and `tsc --noEmit` against the exact committed tree. Record actual OS and Node versions; tests on a single host OS do not establish cross-platform support. Real Command Code TUI verification, if performed, is only for consent UI using an isolated test harness: scripted keystrokes are not a human usability test.

## Stop conditions, handoffs, and next gate

Pi uses a new branch `feat/m2-slice2-os-reader` from merged `main`, commits/pushes if authorized, produces full and short dated Markdown handoffs under `/home/ahmed/limitless/Shared/agent-output/nail-it-down/`, and **stops without creating or merging a PR**. Keep synchronization to MacBook Desktop and private Limitless GitHub mirror non-blocking; do not poll, sleep or manually trigger the bridge.

ChatGPT independently reviews the security code, tests and evidence before any PR merge. M2 Slice 2 is accepted only for **synthetic-root adapter feasibility**, not real-repository safety or full M2 completion.

**Not authorized:** `/naildown` integration for real user workspaces, persistent evidence, session schema changes, model/provider context submission, command execution, CI, host upgrade, public release, M2 Slice 3 or M3+. Any later use of actual user repository files requires a separate consented-runtime authorization and independent security gate.
