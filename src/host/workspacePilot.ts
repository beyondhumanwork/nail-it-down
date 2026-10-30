/**
 * M2 Slice 3B2: the dormant workspace pilot.
 *
 * This module is **not** wired into `src/index.ts` and must not be. It is an
 * independently loaded controller, exercised only by a disposable `--mod`
 * harness against a workspace that harness created.
 *
 * The authorization model, which is the whole reason this file exists separately
 * from `repositoryPreview.ts`:
 *
 * - A **proposal** comes from the person, through the host's native input
 *   dialog. It is only that: a proposal.
 * - An **authorization** comes from the harness that minted the fixture. It names
 *   exactly one root and nothing else.
 * - The two are compared **lexically** and must resolve to the same absolute
 *   path. A path the person types that is not that root is refused **without a
 *   single filesystem call against it** — no `stat`, no `lstat`, no `realpath`.
 *   `cmd.cwd`, a CLI argument, an environment variable, a stored preference and a
 *   caller-supplied `permittedParents` therefore all fail to authorize anything.
 * - Nothing at all touches the target root until after an explicit native
 *   consent answer. Disclosure is built from constants and the typed string, so
 *   it is honest before any metadata exists to be read.
 *
 * What this is not: a sandbox. Some filesystem changes are detected and refused,
 * but hostile concurrent replacement of a parent directory is **not reliably
 * prevented or detected**. This pilot is for cooperative, user-controlled local
 * workspaces only. Filesystem type is NOT VERIFIED, and `statfs.type` does not
 * establish that a mount is local.
 */

import { createHash } from 'node:crypto';
import * as nodePath from 'node:path';

import type { ModUi } from './modApi.ts';
import { requestRepositoryReadConsent } from './repositoryConsent.ts';
import type { ConsentRefusalReason } from './repositoryConsent.ts';
import { createNodeRepositoryReader } from './nodeRepositoryReader.ts';
import type { RootRejection } from './nodeRepositoryReader.ts';
import {
  CANDIDATE_POLICY,
  DEFAULT_BUDGET,
  declaredDependencyEvidence,
  selectCandidates,
} from '../core/discovery.ts';
import type { ConsentDecision, RejectionReason } from '../core/discovery.ts';
import {
  IDEA_ONLY_NOTE,
  MAX_DECLARATIONS,
  dependencyNamesFrom,
  snapshotReader,
} from './repositoryPreview.ts';
import type { PreviewDeclaration, PreviewFileSummary, PreviewSkipped } from './repositoryPreview.ts';

/**
 * The residual-risk statement, kept in one place so the disclosure, the caveats
 * and the consent dialog cannot drift apart.
 *
 * The earlier wording said a replaced directory was "detected, not prevented".
 * That overstated the guarantee: the reader checks the root before and after,
 * which catches many changes, but a hostile ancestor swap in the right window
 * may escape both. Say what is true.
 */
export const PILOT_RISK_STATEMENT =
  'Some filesystem changes are detected and refused, but hostile concurrent replacement of a parent '
  + 'directory is NOT reliably prevented or detected. This pilot is for cooperative, user-controlled '
  + 'local workspaces only. The reader is not a sandbox. Secret detection is defence in depth, '
  + 'not a guarantee.';

/** The one root this invocation may touch, and who says so. */
export type PilotAuthorization = {
  /** Absolute path of the fixture the harness created and owns. */
  root: string;
  /** Provenance for the record. Free text, and never sufficient on its own. */
  issuedBy: string;
};

/** What the person is asked for. The title is theirs to read, so it stays plain. */
export const PILOT_INPUT_TITLE = 'Workspace root to inspect?';
export const PILOT_INPUT_PLACEHOLDER = 'absolute path; nothing is read yet';

export type RootProposalRefusal =
  | 'headless'
  | 'dismissed'
  | 'empty'
  | 'not-absolute'
  | 'ui-failure';

export type PilotRefusalReason =
  | RootProposalRefusal
  | ConsentRefusalReason
  | 'authorization-invalid'
  | 'not-authorized-root'
  /** The disclosure could not be put on screen, so the grant could not be informed. */
  | 'no-disclosure-surface'
  | 'disclosure-failed';

/**
 * Root refusals the pilot adds to the reader's own set.
 *
 * `unexpected-canonical-root` is the one this module owns: the reader resolves
 * the root and reports where it really is, and a target that is not the exact
 * root the authorization named is refused before any candidate is listed.
 */
