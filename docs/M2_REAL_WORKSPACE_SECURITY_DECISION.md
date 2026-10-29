# M2 — Real-Workspace Security Decision

**Status: PROPOSED.** Owner and independent-review acceptance pending. This document is a recommendation; it is **not** authorization to read a real repository, and nothing here changes runtime behaviour.

| | |
|---|---|
| Slice | M2 Slice 3B1 (Deliverable A) |
| Contract | [`M2_SLICE3B1_CONTRACT.md`](M2_SLICE3B1_CONTRACT.md) |
| Preceded by | [Slice 2 acceptance](M2_SLICE2_ACCEPTANCE.md), [Slice 3A acceptance](M2_SLICE3A_ACCEPTANCE.md) |
| Written | 2026-10-28 |
| Runtime evidence | Node **v24.22.1** (ThinkPad, `node -v`), Node **v24.12.0** (MacBook, test host), Command Code **v1.88.0** |
| Authorized by | 3B1 only — design and one bounded scanner fix |

---

## 1. Decision

**Adopt Option A: a cooperative local-workspace model** for any future v0.1 real-workspace inspection, with the explicit refusals in §6 and the accepted risks in §11.

The reasoning in one paragraph. The mod's value is citing facts from *the developer's own project*, on *the developer's own machine*, under *the developer's own consent*. The threat that actually matters for that product is accidental over-collection — reading the wrong files, reading more than disclosed, sending something to a model, or keeping something it should not — and every one of those is addressable in-process with bounded reads, a fixed allowlist and default-deny consent. The threat that Option B addresses is different in kind: an attacker with write access to the workspace *while* the mod reads it, racing a directory swap to redirect the read outside the consented root. Defending that requires OS-enforced containment that Node does not expose (§9), and buying it costs a subprocess or native addon, per-platform code and a signed build pipeline — for an MIT-licensed mod that currently ships as one TypeScript file. Option A refuses to *claim* that containment, states the residual race in the UI, and keeps working for the overwhelming majority of users whose repository is not being attacked in that window.

**Option C (idea-only) remains the correct behaviour whenever any precondition in §6 fails.** The recommendation is not "always read the user's repo"; it is "read only the workspace the user just pointed at, under the conditions below, and otherwise stay idea-only."

---

## 2. Protected assets

| Asset | Why it matters | Consequence if mishandled |
|---|---|---|
| **Private source code** | The user's commercial and personal work | Disclosure to a third party, or to a model provider |
| **Credentials in the workspace** | `.env`, keys, tokens, CI secrets, cloud configs | Direct account compromise |
| **The user's consent** | The only thing separating "helpful" from "unauthorized access" | Reading without permission destroys the product's premise |
| **The local filesystem outside the workspace** | Home directory, SSH keys, other projects, OS files | Scope escape — the worst failure this product can have |
| **Integrity of what the mod reports** | Citations are the product's whole claim | A fabricated or stale citation is worse than no citation |
| **Future model context** | Anything sent to a provider leaves the machine | Irreversible; outside the user's control once sent |

Note the ordering. **Consent and scope outrank confidentiality.** A mod that reads only what it was told to read, and says so honestly, is safer than one that reads broadly but redacts well.

---

## 3. Trust boundaries and actors

### In scope for Option A

| Actor / condition | Treatment |
|---|---|
| **The developer using the mod** | Trusted to choose a workspace. Not trusted to have read the disclosure carefully — so the scope is shown, not implied. |
| **Untrusted repository *content*** | README text, comments, `AGENTS.md`, dependency names are **data, never instructions**. Already enforced: file content is quoted as evidence and never executed, followed, or treated as a directive. |
| **Untrusted dependencies** | Out of the read path entirely. Only six root-level files are ever candidates. |
| **Accidental over-collection** | Bounded by a hard allowlist and four independent ceilings (§7). |
| **A symlinked or ambiguous root** | Refused. The root may not be a symlink; ancestors are resolved before comparison. |
| **A root that changes identity between consent and read** | Detected by device/inode re-check and refused. |
| **Headless / non-interactive host** | Default-deny: `select` returns `undefined`, which is not a grant. Already true of the consent helper. |

### Out of scope for Option A — explicitly **not** promised

