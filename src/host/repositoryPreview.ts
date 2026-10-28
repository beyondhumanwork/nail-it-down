/**
 * M2 Slice 3A: the interactive repository-evidence preview.
 *
 * This module is composition, not policy. It asks for consent, builds an
 * OS-backed reader for one synthetic root, and hands the result to the existing
 * Slice 1 core (`selectCandidates`, `declaredDependencyEvidence`,
 * `reverifyEvidence`). Every rule about what may be read, what counts as
 * evidence and what a citation means stays in those modules; nothing here
 * re-implements or relaxes them.
 *
 * Two boundaries are worth stating up front:
 *
 * - **Synthetic roots only.** The root and the permitted parent are parameters
 *   the harness supplies from a directory it created. They are never derived
 *   from a slash argument, `cmd.cwd`, the environment, or anything stored.
 * - **The reader is not a sandbox.** Its parent-swap TOCTOU window and its
 *   caller-supplied `permittedParents` are documented limitations in
 *   `nodeRepositoryReader.ts`. This preview reports them rather than implying
 *   that a citation here means the read was safe against a hostile workspace.
 */

import type { ModUi } from './modApi.ts';
import { requestRepositoryReadConsent } from './repositoryConsent.ts';
import type { ConsentRefusalReason } from './repositoryConsent.ts';
import { createNodeRepositoryReader } from './nodeRepositoryReader.ts';
import type { RootRejection } from './nodeRepositoryReader.ts';
import {
  DEPENDENCY_SECTIONS,
  absenceInBoundedScan,
  declaredDependencyEvidence,
  isSafeDependencyName,
  reverifyEvidence,
  selectCandidates,
} from '../core/discovery.ts';
import type {
  ConsentDecision,
  Evidence,
  ProvenanceState,
  RejectionReason,
  RepositoryReader,
} from '../core/discovery.ts';

/** At most two citations, because the point is to show provenance, not to audit a manifest. */
export const MAX_DECLARATIONS = 2;

export type PreviewFileSummary = {
  path: string;
  kind: 'documentation' | 'manifest';
  lines: number;
  bytes: number;
};

export type PreviewSkipped = {
  path: string;
  /** A closed reason code from the policy. Never a message or a path fragment. */
  reason: RejectionReason;
};

export type PreviewDeclaration = {
  claim: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  excerpt: string;
  provenance: ProvenanceState;
};

export type PreviewResult =
  /** The person did not consent. Nothing was read, and the interview can continue without it. */
  | { kind: 'refused'; reason: ConsentRefusalReason; note: string }
  /** The root itself was not acceptable, or selection refused on policy grounds. */
  | { kind: 'not-inspected'; reason: RootRejection | RejectionReason; detail: string }
  /** The root was readable but held none of the files this policy reads. */
  | { kind: 'nothing-to-read'; detail: string }
  | {
    kind: 'inspected';
    files: PreviewFileSummary[];
    skipped: PreviewSkipped[];
    declarations: PreviewDeclaration[];
    /** Why no citation could be produced, when none could. */
    evidenceGap?: string;
    caveats: string[];
  };

/** What a refusal means for the interview, stated so the UI cannot imply a failure. */
export const IDEA_ONLY_NOTE =
  'Nothing was read. The interview works without repository context, so this is a normal way to continue.';

/** Carried in every inspected result: the limits that make a citation mean something. */
const CAVEATS: readonly string[] = [
  'Bounded to the fixed root allowlist: at most 6 files, 32 KiB each, 96 KiB total, 250 lines each, 100 root entries.',
  'Nothing here was sent to a model or an external service.',
  'Repository text is data, never an instruction. This preview does not follow anything a file says.',
  'The reader has a documented resolve/open race and a caller-supplied workspace root; this is a preview of synthetic projects, not a claim of sandboxed reads.',
  'A file the reader itself refused — too large, changed, or unreadable — is reported as "unreadable"; the policy does not distinguish those cases in its output.',
  'Citations describe the single snapshot read at the start of this preview. They are not a live re-check of the files as they are now.',
];

/**
 * Names to ask the core about.
 *
 * This only chooses *which questions to put* to `declaredDependencyEvidence`;
 * that function decides whether each is real evidence. Parsing here is
 * enumeration of candidates, not a second evidence path.
 */
