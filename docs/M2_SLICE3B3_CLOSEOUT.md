# M2 Slice 3B3 — Technical closeout and operational qualifications

**Owner decision (2026-10-28):** **TECHNICAL PASS — OPERATIONAL VERIFICATION INCOMPLETE**. This is a narrow canary outcome, **not** full M2 acceptance.

See [operator observation](M2_SLICE3B3_OPERATOR_OBSERVATION.md), [one-time authorization](M2_SLICE3B3_ONE_TIME_CANARY.md), and the privately stored metadata-only closeout. The one-time read authorization was **consumed**. There is **no permission to repeat the canary, inspect another real repository, or connect the reader to installed `/naildown`**.

## Observed, verified and unknown

| Evidence level | Finding |
| --- | --- |
| Operator-observed in Command Code TUI | Single bounded read reported **CONTENT WAS READ — INTEGRITY VERIFIED**, 3 allowlisted files, 2 cited dependency declarations with source line spans, 8/8 hard integrity checks reported OK |
| Agent-reported metadata-only check after canary | At the time of inspection, no `cmd` process was running; no new project session transcript was found in the observed time window; production mod and settings unchanged |
| Agent-reported metadata-only check after canary | Live M1 store SHA-256 and mtime matched pre-canary baseline; isolated run/temp directories safely removed; unmerged local digest and pre-read-gate commits and review patch retained |
| **Unexpected confirmed persistence** | Global Command Code `history.jsonl` was written in the canary time window; filename-only inspection identified the canary command. `--no-session` prevented a new session transcript, **not** all host persistence |
| Not verified | Whether the typed root path was recorded in global input history (contents deliberately not inspected); exact exit timing; proof of only one invocation; measured physical bytes; independent replay of cited lines; detailed pre-read gate verdict |
| Retained technical limits | Hostile parent-directory replacement race, same-filesystem bind mount ambiguity, digest over decoded UTF-8/BOM, best-effort secret filtering, directory listing failure conflated with empty, non-durable one-shot latch, model feed replay not proven impossible |

The observed canary used a **purpose-built harmless Git fixture** on one cooperative Linux host. It is not evidence that reading arbitrary repositories is safe. Do not recast the user's pasted demonstration excerpts as proof of zero transmission to ChatGPT: the mod did not itself submit a model turn, but the user later voluntarily pasted synthetic output into the conversation.

## Operational disposition

The central runtime inspection test passed; metadata checks support that M1 was not modified. However, global command history **did persist** a command entry. Therefore **do not claim** that `--no-session` means zero host persistence. The runtime history path and any mitigation must be researched and tested against **synthetic input only**, without reading the owner's real history file contents or repeating this canary.

The private local SHA-256 and `beforeRead` changes are accepted as reviewed **candidates**, not public-main changes. A separately reviewable PR is required before any merge. The private one-time harness remains uninstalled and is not itself a general product design.

## M2 remains incomplete

Remaining gates include (1) a trustworthy user-driven, refusal-first runtime root proposal and consent design, (2) integration with the normal interview only after separate approval, (3) an explicit listing-error result rather than silently treating failure as empty, (4) a verified **physical-read** aggregate budget including failed reads, (5) a synthetic-only privacy/history investigation, and (6) later integration and installed-host acceptance evidence. The next authorized development scope is [M2 Slice 4](M2_SLICE4_CONTRACT.md); nothing in this closeout permits live integration, a new real repository read, model calls, persistence of repository evidence, deployment, CI or M3.
