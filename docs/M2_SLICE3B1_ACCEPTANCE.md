# M2 Slice 3B1 — technical acceptance

**Decision:** TECHNICALLY ACCEPTED on 2026-10-28 for the **proposed real-workspace threat-model memo and two bounded pure-core secret-scanner performance fixes only**.

**Implementation:** [PR #23](https://github.com/beyondhumanwork/nail-it-down/pull/23), merged as `567b822ab2aae46520c26bc68279acc4f1330bba`. Reviewed head `9fb79bd1a8df7d8ebcda6b3bdf11df7147c03931`. Contract: [M2 Slice 3B1](M2_SLICE3B1_CONTRACT.md). Proposal: [Real-workspace security decision](M2_REAL_WORKSPACE_SECURITY_DECISION.md).

## Accepted engineering work

- `src/core/discovery.ts` no longer uses the two pathologically superlinear unanchored regex patterns for base64-like and JWT-like credentials. Both are replaced by bounded forward-scan implementations retaining the prior public detection/redaction behavior in tested synthetic inputs. Existing secret detection is **defense in depth**, not proof that arbitrary secrets are safe.
- Pi reported base64-like detection on 32 KiB homogeneous text improving ~1,327 ms to ~0.33 ms and JWT-like detection on 32 KiB `eyJ` repeats improving ~849 ms to ~0.93 ms (Node 24.12.0). These are host-specific measurements, not universal latency guarantees.
- Regression tests include prior-regex oracles for detection and redaction, boundary cases, deterministic generated strings, 4,096 six-part JWT compositions, separate mutation evidence and near-ceiling homogeneous-text cases.
- Pi reported **452/452 tests passing** and `tsc --noEmit` PASS on the MacBook against the archived exact commit. Independent review inspected the code and tests; **the reviewer did not rerun** the test suite or typecheck.
- The memo correctly describes Node's `fs.statfs` / `fs.statfsSync` interfaces as available, while marking cross-platform remote-mount identification and threat protection **NOT VERIFIED**. Official Node docs give a platform-dependent filesystem-type number, **not** a guarantee that a selected directory is local or immune to replacement.
- M0/M1 and the M2 reader, consent and synthetic preview code remain unchanged. PR #23 triggered no GitHub Actions runs.

## Unaccepted design decisions and risks

`docs/M2_REAL_WORKSPACE_SECURITY_DECISION.md` remains **PROPOSED**. Option A (cooperative, user-controlled local workspace with explicit per-invocation consent) is a recommended candidate, **not an accepted operational trust model**. No owner acceptance of the residual parent-swap TOCTOU window has been received.

The unresolved items remain:
1. Trustworthy root selection: `cmd.cwd` is a proposal, not authorization.
2. Consent before filesystem metadata, with safe treatment of canonical-path changes.
3. No portable, complete network-mount trust check demonstrated; `statfs.type` is not sufficient.
4. Per-invocation rather than stored/session-wide consent.
5. Formal owner decision about adversarial parent-directory replacement risk.

The current Node reader is **not a sandbox**; its root/path checks do not prevent every hostile concurrent directory swap. Preserve idea-only mode as the default/fallback. No model transmission is authorized by local-read consent.

## Next gate (NOT authorized by this acceptance)

A subsequent 3B2 opt-in real-workspace pilot would require a separately approved, **named cooperative local workspace**, a user-visible exact-root/allowlist/budget/risk disclosure before any filesystem metadata access, refusal-first consent, adversarial synthetic security tests, and independent review. If required safeguards cannot be demonstrated, stop at synthetic-only preview and idea-only mode.

**This acceptance does NOT authorize reading real user repositories, changing live `src/index.ts`, modifying M1 session or approval logic, using models, persisting repository evidence/consent, M2 completion, CI, deployment, release, or M3+.**
