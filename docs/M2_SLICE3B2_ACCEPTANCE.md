# M2 Slice 3B2 — technical acceptance

**Decision (2026-10-28):** ACCEPTED **only** for a dormant workspace pilot using harness-owned disposable synthetic fixtures. This is not full M2 acceptance and does not authorize real-project inspection.

**Implementation:** [PR #27](https://github.com/beyondhumanwork/nail-it-down/pull/27), merged as `24867d245df620b08a73ad0b420e2f7619292b5e`; reviewed head `e28fa90d229120395f2ebcefdae106cdd1c5d1d8`. Authority: [3B2 contract](M2_SLICE3B2_CONTRACT.md), [owner's Option A decision](M2_OPTION_A_DECISION.md).

## Accepted implementation

- `src/host/workspacePilot.ts` and `test/pilotMod.ts` implement a separate `/naildown-pilot` experience, **not reachable from the installed `/naildown` command**. Test harness creates and owns the only permitted root, which is a disposable synthetic directory; the requested path cannot redirect reads elsewhere.
- Flow: native path proposal -> pure lexical exact-root check -> complete risk/scope disclosure -> refusal-first consent -> OS root validation -> mechanically cited bounded snapshot. No metadata lookup of the target before grant; no consent persistence.
- Missing or throwing `ui.notify` refuses before a consent dialog. The exact root and the accepted cooperative-workspace race limitation are also attached to the grant option. A visible disclosure is **not** proof of human comprehension.
- After consent, a root resolving to a different canonical location is refused **before** directory listing or candidate reads. Synthetic fixtures are created under canonical temp parents to avoid accidental macOS aliases.
- The UI says hostile concurrent ancestor-directory replacement is **not reliably prevented or detected**. The reader is not a sandbox. Some ordinary changes are detected, but no race-free containment claim is made.
- Existing allowlist, 6-file / 32 KiB each / 96 KiB total physical-read / 250-line each / 100-entry ceilings, provenance, at most two dependency citations, redaction, and honest missing-evidence outcomes remain in force. Evidence is a snapshot, not a live view.
- No `src/index.ts`, M1 session/persistence, discovery core or OS reader changes; `repositoryConsent.ts` gained a backward-compatible optional detail input; `modApi.ts` gained optional verified UI methods; `repositoryPreview.ts` exported the existing parser. No models, network calls, telemetry, persisted source/consent, new dependencies, releases or CI.

## Verification

Pi reported **478/478 tests passing** and `tsc --noEmit` passing on a MacBook archive of exact head `e28fa90`. Independent GitHub review examined the source and tests; the reviewer **did not rerun** the suite or typecheck. Pi also reported a Command Code 1.88.0 isolated `--mod` TUI re-check: refusal pre-highlighted, risk and exact root on grant surface, explicit grant yielded two cited synthetic dependencies, installed store unchanged, fixtures cleaned and no global mod installed. PR #27 triggered zero Actions runs.

## Retained limitations

1. The Node reader cannot reliably prevent or detect hostile parent-directory swaps between path checks and open. The owner's cooperative Option A risk decision is scoped to pilot development, **not** operational security certification.
2. `PilotAuthorization` is caller-supplied in the module interface; synthetic fixture provenance is provided by the dedicated test harness. An eventual runtime integration needs a separately reviewed trustworthy root source. An arbitrary caller cannot treat `issuedBy` text or `permittedParents` as a trust anchor.
3. Network/cloud mount trust cannot be inferred from `fs.statfs.type`; Linux/macOS parity, device nodes, case-folding and timestamp races remain incompletely tested.
4. Reader listing failure can appear as an empty result, so a bounded scan does not prove absence. Secret detection is defense in depth and cannot guarantee no credentials.
5. An isolated demo is not an unprompted human usability or real-workspace pilot.

**Not authorized:** first real-repository read (including the Nail It Down checkout), live `/naildown` integration, models, persistent evidence, CI, beta/release, M2 completion or M3+. An actual real-repository canary requires **separate owner approval naming the exact path and platform**, plus a reviewed storage and test plan.