| Threat | Why it is out |
|---|---|
| **Adversarial concurrent filesystem mutation** — a parent directory replaced mid-read to redirect the open outside the consented root | Node exposes no directory-relative open (§9). Detectable, not preventable. **Detected, reported, not prevented.** |
| **A hostile workspace owner** — the user is attacked by the repo they opened | The model assumes the developer owns and controls the workspace. If they do not, they are outside the supported model. |
| **A compromised host process** — malware already running as the user | It can read everything the mod can. Containment is meaningless at this layer. |
| **Kernel, filesystem driver or mount-table compromise** | Below the process. |
| **Malicious content trying to manipulate the model** | Prompt injection is a *content* problem, mitigated by treating text as data, not by filesystem containment. |
| **Multi-user or shared-machine separation** | A single-user developer tool. |
| **Secrets we fail to detect** | Detection is defense-in-depth, never a guarantee. |

**This is the honesty that matters most.** Option A does not make the race disappear; it removes the *claim* that the race is handled. A user who needs protection against a hostile concurrent writer needs Option B, and should not be told Option A covers them.

---

## 4. Why `cmd.cwd` is not authorization

`cmd.cwd` is documented by the host as the *workspace root* — a string the host supplies to a mod factory. It is a **statement about where the session started**, not a statement by the user that this directory may be read.

Four reasons it cannot serve as consent:

1. **It is not an act.** Authorization is something a person does. `cmd.cwd` is something a process computed, often from the shell's working directory at launch. Running `nail-down` in `~/` would make the home directory "authorized" without anyone deciding that.
2. **It is ambient and can be broad.** The user may have launched the host from a monorepo root, a home directory, or `/`. Scope must shrink from that, never inherit it.
3. **It is not verifiable by the mod.** It is a caller-supplied string, exactly like the `permittedParents` parameter the Slice 2 review already flagged as "caller-controlled provenance, not an independent trust anchor."
4. **It does not express which files.** Consent that names a directory but not the six files the mod will read is consent to something the user cannot picture.

**Conclusion:** `cmd.cwd` may be used to *propose* a root for display. It must never be treated as approval, and the mod must not read even `stat` of the proposed root before an explicit grant.

---

## 5. What the user must see before any filesystem access

The consent surface is the security boundary. It must show, in this order, before the first metadata call:

1. **The exact proposed root**, as the user would recognize it — the string as selected, not yet canonicalised.
2. **The exact file set** the policy will consider: the fixed six-name allowlist, by name.
3. **The hard ceilings**: at most 6 files, 32 KiB per file, 96 KiB physically read per invocation, 250 lines per file, 100 root entries.
4. **What is excluded**: dotfiles, `.env*`, `.git`, credentials, caches, and everything not on the allowlist.
5. **What will not happen**: nothing leaves the machine; nothing is sent to a model; nothing is written to the workspace.
6. **Refusal first**, pre-highlighted, phrased as the safe answer — as the existing helper already does (`Do not read anything`).

Only after a grant does the mod resolve the root. If realpath resolves somewhere materially different from what was shown, the mod **stops and says so** rather than proceeding into a path the user did not approve. Resolving first and displaying second would invert the rule — `realpath` is itself a filesystem operation.

---

## 6. Refusal rules — when the answer is idea-only

Any one of these fails closed to idea-only, with a stated reason and no fallback to a "nearby" directory:

| Condition | Behaviour |
|---|---|
| No consent, dismissed dialog, headless host | Zero filesystem operations. Already proven. |
| Root is missing, not absolute, not a directory | Refuse before listing. |
| Root is a symlink | Refuse. A link is an indirection the user did not approve. |
| Root resolves outside the parent chain the consent displayed | Refuse, name the discrepancy. |
| Root identity changes between consent and read | Refuse that invocation; do not retry silently. |
| Root is a network mount or a filesystem whose semantics we have not measured | **Refuse in v0.1.** Local, fixed-semantics filesystems only. Node **can** report filesystem statistics (`fs.statfs`, §9.4), but that does not identify a mount reliably on every platform — the pilot must either restrict to a verified platform or take the user's declaration. See unresolved question 3. |
| Anything other than a regular file at a candidate path | Refuse that candidate: symlink, FIFO, socket, device, directory. |
| File exceeds any ceiling | Refuse that file; keep the rest; report `total-too-large` / `unreadable` honestly. |
| Listing fails or is empty | Report "nothing readable" — **never** "the project has no such file". `list` has no error channel today. |
| Content trips secret detection | Refuse the file. Detection is incomplete, so this reduces risk; it does not remove it. |
| Consent not granted **for this invocation** | No reuse. Consent is never persisted and never implied by a previous run. |