export type PilotRootRejection =
  | RootRejection
  | 'unexpected-canonical-root'
  /** The caller's pre-read gate refused, so no candidate was opened. */
  | 'pre-read-check-failed';

/**
 * Why a pre-read gate refused. A closed set, because a free-text reason from a
 * caller could carry a path or an OS message into the UI.
 */
export const PRE_READ_REFUSALS = [
  'root-path-mismatch',
  'root-not-directory',
  'root-symlinked',
  'root-owner-mismatch',
  'mount-unverifiable',
  'mount-not-acceptable',
  'root-is-a-mount-point',
] as const;

export type PreReadRefusal = (typeof PRE_READ_REFUSALS)[number];

/** The reason shown when a gate returns something that is not on the list. */
export const PRE_READ_FALLBACK: PreReadRefusal = 'mount-unverifiable';

/**
 * Narrows a runtime value to the closed set.
 *
 * The type says `PreReadRefusal`, but a type is not a runtime check: a mod, a
 * test using `as never`, or plain JavaScript can hand back anything at all. The
 * value is about to be written into a message a person reads, so membership is
 * verified rather than assumed - otherwise an arbitrary string, including a path
 * or a credential fragment, would be reproduced in the UI by the very code that
 * promises to sanitise its output.
 */
export function toPreReadRefusal(value: unknown): PreReadRefusal {
  return typeof value === 'string' && (PRE_READ_REFUSALS as readonly string[]).includes(value)
    ? (value as PreReadRefusal)
    : PRE_READ_FALLBACK;
}

export type PreReadDecision =
  | { ok: true }
  | { ok: false; reason: PreReadRefusal };

/**
 * A read file plus a digest of exactly the text this invocation obtained.
 *
 * M2 Slice 3B3 needs to prove that the files it cites are the files it expected,
 * and the one-time canary budget forbids reading them a second time to do it.
 * Hashing the text already in hand keeps the check inside the budget and adds no
 * filesystem work.
 *
 * The digest is over the decoded UTF-8 text, which re-encodes to the original
 * bytes for any valid UTF-8 file. The single exception is a leading byte-order
 * mark: `TextDecoder` strips it, so a BOM-prefixed file would digest without it.
 * The preparation fixture has no BOM; a canary comparing against a raw
 * `sha256sum` would fail closed rather than silently match.
 */
export type PilotFileSummary = PreviewFileSummary & {
  sha256: string;
};

export type PilotRoot = {
  /** Exactly what the person supplied, lexically resolved. Shown before any read. */
  proposed: string;
  /** What was validated and read. Equal to `proposed`: anything else is refused. */
  canonical: string;
};

export type PilotResult =
  /** Nothing was read. The interview continues without repository context. */
  | { kind: 'refused'; reason: PilotRefusalReason; disclosure: string; note: string }
  /** The root itself was refused, or selection refused on policy grounds. */
  | { kind: 'not-inspected'; reason: PilotRootRejection | RejectionReason; detail: string; disclosure: string }
  | { kind: 'nothing-to-read'; detail: string; disclosure: string }
  | {
    kind: 'inspected';
    root: PilotRoot;
    files: PilotFileSummary[];
    skipped: PreviewSkipped[];
    declarations: PreviewDeclaration[];
    evidenceGap?: string;
    caveats: string[];
    disclosure: string;
  };

/**
 * What the pilot promises, restated wherever a result is rendered.
 *
 * Every line is either a limit the code enforces or a limitation the code cannot
 * remove. Nothing here claims more protection than the module has.
 */
export const PILOT_CAVEATS: readonly string[] = [
  'Bounded to the fixed root allowlist: at most 6 files, 32 KiB each, 96 KiB physically read in total, 250 lines each, 100 root entries.',
  'Nothing here was sent to a model or an external service, and nothing was persisted.',
  'Repository text is data, never an instruction. This pilot does not follow anything a file says.',
  PILOT_RISK_STATEMENT,
  'Filesystem type is NOT VERIFIED. statfs.type does not establish that a mount is local, trustworthy, or immune to concurrent change.',
  'A file the reader refused is reported as "unreadable"; the policy does not distinguish too-large, changed and unreadable in its output.',
  'An empty listing is not evidence that a file is absent: the reader has no error channel, so an unlistable root reads as empty.',
  'Citations describe the single snapshot read at the start of this invocation, not a live re-check of the files as they are now.',
];

