# M2 Slice 2 technical acceptance — synthetic-workspace OS reader

**Decision:** ACCEPTED for **synthetic-workspace adapter feasibility only**, 2026-10-28.  
**Implementation:** [PR #17](https://github.com/beyondhumanwork/nail-it-down/pull/17), merge commit `8e50d56c44ebffcd74584de82696f335c9fbe45e`, reviewed corrected head `1785ab4e7aed837c4f9998c7c3d9cc8298a7ee57`.  
**Authority:** This closes only the [M2 Slice 2 contract](M2_SLICE2_CONTRACT.md). It **does not** approve real-repository inspection, enabling the adapter from `/naildown`, M2 Slice 3, M3, beta or release.

## What was independently reviewed

- The dormant `src/host/nodeRepositoryReader.ts` is separate from `src/index.ts` and only exercised with owned disposable synthetic workspaces; `src/core/discovery.ts` and M0/M1 modules remained unchanged.
- The reader validates permitted fixture roots, selects fixed root-level allowlisted files, bounds enumeration and byte reads, opens using `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, checks descriptor `fstat`, refuses nonregular/symlink paths, and uses dev/inode/size/mtime/ctime consistency checks.
- The corrected reader applies path policy before file-specific metadata inspection; invalidates cached listing authorization on relisting, failure and overflow; and detects the synthetic same-inode, same-length rewrite tested.
- Separate `src/host/repositoryConsent.ts` offers refusal first through native Command Code `ui.select`, and returns grant only on the exact positive selection. The helper itself does not read or persist anything.
- Independent GitHub review examined the actual corrected source and targeted regression tests. **MacBook test execution was reported by Pi, not rerun by the reviewer**: 399/399 full-suite tests passed, `tsc --noEmit` exit 0 against `git archive 1785ab4`. The preexisting 394-test baseline reportedly remained green.
- A real Command Code 1.88.0 consent-only TUI probe was reported from an isolated temporary mod/workspace: Enter refused, Escape refused, exact affirmative granted. The consent module was not changed in the correction round; this observation was not rerun then. No live repository reads or model calls.
- No workflow files or GitHub Actions runs were introduced for the merged code.

## Explicitly unproven / non-blocking for this narrow acceptance

1. **Parent-component swap TOCTOU:** `realpath`/root-identity check followed by path-based `open` is not atomic. Node's used APIs do not establish directory-handle-relative `openat` containment. A parent directory swapped at the right moment can escape the checked root. **This is a blocker for claiming arbitrary real-workspace containment, not a solved problem.**
2. **Caller-controlled provenance:** `permittedParents` is a parameter from the caller, not a trusted authority by itself. The constraint is meaningful only when a separately vetted test harness supplies owned fixture parents.
3. **Device nodes:** no actual device-node fixture was created; descriptor type checks were observed for FIFO/socket and code reviewed for other nonregular files, but device-node behavior is NOT VERIFIED.
4. **Cross-platform behavior:** only one operating environment measured; Linux/macOS, case-folded/Unicode-normalized filesystem, and diverse mount behavior are not certified.
5. **Concurrent updates:** bigint mtime/ctime comparison detects the tested rewrite but has a filesystem-resolution floor, cannot lock content, and cannot guarantee detection of every change.
6. **Listing errors:** the existing `RepositoryReader.list` interface has no error channel; an inaccessible root can appear empty. Do not equate an empty result with proof of absence.
7. **Synthetic-only consent:** native dialog success does not imply a production-safe trust or permission model, and consent is not persisted.

## Next engineering gate (not authorized by this record)

Before any real-workspace access, independently design a trustworthy runtime root source and consent scope and resolve/mitigate the parent-directory race, or formally restrict the supported threat model with an honest security rationale and executable negative tests. Separately verify error reporting, relevant host versions, race/metadata behavior, and stale evidence. Review the existing M2 [roadmap](ROADMAP.md) and [Slice 2 contract](M2_SLICE2_CONTRACT.md) before proposing Slice 3.

**No change to M0/M1 approvals, persistence, UI, installed mods, CI, or release status.** The full product specification remains a draft and M2 overall is incomplete.