**Unknown or unusual is a refusal, not a guess.** The policy has 30 enumerated rejection reasons precisely so that "I don't know" never becomes "probably fine."

---

## 7. Consent, expiry and default-deny

**Consent is per invocation and never stored.** Three properties, each already true of the shipped helper:

- **Default-deny.** Every path that is not an explicit positive selection is a refusal: `undefined`, dismissal, an unexpected label, a thrown dialog, a host without a UI. Headless hosts return `undefined` from `select`, and the helper treats that as denial rather than a default.
- **No persistence.** Nothing is written to `cmd.store` or to disk. There is no "remember my answer", because a stored grant is a grant the user cannot see at the moment it takes effect.
- **No implied consent.** A previous invocation's grant does not carry. The mod does not read on startup, on session start, or on model initiative.

**Expiry is structural, not timed.** Consent ends when the invocation ends. There is no expiry clock to get wrong and no window during which a stale approval is still live.

Two future options, deliberately not chosen:

- *Session-scoped consent* ("allow for this session") would reduce friction but creates a persistent authority the user must remember. If ever added, it must be visible in the UI for as long as it is live.
- *Project-scoped stored consent* is rejected outright. It converts a deliberate act into a configuration value.

---

## 8. Local reading is not permission to transmit

These are separate grants and must stay separate:

| Grant | Authorizes | Does **not** authorize |
|---|---|---|
| Read this workspace locally | Reading the six allowlisted files on this machine | Sending any of it anywhere |
| Show me citations | Rendering a short excerpt in the terminal | Including it in model context |

**Why the separation is not pedantic.** Reading is local, reversible, and inspectable — the bytes stay on the machine and the user can see exactly what was read. Transmission is irreversible and leaves the machine. A user who wants help understanding their project is not thereby agreeing that a model provider should receive their source.

For v0.1 the rule is absolute: **no repository content is sent to a model, by default or otherwise.** If a later milestone revisits this, it requires its own explicit, separate consent naming the provider and the exact payload, and the mod must be able to show precisely which excerpts would leave. Nothing in Option A changes that.

Practical corollaries already enforced or required:

- The mod makes **no network requests** of its own.
- **No telemetry.** No usage events, no "anonymous" counters.
- **No transcript excerpts.** Reading does not grant permission to quote source into the conversation.
- **No persistent evidence.** Nothing is written to `cmd.store`; a citation exists for the length of the invocation.
- **No shell, no writes.** The reader is read-only by construction; `cmd.exec` is not used.

---

## 9. Platform evidence: what Node actually proves

### 9.1 The APIs that exist (verified)

On the installed runtimes — Node **v24.22.1** (ThinkPad) and **v24.12.0** (MacBook) — and per the official documentation for the v24 line (`https://nodejs.org/docs/latest-v24.x/api/fs.html`, page footer "Node.js v24.22.2 Documentation", retrieved 2026-10-28):

| API | What it gives us | What it does not |
|---|---|---|
| `fs.realpathSync` | Canonical path with symlinked ancestors resolved | Does not bind subsequent opens to that resolution |
| `fs.openSync(path, O_RDONLY \| O_NOFOLLOW \| O_NONBLOCK)` | `O_NOFOLLOW` documented as "fail if the path is a symbolic link" — protects the *final* component | Does not protect ancestor components |
| `fs.fstatSync(fd, {bigint: true})` | Identity of what was *actually opened*: dev, inode, size, mtime, ctime | Says nothing about whether the path still means the same thing |
| `fs.opendirSync` → `fs.Dir` | Shallow directory iteration | Directory *stream*, not an anchor for opening children |
| `fs.statfsSync` / `fs.statfs` / `fs.promises.statfs` | Filesystem statistics for the mount containing a path: `type`, `bsize`, `blocks`, `bfree`, `bavail`, `files`, `ffree` | The `type` number is platform-dependent and undocumented; it is **not** a filesystem *name*, and there is no portable mapping (see §9.4) |
| `fs.constants` | `O_RDONLY`, `O_NOFOLLOW`, `O_DIRECTORY`, `O_NONBLOCK`, `O_NOATIME` (Linux only), … | — |