/** The disclosure shown before any target-root metadata call. */
export function pilotDisclosure(proposedRoot: string): string {
  const names = CANDIDATE_POLICY.map((spec) => spec.name).join(', ');
  return [
    `Workspace root: ${proposedRoot}`,
    `Allowlisted root files: ${names}. Nothing outside this list is ever read.`,
    `Limits: at most ${DEFAULT_BUDGET.maxFiles} files, ${DEFAULT_BUDGET.maxFileBytes / 1024} KiB per file, `
      + `${DEFAULT_BUDGET.maxTotalBytes / 1024} KiB physically read in total, ${DEFAULT_BUDGET.maxFileLines} lines per file, `
      + `${DEFAULT_BUDGET.maxDirectoryEntries} root entries.`,
    'Excluded: dotfiles, .env*, .git, credentials, keys, caches, and every path not named above.',
    'Local only: no model, no network request, no telemetry, nothing written to the workspace, nothing persisted.',
    `Known limitations: ${PILOT_RISK_STATEMENT}`,
    'Filesystem type is NOT VERIFIED; statfs does not prove a mount is local or trustworthy.',
  ].join('\n');
}

/** `undefined` unless the authorization is well-formed. Purely lexical. */
function authorizedRootOf(authorization: PilotAuthorization | undefined): string | undefined {
  // `typeof null` is 'object', so null has to be excluded explicitly: without
  // it a malformed authorization throws on destructuring instead of refusing.
  if (authorization === null || typeof authorization !== 'object') return undefined;
  const { root, issuedBy } = authorization;
  if (typeof root !== 'string' || root === '' || !nodePath.isAbsolute(root)) return undefined;
  if (typeof issuedBy !== 'string' || issuedBy.trim() === '') return undefined;
  return nodePath.resolve(root);
}

/**
 * Asks the person for a root. Pure with respect to the filesystem: an absolute
 * path is normalised with `path.resolve`, which never touches a disk.
 */
export async function proposeWorkspaceRoot(
  ui: ModUi | undefined,
  options: { suggestion?: string } = {},
): Promise<{ ok: true; root: string } | { ok: false; reason: RootProposalRefusal }> {
  if (ui === undefined || typeof ui.input !== 'function') return { ok: false, reason: 'headless' };
  // Checked before asking: a headless host resolves `undefined`, which is
  // indistinguishable from a dismissal, and "no surface existed" is more accurate.
  if (ui.capabilities?.surface === false) return { ok: false, reason: 'headless' };

  let typed: string | undefined;
  try {
    // The suggestion is *shown*, never accepted. The person still has to type a
    // path, and whatever they type is compared against the authorization below.
    typed = await ui.input({
      title: PILOT_INPUT_TITLE,
      placeholder: options.suggestion ?? PILOT_INPUT_PLACEHOLDER,
    });
  } catch {
    return { ok: false, reason: 'ui-failure' };
  }

  if (typed === undefined) return { ok: false, reason: 'dismissed' };
  if (typeof typed !== 'string') return { ok: false, reason: 'ui-failure' };
  const trimmed = typed.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };
  if (!nodePath.isAbsolute(trimmed)) return { ok: false, reason: 'not-absolute' };
  return { ok: true, root: nodePath.resolve(trimmed) };
}

function refusal(reason: PilotRefusalReason, shownRoot: string): PilotResult {
  return { kind: 'refused', reason, disclosure: pilotDisclosure(shownRoot), note: IDEA_ONLY_NOTE };
}

/**
 * Runs one pilot invocation.
 *
 * Order matters and is the security property: propose, authorize lexically,
 * disclose, consent, and only then touch the filesystem.
 */