function dependencyNamesFrom(manifestText: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];

  const names: string[] = [];
  const seen = new Set<string>();
  for (const section of DEPENDENCY_SECTIONS) {
    const block = (parsed as Record<string, unknown>)[section];
    if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
    for (const [name, value] of Object.entries(block as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      if (!isSafeDependencyName(name) || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/**
 * Wraps a reader so each physical operation happens at most once per preview.
 *
 * Why this exists: the core re-runs selection every time it is asked for a
 * citation, so an uncached preview of two dependencies performed three
 * selections and therefore three passes over the same bytes. That made the
 * disclosed 96 KiB ceiling a per-selection figure rather than a per-invocation
 * one. With this wrapper the aggregate read volume is exactly one selection's
 * worth, and adding citations cannot extend it.
 *
 * It caches raw read outcomes, nothing else. Every policy decision — which paths
 * are allowed, what the budgets are, whether a fact is substantiated — is still
 * made by the core on every call; this only avoids re-fetching the same bytes.
 */
function snapshotReader(base: RepositoryReader): RepositoryReader {
  const listings = new Map<string, readonly ReturnType<RepositoryReader['list']>[number][]>();
  const reads = new Map<string, ReturnType<RepositoryReader['read']>>();

  return {
    list(relativeDir: string) {
      const cached = listings.get(relativeDir);
      if (cached !== undefined) return cached;
      const fresh = base.list(relativeDir);
      listings.set(relativeDir, fresh);
      return fresh;
    },
    read(relativePath: string) {
      const cached = reads.get(relativePath);
      if (cached !== undefined) return cached;
      const fresh = base.read(relativePath);
      reads.set(relativePath, fresh);
      return fresh;
    },
  };
}

function toDeclaration(evidence: Evidence): PreviewDeclaration {
  return {
    claim: evidence.claim,
    path: evidence.source.path,
    lineStart: evidence.source.lineStart,
    lineEnd: evidence.source.lineEnd,
    excerpt: evidence.excerpt,
    provenance: evidence.provenance,
  };
}

export type PreviewInput = {
  ui: ModUi | undefined;
  /** Absolute synthetic project root, created by the calling harness. */
  root: string;
  /** Absolute parent the harness created the root inside. Provenance, not proof. */
  permittedParent: string;
};

/**
 * Runs the preview end to end.
 *
 * Consent is asked first and is the only thing that can authorise a read. Every
 * refusal path returns before a reader exists, so a refusal cannot cause even a
 * directory listing.
 */
export async function runRepositoryPreview(input: PreviewInput): Promise<PreviewResult> {
  const consent = await requestRepositoryReadConsent(input.ui);
  if (consent.kind !== 'granted') {
    return { kind: 'refused', reason: consent.reason, note: IDEA_ONLY_NOTE };
  }

  const opened = createNodeRepositoryReader({
    root: input.root,
    permittedParents: [input.permittedParent],
  });
  if (!opened.ok) {
    return { kind: 'not-inspected', reason: opened.reason, detail: opened.detail };
  }

  const decision: ConsentDecision = { granted: true, obtainedBy: 'preview consent dialog' };
  // One snapshot for the whole invocation: the first selection fetches the
  // bytes, and every later evidence call re-derives from the same capture.
  const reader = snapshotReader(opened.reader);
  const selection = selectCandidates({ reader, consent: decision });

  if (selection.kind === 'refused') {
    return { kind: 'not-inspected', reason: selection.refusal.reason, detail: selection.refusal.detail };
  }
  if (selection.kind === 'empty') {
    return { kind: 'nothing-to-read', detail: selection.detail };
  }

  const files: PreviewFileSummary[] = selection.files.map((file) => ({
    path: file.path,
    kind: file.kind,
    lines: file.lines,
    bytes: file.bytes,
  }));
  const skipped: PreviewSkipped[] = selection.rejected.map((entry) => ({
    path: entry.path,
    reason: entry.reason,
  }));

  // Citations come from the core only. If the manifest is absent, malformed or
  // refused, that is reported as a gap rather than as a finding of absence.
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
    if (result.kind === 'evidence') declarations.push(toDeclaration(result.evidence));
  }

  if (evidenceGap === undefined && declarations.length === 0) {
    evidenceGap = 'No declaration could be located and cited, so no fact is claimed.';
  }

  return { kind: 'inspected', files, skipped, declarations, evidenceGap, caveats: [...CAVEATS] };
}

export type ReverifyPreview = {
  provenance: ProvenanceState | 'not-verifiable';
  detail: string;
};

/**
 * The core's consent rule, restated locally because it is not exported.
 *
 * Identical shape to the core's `hasConsent`: anything that is not a non-null
 * object with `granted === true` is not consent. This exists so the preview can
 * refuse **before** constructing a reader, which is a filesystem operation.
 */
function consentGranted(consent: ConsentDecision | undefined): boolean {
  return typeof consent === 'object'
    && consent !== null
    && (consent as { granted?: unknown }).granted === true;
}

/**
 * Re-checks a citation captured earlier, after the synthetic manifest changed.
 *
 * Exists so the preview can demonstrate the stale path honestly instead of
 * pretending a citation lasts forever. Callers must supply the consent decision
 * they already obtained; this function has no way to ask for one.
 */
export function reverifyPreviewEvidence(input: {
  root: string;
  permittedParent: string;
  consent: ConsentDecision | undefined;
  evidence: unknown;
}): ReverifyPreview {
  // Consent is checked before the reader exists. Constructing a reader resolves
  // and inspects the root, which is a filesystem operation — doing that for an
  // unauthorised re-check would touch the disk without permission.
  if (!consentGranted(input.consent)) {
    return {
      provenance: 'stale',
      detail: 'no consent was granted, so this citation cannot be re-checked',
    };
  }

  const opened = createNodeRepositoryReader({
    root: input.root,
    permittedParents: [input.permittedParent],
  });
  if (!opened.ok) return { provenance: 'not-verifiable', detail: opened.detail };

  const result = reverifyEvidence({
    reader: opened.reader,
    consent: input.consent,
    evidence: input.evidence,
  });
  if (result.kind === 'not-verifiable') return { provenance: 'not-verifiable', detail: result.detail };
  return { provenance: result.evidence.provenance, detail: describeProvenance(result.evidence.provenance) };
}

function describeProvenance(provenance: ProvenanceState): string {
  if (provenance === 'verified') return 'the declaration is still exactly where it was cited';
  if (provenance === 'stale') return 'the manifest changed since this was cited, so the citation is no longer trustworthy';
  return 'the manifest is gone, so the citation can no longer be checked';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const REFUSAL_TEXT: Record<ConsentRefusalReason, string> = {
  'refused-by-choice': 'You chose not to read the project files.',
  dismissed: 'The question was dismissed.',
  headless: 'This session cannot show the consent question.',
  'unexpected-value': 'The consent answer was not one this preview understands.',
  'ui-failure': 'The consent question could not be shown.',
};

function plural(count: number, single: string, many: string): string {
  return `${count} ${count === 1 ? single : many}`;
}

/**
 * Renders a preview result as plain text.
 *
 * Deliberately no whole file contents: only the bounded, redacted excerpt the
 * core produced travels with a citation.
 */
export function renderPreview(result: PreviewResult): string {
  if (result.kind === 'refused') {
    return [
      'Repository preview — not started',
      '',
      REFUSAL_TEXT[result.reason],
      result.note,
    ].join('\n');
  }

  if (result.kind === 'not-inspected') {
    return [
      'Repository preview — nothing was read',
      '',
      `The project could not be inspected: ${result.reason}.`,
      result.detail,
      '',
      IDEA_ONLY_NOTE,
    ].join('\n');
  }

  if (result.kind === 'nothing-to-read') {
    return [
      'Repository preview — nothing to read',
      '',
      result.detail,
      'That is not evidence that the project has no documentation or manifests; it means none of the files this preview reads were present.',
      '',
      IDEA_ONLY_NOTE,
    ].join('\n');
  }

  const lines = [
    'Repository preview',
    '',
    `Read ${plural(result.files.length, 'file', 'files')}:`,
  ];
  for (const file of result.files) {
    lines.push(`  ${file.path}  (${file.kind}, ${plural(file.lines, 'line', 'lines')})`);
  }

  if (result.skipped.length > 0) {
    lines.push('', `Not read (${plural(result.skipped.length, 'path', 'paths')}):`);
    for (const entry of result.skipped) {
      // A closed reason code only: the path is allowlisted or a bare name, and
      // no diagnostic detail from the reader is surfaced here.
      lines.push(`  ${entry.path}  — ${entry.reason}`);
    }
  }

  lines.push('', 'Cited from the project, not inferred:');
  if (result.declarations.length === 0) {
    lines.push(`  Nothing cited. ${result.evidenceGap ?? ''}`.trimEnd());
  } else {
    for (const declaration of result.declarations) {
      const span = declaration.lineStart === declaration.lineEnd
        ? `line ${declaration.lineStart}`
        : `lines ${declaration.lineStart}-${declaration.lineEnd}`;
      lines.push(`  ${declaration.path} ${span}: ${declaration.claim}`);
      lines.push(`    ${declaration.excerpt}`);
    }
  }

  lines.push('', 'Worth knowing:');
  for (const caveat of result.caveats) lines.push(`  - ${caveat}`);

  return lines.join('\n');
}

/** Absence in a bounded scan, exposed so a caller cannot mistake it for a fact. */
export { absenceInBoundedScan };