### 9.2 What does **not** exist — and this is the crux

**Node exposes no directory-relative open.** There is no `openat`, no `fstatat`, no `fdopendir`, and no way to pass a directory descriptor as the base for a path.

Verified two ways:

1. **Empirically on both installed runtimes.** Enumerating `node:fs` yields no `*at`/dirfd member (the only matches are `fstat`/`lstat`/`stat`, which are path or descriptor *stats*, not dirfd-relative opens); `fs.openSync.length === 3` and a numeric first argument raises `ERR_INVALID_ARG_TYPE` — the signature is path-based and nothing else.
2. **By the upstream request's outcome.** [nodejs/node#31110, "accept Directory File Descriptors as a base for fs open & readdir"](https://github.com/nodejs/node/issues/31110) (opened 2019-12-27, closed 2022-04-04 as stale, unimplemented) states the need directly and records why it stalled: it "needs to be implemented in libuv first", and while `openat()`/`fdopendir()` are widely available, the companion `fchmodat`/`fstatat`/`linkat` family is "much spottier".

So the guarantee we would need — *open this file relative to a directory handle I already verified, atomically* — is **not reachable through Node's public API at all**. That is the single fact that decides this memo.

### 9.3 What the current reader therefore does and does not prove

| Property | Status |
|---|---|
| Root may not be a symlink; its identity re-checked per operation | Proven (Slice 2) |
| Symlinked ancestors resolved before comparison (`/tmp` → `/private/tmp`) | Proven |
| Opened descriptor `fstat`ed; symlink swapped in after listing fails `O_NOFOLLOW` | Proven |
| Non-regular files refused by descriptor type | Proven for FIFO; device nodes **NOT VERIFIED** (none created) |
| Same-inode same-size rewrite detected via bigint mtime/ctime | Proven for the tested case; bounded by filesystem timestamp resolution |
| **A parent directory replaced between `realpath` and `open`** | **NOT PREVENTED.** Detectable; the window is real |
| **Case-folding / Unicode-normalising filesystems** | **NOT VERIFIED** |
| **Network / distributed mounts** | **NOT VERIFIED**, and not verifiable with a single API — see §9.4 |
| **Listing failure distinguishable from an empty directory** | **NO** — `RepositoryReader.list` has no error channel |

These are not gaps we chose; they are gaps the platform imposes. The honest response is to scope the product to where they do not bite, and to say where they do.

### 9.4 Filesystem type: what `fs.statfs` proves and what it does not

Node 24 **does** expose filesystem statistics. `fs.statfs()`, `fs.statfsSync()` and `fs.promises.statfs()` return an `fs.StatFs` object, documented as "Provides information about a mounted file system" and added in v19.6.0 / v18.15.0 (`https://nodejs.org/docs/latest-v24.x/api/fs.html`, retrieved 2026-10-28). The fields are `type`, `bsize`, `blocks`, `bfree`, `bavail`, `files`, `ffree`, and the set is not identical on every platform — macOS omits `frsize`, which Linux exposes.

An earlier revision of this memo said statfs-style detection was "unavailable in Node". **That was wrong**, and it is corrected here.

What the API actually gives, measured on the installed runtimes (2026-10-28):

| Platform | `statfsSync(path).type` | Interpretation |
|---|---|---|
| Linux (Node v24.22.1) | `/` → `0xEF53`, `/tmp` → `0x01021994`, `/proc` → `0x9FA0` | The kernel `f_type` magic. `0xEF53` = ext4, `0x01021994` = tmpfs, `0x9FA0` = proc |
| macOS 13.7.8 (Node v24.12.0) | `/` → `26`, `/dev` → `19`, `/System/Volumes/Preboot` → `26` | A **different, undocumented** numbering. `26` = apfs, `19` = devfs, and `mount(8)` confirms both |

So the number exists everywhere, but **it is not one namespace**. On Linux it is the documented `statfs(2)` magic; on Darwin it is an unrelated code whose mapping is not published, and the platform's real filesystem name — `f_fstypename`, the `"apfs"` / `"nfs"` / `"smbfs"` string that `mount(8)` prints — is **not exposed at all**.

What this means, stated carefully:

- **Proven:** a filesystem-type *number* can be read for a path on both measured platforms.
- **Not proven:** that any given number means "remote". A table of magics is a Linux-shaped idea; its macOS equivalent would be reverse-engineered, not documented.
- **Not proven, and more important:** that local-vs-remote is even the right question. A bind mount of an NFS export can present a local filesystem's magic. A FUSE or sshfs mount reports FUSE. A cloud-synced folder (Dropbox, iCloud Drive, OneDrive) is an ordinary local filesystem whose *contents* change out from under a reader. A Samba share and an NFS export may or may not report distinguishable codes depending on kernel and mount options.
- **Decisively:** a filesystem-type number says **nothing** about whether the mount is trustworthy, whether the user meant to point at it, whether it is immune to concurrent replacement, or whether the root inside it is the one that was consented to. It is not a security control. It is a hint.

**Therefore the v0.1 rule stands unchanged, but for a corrected reason:** the pilot restricts itself to local, fixed-semantics filesystems and takes the user's declaration, and it must **either** verify the platform it runs on **or** say that it cannot verify. It must not present a `type` check as evidence that a workspace is safe.

**Reproducible future probe** (not run in this slice; requires a second machine and disposable fixtures only):

1. On Linux, record `statfsSync` for: a disposable `mkdtemp` directory on ext4, one on tmpfs (`/dev/shm`), and — if a test export can be arranged — one mounted from NFS and one from CIFS. Record the magic for each and confirm against `statfs(2)`.
2. On macOS, do the same for: a disposable `mkdtemp` directory on APFS, a disposable encrypted disk image (`hdiutil attach` of a throwaway image, never a user volume), and — if available — an SMB or NFS mount. Record `type` **and** the `f_fstypename` that `mount(8)` reports, and note that the string is unavailable to Node.
3. Cross-check the two tables. If any macOS code collides with a Linux magic (e.g. a small enum value equal to a known magic), that alone disproves the single-table approach.
4. Record whether any proposed check produces a **false "local"** for a deliberately remote mount. A check that fails that test is not a control.
5. Restore: unmount and delete every fixture; confirm no user volume was touched.

Until that probe exists on two operating systems, the honest status is **NOT VERIFIED**, and the memo must not imply otherwise.

### 9.5 The host is not a sandbox either

Command Code's own mod documentation is explicit: *"There is no sandbox — install packages you trust."* A mod is arbitrary code in the host process with the developer's full filesystem privileges. Therefore:

- **The mod is trusted code.** Installing it is the security decision; everything after that is policy the mod imposes on itself.
- **Project-scope mods are trust-gated**, but **user-scope and `--mod` mods always load**. The host's project trust prompt is *not* the mod's file-reading consent, and must never be presented as such.
- **Headless is default-deny**: dialogs degrade to `confirm → false`, `select/input → undefined`, and are "never auto-approved".

---

## 10. The three options

### Option A — Cooperative local-workspace model *(recommended)*

Inspect a workspace the developer owns and just pointed at, under explicit per-invocation consent, a fixed six-file allowlist and hard ceilings. Say plainly that a hostile concurrent writer is outside the model.

| Dimension | Assessment |
|---|---|
| Security | Strong against over-collection, scope creep, stale consent, and accidental disclosure. **Does not resist** adversarial parent swaps. |
| Complexity | Low. One module; no new runtime dependency; the existing policy already implements every refusal. |
| Portability | Full. Pure Node, one code path, macOS and Linux alike. |
| Dependency cost | Zero new dependencies. Ships as one TypeScript file, jiti-loaded. |
| Usability | Meets the product's actual job: "cite facts from my project." One dialog, one grant. |
| Feasibility | **Ready.** Slices 1–3A already implement it end-to-end against synthetic roots. |

### Option B — OS-enforced isolation

Only worth it if *resisting an adversarial concurrent writer* is a product requirement.

What it would actually take, honestly:

| Mechanism | Reality |
|---|---|
| Directory-relative open (`openat`, `O_PATH` dirfd, `fstatat`) | **Not available in Node** (§9.2). Would require a native addon — a compiled, per-platform, per-ABI binary in an MIT mod. |
| OS sandbox around the reads (Linux `landlock` ≥ 5.13, seccomp; macOS App Sandbox / `sandbox_init`) | Requires the reads to run in a **separate process** — `cmd.process.spawn` — because a sandbox applies to a process, not a module. Brings process lifecycle, IPC, error-propagation and kill semantics into a single-file mod. |
| Container / VM | Flatly disproportionate. Also not permitted by the 3B1 contract, and a daemon requirement for a CLI mod. |
| Privilege drop / user separation | Needs privileges the mod must not request. |