export async function runWorkspacePilot(input: {
  ui: ModUi | undefined;
  authorization: PilotAuthorization;
  /**
   * Optional gate that runs after the native grant and after the root has been
   * validated and resolved, but **before any candidate file is opened**.
   *
   * It exists so a caller can require conditions the reader does not itself
   * check - ownership, mount provenance - without those conditions becoming a
   * claim about content that was already read. It can only refuse: there is no
   * return value that widens what may be read, and it is given the already
   * validated root rather than a root of its choosing.
   *
   * Absent, the pilot behaves exactly as before. Throwing, or returning
   * anything other than `{ok: true}`, refuses.
   */
  beforeRead?: (root: PilotRoot) => PreReadDecision;
}): Promise<PilotResult> {
  const authorizedRoot = authorizedRootOf(input.authorization);

  // 1. Proposal. Dialogs only.
  const proposal = await proposeWorkspaceRoot(input.ui, { suggestion: authorizedRoot });
  if (!proposal.ok) return refusal(proposal.reason, authorizedRoot ?? '<no workspace proposed>');

  // 2. Exactly the authorized root, or nothing. Lexical, so a typed path is
  //    never inspected — not even its metadata — before it is known to be ours.
  if (authorizedRoot === undefined) return refusal('authorization-invalid', proposal.root);
  if (proposal.root !== authorizedRoot) return refusal('not-authorized-root', proposal.root);

  // 3. Disclosure, then the native refusal-first choice.
  //
  //    The disclosure is not decoration: a grant made without it is not an
  //    informed grant. So a host that cannot show it is refused outright rather
  //    than asked a question whose terms were never displayed. This is the
  //    fail-closed direction - the absence of a surface is never permission.
  const disclosure = pilotDisclosure(proposal.root);
  const notify = input.ui?.notify;
  if (typeof notify !== 'function') return refusal('no-disclosure-surface', proposal.root);
  try {
    notify.call(input.ui, disclosure, 'warning');
  } catch {
    // A surface that throws has not shown anything either.
    return refusal('disclosure-failed', proposal.root);
  }

  //    The root and the risk also go on the decision surface itself, because a
  //    notice above the dialog can scroll out of view before the choice is made.
  const consent = await requestRepositoryReadConsent(input.ui, {
    root: proposal.root,
    risk: PILOT_RISK_STATEMENT,
  });
  if (consent.kind !== 'granted') return refusal(consent.reason, proposal.root);

  // 4. Only now may the target root be resolved and checked.
  if (authorizedRoot === undefined) return refusal('authorization-invalid', proposal.root);
  const opened = createNodeRepositoryReader({
    root: authorizedRoot,
    // Derived from the authorized root, never supplied independently: a caller
    // cannot widen the provenance by passing its own parent.
    permittedParents: [nodePath.dirname(authorizedRoot)],
  });
  if (!opened.ok) {
    return { kind: 'not-inspected', reason: opened.reason, detail: opened.detail, disclosure };
  }

  // The authorization approved one exact directory. If the filesystem resolves
  // the root somewhere else - a symlinked ancestor, a swap between consent and
  // resolution - that is a different directory from the one that was approved,
  // and reading it would be reading something nobody agreed to. Refuse here,
  // before the root is listed and before a single candidate is opened.
  if (opened.canonicalRoot !== authorizedRoot) {
    return {
      kind: 'not-inspected',
      reason: 'unexpected-canonical-root',
      detail: 'the workspace resolved to a different directory than the one that was approved, so nothing was read',
      disclosure,
    };
  }

  const root: PilotRoot = { proposed: proposal.root, canonical: opened.canonicalRoot };

  // Fail-closed pre-read gate. Everything above this point is dialogs and root
  // metadata; nothing has opened a candidate file, and nothing will if the gate
  // refuses or misbehaves.
  if (input.beforeRead !== undefined) {
    let decision: PreReadDecision;
    try {
      decision = input.beforeRead(root);
    } catch {
      // A gate that cannot answer has not approved anything.
      decision = { ok: false, reason: PRE_READ_FALLBACK };
    }
    if (decision?.ok !== true) {
      // Validated, not interpolated: an off-list value would otherwise be
      // reproduced verbatim in front of the person being refused.
      const reason = toPreReadRefusal(decision?.reason);
      return {
        kind: 'not-inspected',
        reason: 'pre-read-check-failed',
        detail: `required preconditions were not met (${reason}), so no file was read`,
        disclosure,
      };
    }
  }

  // 5. Reuse the Slice 3A snapshot: one listing and one read per path, with the
  //    aggregate ceiling enforced before a file is opened.
  const ceilingRefused = new Set<string>();
  const reader = snapshotReader(opened.reader, DEFAULT_BUDGET, (path) => ceilingRefused.add(path));
  const decision: ConsentDecision = { granted: true, obtainedBy: 'workspace pilot consent dialog' };
  const selection = selectCandidates({ reader, consent: decision });

  if (selection.kind === 'refused') {
    return { kind: 'not-inspected', reason: selection.refusal.reason, detail: selection.refusal.detail, disclosure };
  }
  if (selection.kind === 'empty') {
    // Never "the project has no such file": an unlistable root also reads empty.
    return { kind: 'nothing-to-read', detail: selection.detail, disclosure };
  }

  const files: PilotFileSummary[] = selection.files.map((file) => ({
    path: file.path,
    kind: file.kind,
    lines: file.lines,
    bytes: file.bytes,
    // Computed from the text already read: no second open, no extra bytes.
    sha256: createHash('sha256').update(file.text, 'utf8').digest('hex'),
  }));
  const skipped: PreviewSkipped[] = selection.rejected.map((entry) => ({
    path: entry.path,
    // The guard refused this one before opening it, so the honest reason is the
    // ceiling rather than the core's generic fallback.
    reason: ceilingRefused.has(entry.path) ? 'total-too-large' : entry.reason,
  }));

  const manifest = selection.files.find((file) => file.path === 'package.json');
  const names = manifest === undefined ? [] : dependencyNamesFrom(manifest.text);
  const declarations: PreviewDeclaration[] = [];
  let evidenceGap: string | undefined;

  if (manifest === undefined) {
    const why = selection.rejected.find((entry) => entry.path === 'package.json');
    evidenceGap = why === undefined
      ? 'No package.json was among the files read, so there is nothing to cite. That is not evidence that the project has no dependencies.'
      : `package.json was not read (${why.reason}), so there is nothing to cite.`;
  } else if (names.length === 0) {
    evidenceGap = 'package.json declares no dependency this policy can cite. That is not evidence that the project has none.';
  }

  for (const name of names) {
    if (declarations.length >= MAX_DECLARATIONS) break;
    const result = declaredDependencyEvidence({ reader, consent: decision, dependency: name });
    if (result.kind === 'evidence') {
      declarations.push({
        claim: result.evidence.claim,
        path: result.evidence.source.path,
        lineStart: result.evidence.source.lineStart,
        lineEnd: result.evidence.source.lineEnd,
        excerpt: result.evidence.excerpt,
        provenance: result.evidence.provenance,
      });
    }
  }

  if (evidenceGap === undefined && declarations.length === 0) {
    evidenceGap = 'No declaration could be located and cited, so no fact is claimed.';
  }

  return {
    kind: 'inspected',
    root,
    files,
    skipped,
    declarations,
    evidenceGap,
    caveats: [...PILOT_CAVEATS],
    disclosure,
  };
}