Costs: a signed native binary or per-platform sandbox launcher, an ABI/CI matrix, a much larger supply-chain surface, degraded Windows support, and a security claim that still needs its own review. For a mod whose product value is *local, bounded, consented reading*, this is a large amount of machinery bought to defend a window most users will never be in.

**Recommended only if** the owner decides that running against untrusted repositories is a required use case — which is precisely the case Option A declines to promise.

### Option C — Idea-only

No repository access until stronger guarantees exist.

| Dimension | Assessment |
|---|---|
| Security | Best: zero filesystem risk, trivially provable. |
| Complexity | None — this is what ships if nothing else does. |
| Usability | Poor. The product's differentiated value is citing real project facts; without reads it is an interview with better record-keeping. |
| Feasibility | Already the default behaviour. |

**Correct as a fallback, wrong as a destination** — unless the owner concludes the residual race is unacceptable at any level of accidental risk.

---

## 11. Decision table

Scored 1 (poor) to 5 (good). "Risk" is inverted: 5 = lowest residual risk.

| Criterion | A — Cooperative | B — OS isolation | C — Idea-only |
|---|---|---|---|
| User value | **5** | 5 | 1 |
| Accidental-disclosure resistance | **5** | 5 | 5 |
| Adversarial-race resistance | 2 | **5** | 5 |
| Operational complexity (5 = simplest) | **5** | 1 | **5** |
| Portability | **5** | 2 | **5** |
| Dependency / supply-chain cost (5 = least) | **5** | 1 | **5** |
| Build & CI cost (5 = least) | **5** | 1 | **5** |
| Usability | **5** | 3 | 1 |
| Feasibility now | **5** | 1 | **5** |
| Honesty of the security claim | **5** | 4 | **5** |
| **Weighted outcome** | **Recommended** | Conditional on hostile-repo support | Mandatory fallback |

Option A wins on the axes that decide a v0.1 for a small open-source tool, and is the only option that is *honest* about the one axis it loses: it scores itself 2 on adversarial races rather than claiming 5.

---

## 12. Accepted-risk statement

Adopting Option A means accepting, in writing:

> Nail It Down reads only the workspace the user explicitly approves, under a fixed allowlist and hard ceilings, and never transmits repository content to a model. It does **not** claim to resist an attacker who concurrently modifies or replaces directories in that workspace while a read is in progress. Node provides no directory-relative open, so containment is verified before and after the read, not during it. Users who require protection against a hostile concurrent writer should not use this feature for that purpose. Secret detection is defense-in-depth and is not a guarantee that every credential is filtered.

This language, or something very close to it, must appear in the UI next to the consent dialog — not only in documentation.

---

## 13. Go / no-go criteria for a future opt-in pilot

A real-workspace pilot may be proposed only when **all** of the following hold. Any failure is a no-go, not a caveat.

1. This memo is accepted by the owner and an independent reviewer, with the residual risks below acknowledged in writing.
2. The consent surface shows root, allowlist, ceilings, exclusions and the no-transmission promise **before** the first metadata call (§5).
3. Refusal, dismissal, headless and malformed consent each perform **zero** filesystem operations, proven by instrumented tests.
4. All four ceilings are enforced *before* opening a file; physically read bytes never exceed the disclosed total.
5. A root whose identity changes between consent and read is refused, with zero bytes read from the new target.
6. Symlinked, missing, non-directory, remote-mount and non-regular candidates each refuse closed, each with a distinct reason.
7. The UI displays the accepted-risk language from §12 alongside the dialog.
8. No repository content reaches a model, a network call, telemetry, or persistent storage. Verifiable by inspection: no network APIs, no `cmd.store` writes on this path.
9. The pilot is **opt-in**, single workspace, user-initiated, non-persistent, and reversible by doing nothing.
10. The negative-test suite in §15 is green on the exact committed tree.

---

## 14. Unresolved questions

Deliberately limited to five.

1. **What is the trustworthy root source?** `cmd.cwd` is a proposal at best (§4). The safest option is a path the user types or picks in the dialog itself. This needs a decision, and it changes the UI.
2. **Resolve-before-consent or consent-before-resolve?** Showing the canonical path is more honest, but `realpath` is a filesystem operation. §5 chooses consent-first and stops if the resolution surprises us; is that the right trade?
3. **Can a network mount be detected portably?** Not with what we have. Node exposes `fs.statfs`, so a filesystem-type number is readable (§9.4), but it is a kernel magic on Linux and an unrelated undocumented code on macOS, and it says nothing about trust or concurrent mutation. v0.1 restricts to local filesystems and takes the user's declaration. The decision needed: restrict the pilot to one verified platform, or accept user declaration, or refuse any path the user cannot vouch for?
4. **Should session-scoped consent exist?** It reduces friction and creates a persistent authority the user must remember. §7 says no for v0.1.
5. **Who formally accepts the parent-swap risk?** This is an owner decision, not an implementer's. The recommendation is that it be recorded in the pilot's release note, not buried in code comments.

---

## 15. Required negative tests before a pilot (synthetic fixtures only)

Every test below runs against directories the harness created and owns. **No hostile race is ever attempted against a real project.**

| # | Test | Pass condition |
|---|---|---|
| 1 | Refused consent | Zero filesystem operations — not even `stat` of the root |
| 2 | Dismissed / headless / malformed consent | Same: zero operations |
| 3 | Canonical path disclosure | The path shown to the user matches the path read, after symlink resolution |
| 4 | Root replaced between consent and read | Refused; zero bytes from the replacement |
| 5 | Root is a symlink | Refused before listing |
| 6 | Candidate is a symlink / FIFO / socket / directory | Refused by descriptor type; `O_NOFOLLOW` proven to fire |
| 7 | Case-folding / Unicode-normalisation ambiguity | Behaviour documented; **NOT VERIFIED** marked where unmeasured |
| 8 | Empty listing vs failed listing | Distinct messages; an empty result is never reported as absence |
| 9 | Provenance staleness | A file changed between read and citation reports `stale`, never `verified` |
| 10 | Budget enforcement | Physically read bytes ≤ disclosed total; the over-budget file is never opened |
| 11 | Device node | Explicitly recorded as NOT VERIFIED or measured once a safe fixture exists |

---

## 16. What this memo does not authorize

- No real repository is read by this slice, including the Nail It Down checkout.
- No change to `src/index.ts`, the installed mod, M1 sessions or persistence, the OS reader, or the consent helper.
- No network, model call, subprocess, native addon, daemon or container.
- No M2 Slice 3B2, no M3, no release.

Acceptance of this memo authorizes **a threat model**, not a runtime pilot. A pilot requires its own explicit owner go-ahead, and Slice 3B1's own contract says the same.

---

## 17. Sources

| Source | Used for | Retrieved |
|---|---|---|
| `https://nodejs.org/docs/latest-v24.x/api/fs.html` (v24.22.2 docs) | `fs.constants` incl. `O_NOFOLLOW`; path types; `fs.opendir`/`fs.Dir`; absence of any dirfd option | 2026-10-28 |
| `https://github.com/nodejs/node/issues/31110` | Upstream dirfd request; closed stale 2022-04-04; libuv dependency and `*at` availability | 2026-10-28 |
| `https://nodejs.org/docs/latest-v24.x/api/fs.html` — `Class: fs.StatFs` | `fs.statfs`/`statfsSync` exist; fields `type`/`bsize`/`frsize`/`blocks`/`bfree`/`bavail`/`files`/`ffree`; `type` has no documented meaning | 2026-10-28 |
| Installed runtimes, `statfsSync` probe | Linux magics `0xEF53`/`0x01021994`/`0x9FA0`; macOS `type` 26 (apfs) / 19 (devfs) with no name exposed | 2026-10-28 |
| `https://commandcode.ai/docs/mods` | `ModApi` surface, `cmd.cwd`, "There is no sandbox", trust scoping, headless default-deny | 2026-10-28 |
| Installed runtimes | Node v24.22.1 / v24.12.0 probes; Command Code v1.88.0 | 2026-10-28 |
| `src/host/nodeRepositoryReader.ts` | `CONTAINMENT_LIMITS`, descriptor checks, parent-swap note | repository |
| `src/core/discovery.ts` | Allowlist, ceilings, 30 rejection reasons | repository |
| `docs/M2_SLICE2_ACCEPTANCE.md`, `docs/M2_SLICE3A_ACCEPTANCE.md` | Limits carried forward | repository |