/** Renders one result as feed text. Never includes a path the pilot did not read. */
export function renderWorkspacePilot(result: PilotResult): string {
  if (result.kind === 'refused') {
    return [
      'Workspace pilot — nothing was read',
      '',
      `Reason: ${result.reason}`,
      result.note,
      '',
      result.disclosure,
    ].join('\n');
  }

  if (result.kind === 'not-inspected') {
    return [
      'Workspace pilot — nothing was read',
      '',
      `The workspace was refused before any file was read (${result.reason}).`,
      result.detail,
      '',
      result.disclosure,
    ].join('\n');
  }

  if (result.kind === 'nothing-to-read') {
    return [
      'Workspace pilot — nothing to read',
      '',
      result.detail,
      'This is not evidence that the project lacks these files.',
      '',
      result.disclosure,
    ].join('\n');
  }

  const lines = [
    'Workspace pilot',
    '',
    `Root: ${result.root.proposed}`,
    '',
  ];
  lines.push(`Read ${result.files.length} files:`);
  for (const file of result.files) {
    lines.push(`  ${file.path}  (${file.kind}, ${file.lines} lines)`);
  }

  if (result.skipped.length > 0) {
    lines.push('Skipped:');
    for (const entry of result.skipped) lines.push(`  ${entry.path}  (${entry.reason})`);
  }

  if (result.declarations.length > 0) {
    lines.push('Cited from the workspace, not inferred:');
    for (const declaration of result.declarations) {
      lines.push(`  ${declaration.claim}`);
      lines.push(`    ${declaration.path} lines ${declaration.lineStart}-${declaration.lineEnd}: ${declaration.excerpt}`);
    }
  }
  if (result.evidenceGap !== undefined) {
    lines.push('');
    lines.push(result.evidenceGap);
  }

  lines.push('');
  lines.push('Worth knowing:');
  for (const caveat of result.caveats) lines.push(`  - ${caveat}`);
  return lines.join('\n');
}
