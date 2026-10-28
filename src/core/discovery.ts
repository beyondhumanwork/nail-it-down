/**
 * M2 Slice 1: a bounded, host-independent repository-discovery policy.
 *
 * Everything here is pure. There is no filesystem module import, no host exec
 * surface, no model call, no network and no workspace write. Reading is expressed as an injected
 * `RepositoryReader` that tests satisfy with in-memory fixtures, which is the
 * only thing that makes the security rules below testable at all.
 *
 * What this module decides, in order:
 *
 *   1. Is inspection permitted at all? (explicit consent, default deny)
 *   2. Which candidate names are safe and allowlisted?
 *   3. Do the candidates fit the budgets?
 *   4. Can a bounded, attributable fact be produced from a manifest?
 *   5. Has a captured fact gone stale or become unverifiable?
 *
 * Three rules shape the whole design and are worth stating before the code:
 *
 * **Fail closed.** Every unrecognised input is refused, not normalised into
 * something acceptable. A path that cannot be proven safe is not a path.
 *
 * **Repository text is data.** `README.md`, `AGENTS.md` and source comments are
 * never instructions to this mod or to an agent reading it. The types in this
 * file make that structural: only a manifest can yield a mechanical fact, and
 * documentation is marked untrusted by construction.
 *
 * **Absence is not a finding.** A bounded scan that finds nothing produces an
 * `AbsenceInBoundedScan`, which is deliberately *not* an `Evidence` and cannot be
 * coerced into one. "Not found here" never becomes "does not exist".
 */

// ---------------------------------------------------------------------------
// Budgets and allowlist (provisional Slice 1 ceilings)
// ---------------------------------------------------------------------------

/**
 * Conservative starting limits. These are engineering ceilings for synthetic
 * fixtures, not a product promise; a later slice may revise them once there is
 * measured behaviour to revise them against.
 */
export type DiscoveryBudget = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFileLines: number;
  maxDirectoryEntries: number;
};

export const DEFAULT_BUDGET: DiscoveryBudget = {
  maxFiles: 6,
  maxFileBytes: 32 * 1024,
  maxTotalBytes: 96 * 1024,
  maxFileLines: 250,
  maxDirectoryEntries: 100,
};

/**
 * Root files this policy will consider, in this order. Order is part of the
 * contract: it is the deterministic candidate ordering, independent of whatever
 * order a filesystem happens to hand back.
 *
 * `README.md` and `AGENTS.md` are documentation — untrusted data. The rest are
 * manifests: machine-readable structure that a literal fact can be derived from.
 */
export const CANDIDATE_POLICY: readonly CandidateSpec[] = [
  { name: 'README.md', kind: 'documentation' },
  { name: 'AGENTS.md', kind: 'documentation' },
  { name: 'package.json', kind: 'manifest' },
  { name: 'pyproject.toml', kind: 'manifest' },
  { name: 'Cargo.toml', kind: 'manifest' },
  { name: 'go.mod', kind: 'manifest' },
  { name: 'tsconfig.json', kind: 'manifest' },
];

export type CandidateKind = 'documentation' | 'manifest';

export type CandidateSpec = {
  name: string;
  kind: CandidateKind;
};

/**
 * Names that are never candidates, even if a future allowlist were widened.
 * .env* is covered by the dotfile rule; these are the non-dotfile hazards.
 */
export const EXCLUDED_NAMES: readonly string[] = [
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'netrc',
  '.npmrc',
  '.pypirc',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'Pipfile.lock',
  'composer.lock',
];

/** Extensions that never belong in evidence, because their contents are secret or binary. */
export const EXCLUDED_EXTENSIONS: readonly string[] = [
  'pem', 'key', 'crt', 'cer', 'p12', 'pfx', 'jks', 'keystore',
  'gpg', 'asc', 'der', 'p8', 'ovpn',
];

/** Directory names excluded at any depth. Slice 1 reads depth 1 only, but the rule is total. */
export const EXCLUDED_DIRECTORIES: readonly string[] = [
  '.git', 'node_modules', '.venv', 'venv', '__pycache__', 'target',
  'dist', 'build', 'coverage', '.cache', '.next', 'vendor',
];

// ---------------------------------------------------------------------------
// Consent — default deny, no UI in this slice
// ---------------------------------------------------------------------------

/**
 * Consent is a required input, never an assumption. Slice 1 has no dialog, so
 * there is nothing here that can infer it: a caller must pass it in, and
 * anything that is not explicitly granted refuses.
 */
export type ConsentDecision = {
  granted: boolean;
  /** How the decision was obtained, for the audit trail. Never inferred here. */
  obtainedBy?: string;
};

function hasConsent(consent: unknown): consent is ConsentDecision & { granted: true } {
  return typeof consent === 'object'
    && consent !== null
    && (consent as { granted?: unknown }).granted === true;
}

// ---------------------------------------------------------------------------
// The reader interface
// ---------------------------------------------------------------------------

/** What a shallow listing says a path is. Anything unusual is reported, not guessed. */
export type EntryKind = 'file' | 'directory' | 'symlink' | 'other' | 'missing';

export type ReaderEntry = {
  /** Workspace-relative path. The reader is trusted to report what it saw, not to sanitise. */
  path: string;
  kind: EntryKind;
  /** Bytes for a regular file, when the reader knows. */
  size?: number;
  /** Link target text for a symlink, if reported. Never followed by the core. */
  target?: string;
};

export type ReadOutcome =
  | { kind: 'ok'; bytes: Uint8Array }
  | { kind: 'missing' }
  | { kind: 'unreadable'; reason: string };

/**
 * The only way this module obtains bytes. Implementations for real filesystems
 * do not exist yet and are explicitly out of scope: a fake reader cannot prove
 * real-host safety, so no test here claims it.
 */
export type RepositoryReader = {
  /** Shallow listing of one directory. `''` is the workspace root. */
  list(relativeDir: string): readonly ReaderEntry[];
  read(relativePath: string): ReadOutcome;
};

// ---------------------------------------------------------------------------
// Rejection vocabulary
// ---------------------------------------------------------------------------

/**
 * Every way a candidate can be refused. Enumerated rather than free text so a
 * test can assert the exact reason and a future UI can show a stable message.
 */
export type RejectionReason =
  // path-level
  | 'not-a-string'
  | 'empty'
  | 'surrounding-whitespace'
  | 'control-character'
  | 'windows-separator'
  | 'encoded-separator'
  | 'absolute'
  | 'empty-segment'
  | 'traversal'
  | 'current-directory'
  | 'not-root-level'
  | 'dotfile'
  | 'excluded-name'
  | 'excluded-extension'
  | 'excluded-directory'
  | 'not-allowlisted'
  | 'case-collision'
  // entry-level
  | 'symlink'
  | 'not-a-regular-file'
  | 'missing'
  // content-level
  | 'unreadable'
  | 'invalid-encoding'
  | 'secret-like-content'
  // budget-level
  | 'file-too-large'
  | 'too-many-lines'
  | 'too-many-files'
  | 'total-too-large'
  | 'too-many-directory-entries'
  // consent
  | 'no-consent';

export type Refusal = {
  reason: RejectionReason;
  detail: string;
};

export type RejectedCandidate = {
  path: string;
  reason: RejectionReason;
  detail: string;
};

// ---------------------------------------------------------------------------
// Path inspection — pure, total, fail-closed
// ---------------------------------------------------------------------------

export type PathInspection =
  | { ok: true; path: string; spec: CandidateSpec }
  | { ok: false; rejection: Refusal };

/**
 * Decides whether a candidate path is safe and allowlisted.
 *
 * Deliberately strict in ways that look redundant, because each strictness
 * corresponds to a documented real-world bypass:
 *
 * - any percent-escape is rejected. No allowlisted filename contains one, so a
 *   `%2e%2e%2f` is never something this policy needed to accept, and repeated
 *   decoding is a reliable source of bypasses.
 * - any backslash is rejected rather than treated as a separator, because
 *   accepting both separator conventions is how the same path becomes two.
 * - the name must match the allowlist exactly, in case. A filesystem that folds
 *   case would otherwise let `readme.md` stand in for `README.md`.
 * - the candidate must be at the workspace root. Slice 1 has no recursive scan,
 *   so a multi-segment path is out of contract even when it is otherwise safe.
 */
export function inspectCandidatePath(raw: unknown): PathInspection {
  const reject = (reason: RejectionReason, detail: string): PathInspection => ({
    ok: false,
    rejection: { reason, detail },
  });

  if (typeof raw !== 'string') return reject('not-a-string', 'a candidate path must be text');
  if (raw === '') return reject('empty', 'the path is empty');
  if (raw !== raw.trim()) return reject('surrounding-whitespace', 'the path has surrounding whitespace');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return reject('control-character', 'the path contains a control character');
  if (raw.includes('\\')) return reject('windows-separator', 'backslashes are not accepted as separators');
  if (/%[0-9a-f]{2}/i.test(raw)) return reject('encoded-separator', 'percent-escaped paths are not accepted');
  if (/^[A-Za-z]:/.test(raw) || raw.startsWith('/') || raw.startsWith('~')) {
    return reject('absolute', 'the path is not workspace-relative');
  }

  const segments = raw.split('/');
  if (segments.some((segment) => segment === '')) return reject('empty-segment', 'the path has an empty segment');
  if (segments.some((segment) => segment === '..')) return reject('traversal', 'the path walks upwards');
  if (segments.some((segment) => segment === '.')) return reject('current-directory', 'the path refers to itself');
  if (segments.length !== 1) return reject('not-root-level', 'only workspace-root files are considered');
  if (EXCLUDED_DIRECTORIES.includes(segments[0])) {
    return reject('excluded-directory', 'that directory is never inspected');
  }

  const name = segments[0];
  if (name.startsWith('.')) return reject('dotfile', 'dotfiles are not inspected');
  if (EXCLUDED_NAMES.includes(name)) return reject('excluded-name', 'that filename is excluded by policy');

  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (extension !== '' && EXCLUDED_EXTENSIONS.includes(extension)) {
    return reject('excluded-extension', 'that file type is excluded by policy');
  }

  const spec = CANDIDATE_POLICY.find((candidate) => candidate.name === name);
  if (spec === undefined) return reject('not-allowlisted', 'that filename is not on the allowlist');

  return { ok: true, path: name, spec };
}

// ---------------------------------------------------------------------------
// Secret and encoding defenses
// ---------------------------------------------------------------------------

/**
 * Patterns that look like real credentials. Defense in depth, not a guarantee:
 * the contract says so explicitly, and this is scoped to synthetic fixtures.
 *
 * Matching is used to *refuse* a file (and to redact excerpts), never to prove a
 * file is safe.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /AKIA[0-9A-Z]{16}/,                                // AWS access key id
  /ASIA[0-9A-Z]{16}/,                                // AWS temporary key id
  /gh[pousr]_[A-Za-z0-9]{20,}/,                      // GitHub tokens
  /sk-[A-Za-z0-9]{20,}/,                             // OpenAI-style secret keys
  /xox[baprs]-[A-Za-z0-9-]{10,}/,                    // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,              // private key material
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,     // JWT-ish
  // Long base64 blob. Requires mixed case *and* a digit so an ordinary long
  // word or a repeated character is not mistaken for a secret: a blunt
  // 40-character rule refused legitimate files as credential-like.
  /(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[0-9])[A-Za-z0-9+/]{40,}={0,2}/,
];

/** True when the text contains something that looks like a credential. */
export function containsSecretLikeContent(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Removes secret-like substrings before any text is put into an excerpt. Used as
 * a second line of defense for content that passed the refusal check, and to
 * keep fixture credentials out of reports.
 */
export function redactSecrets(text: string): string {
  let output = text;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(new RegExp(pattern.source, 'g'), '[redacted]');
  }
  return output;
}

/** Strict UTF-8 decoding. Invalid sequences are refused, never replaced. */
function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Number of content lines, counting a trailing newline as ending the last line. */
function countLines(text: string): number {
  if (text === '') return 0;
  const lines = text.split('\n');
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type SelectedFile = {
  path: string;
  kind: CandidateKind;
  /** Always true: repository text is data, never an instruction. */
  readOnlyData: true;
  bytes: number;
  lines: number;
  /** Decoded text, held only for this call. Never persisted or reported whole. */
  text: string;
};

export type SelectionResult =
  | {
    kind: 'selected';
    files: SelectedFile[];
    rejected: RejectedCandidate[];
    /** True when a budget stopped selection before the candidate list was exhausted. */
    budgetReached: boolean;
  }
  | { kind: 'refused'; refusal: Refusal }
  | { kind: 'empty'; detail: string };

export type SelectionInput = {
  reader: RepositoryReader;
  consent: ConsentDecision | undefined;
  budget?: Partial<DiscoveryBudget>;
};

/**
 * Picks the allowlisted root files that are safe and within budget.
 *
 * Candidate order comes from `CANDIDATE_POLICY`, not from the listing, so the
 * result is identical no matter what order the filesystem reports. A file that
 * fails any check is reported in `rejected` and never enters `files`; nothing is
 * truncated to fit a budget, because a truncated file would be presented as a
 * complete one.
 */
export function selectCandidates(input: SelectionInput): SelectionResult {
  if (!hasConsent(input.consent)) {
    return {
      kind: 'refused',
      refusal: { reason: 'no-consent', detail: 'repository inspection needs explicit consent' },
    };
  }

  const budget: DiscoveryBudget = { ...DEFAULT_BUDGET, ...input.budget };
  const entries = input.reader.list('');

  if (entries.length > budget.maxDirectoryEntries) {
    return {
      kind: 'refused',
      refusal: {
        reason: 'too-many-directory-entries',
        detail: `${entries.length} entries is more than the ${budget.maxDirectoryEntries} this policy will enumerate`,
      },
    };
  }

  const rejected: RejectedCandidate[] = [];
  const files: SelectedFile[] = [];
  let totalBytes = 0;
  let budgetReached = false;

  // Case-folding ambiguity: two entries whose lowercase forms collide mean the
  // same spelling could be two different files depending on the platform. Both
  // names are withheld, including the exactly-spelled one, because "which of
  // these is the real file" is precisely the ambiguity that makes neither safe.
  const byFolded = new Map<string, string[]>();
  for (const entry of entries) {
    const folded = entry.path.toLowerCase();
    const group = byFolded.get(folded);
    if (group === undefined) byFolded.set(folded, [entry.path]);
    else group.push(entry.path);
  }
  const collided = new Set<string>();
  for (const group of byFolded.values()) {
    if (new Set(group).size < 2) continue;
    for (const path of group) collided.add(path);
    for (const path of group) {
      rejected.push({
        path,
        reason: 'case-collision',
        detail: `${group.length} entries differ only by case: ${group.join(', ')}`,
      });
    }
  }

  for (const spec of CANDIDATE_POLICY) {
    const inspection = inspectCandidatePath(spec.name);
    if (!inspection.ok) {
      // A policy entry that fails its own path rules is a programming error, but
      // reporting it beats trusting it.
      rejected.push({ path: spec.name, reason: inspection.rejection.reason, detail: inspection.rejection.detail });
      continue;
    }
    if (collided.has(spec.name)) continue;

    const entry = entries.find((candidate) => candidate.path === spec.name);
    if (entry === undefined) continue;

    if (entry.kind === 'symlink') {
      rejected.push({
        path: spec.name,
        reason: 'symlink',
        detail: entry.target === undefined
          ? 'symlinks are never followed'
          : `symlinks are never followed (points at ${entry.target})`,
      });
      continue;
    }
    if (entry.kind !== 'file') {
      rejected.push({
        path: spec.name,
        reason: 'not-a-regular-file',
        detail: `reported as a ${entry.kind}, not a regular file`,
      });
      continue;
    }

    if (files.length >= budget.maxFiles) {
      budgetReached = true;
      rejected.push({
        path: spec.name,
        reason: 'too-many-files',
        detail: `this policy reads at most ${budget.maxFiles} files`,
      });
      continue;
    }

    const read = input.reader.read(spec.name);
    if (read.kind === 'missing') {
      rejected.push({ path: spec.name, reason: 'missing', detail: 'the listing saw it but reading it found nothing' });
      continue;
    }
    if (read.kind === 'unreadable') {
      rejected.push({ path: spec.name, reason: 'unreadable', detail: read.reason });
      continue;
    }

    // Size is judged on the bytes actually returned, not only on what the
    // listing claimed, because a listing can be stale or wrong.
    const bytes = read.bytes.length;
    if (bytes > budget.maxFileBytes) {
      rejected.push({
        path: spec.name,
        reason: 'file-too-large',
        detail: `${bytes} bytes is more than the ${budget.maxFileBytes} allowed per file`,
      });
      continue;
    }
    if (totalBytes + bytes > budget.maxTotalBytes) {
      budgetReached = true;
      rejected.push({
        path: spec.name,
        reason: 'total-too-large',
        detail: `reading it would pass the ${budget.maxTotalBytes} byte total`,
      });
      continue;
    }

    const text = decodeUtf8(read.bytes);
    if (text === undefined) {
      rejected.push({ path: spec.name, reason: 'invalid-encoding', detail: 'the file is not valid UTF-8' });
      continue;
    }

    const lines = countLines(text);
    if (lines > budget.maxFileLines) {
      rejected.push({
        path: spec.name,
        reason: 'too-many-lines',
        detail: `${lines} lines is more than the ${budget.maxFileLines} allowed per file`,
      });
      continue;
    }

    if (containsSecretLikeContent(text)) {
      // Refused outright rather than redacted-and-kept: this slice has no UI to
      // explain a partly-redacted file, and refusing is the fail-closed answer.
      rejected.push({
        path: spec.name,
        reason: 'secret-like-content',
        detail: 'the file contains something that looks like a credential',
      });
      continue;
    }

    totalBytes += bytes;
    files.push({
      path: spec.name,
      kind: spec.kind,
      readOnlyData: true,
      bytes,
      lines,
      text,
    });
  }

  if (files.length === 0 && rejected.length === 0) {
    return { kind: 'empty', detail: 'this workspace has none of the files this policy would inspect' };
  }

  return { kind: 'selected', files, rejected, budgetReached };
}

// ---------------------------------------------------------------------------
// Evidence and provenance
// ---------------------------------------------------------------------------

/**
 * A bounded, workspace-relative location in a source file. One-based and
 * inclusive, because that is what every editor shows a person.
 */
export type EvidenceSource = {
  path: string;
  lineStart: number;
  lineEnd: number;
};

export type ProvenanceState =
  /** Re-read from the reader and still matching. */
  | 'verified'
  /** The source is still there but its content changed since capture. */
  | 'stale'
  /** The source is gone, so the claim can no longer be checked. */
  | 'missing';

/**
 * A claim that is tied to a source.
 *
 * There is deliberately no `unverified` variant: a claim without a source is not
 * evidence in this model, so `createEvidence` refuses to build one. That makes
 * fabricated provenance a type error rather than a runtime hope.
 */
export type Evidence = {
  /** Short, mechanical, and stated as fact only because a line proves it. */
  claim: string;
  source: EvidenceSource;
  provenance: ProvenanceState;
  /** Bounded, redacted supporting text. Never the whole file. */
  excerpt: string;
};

export type EvidenceRefusal =
  | { kind: 'refused'; refusal: Refusal }
  | { kind: 'not-substantiated'; detail: string };

export type EvidenceResult =
  | { kind: 'evidence'; evidence: Evidence }
  | EvidenceRefusal;

const MAX_EXCERPT_CHARS = 160;

/** Bounded, single-line, redacted excerpt. */
function boundedExcerpt(line: string): string {
  const redacted = redactSecrets(line.trim().replace(/\s+/g, ' '));
  return redacted.length > MAX_EXCERPT_CHARS ? `${redacted.slice(0, MAX_EXCERPT_CHARS)}…` : redacted;
}

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === '\n') line += 1;
  }
  return line;
}

function lineText(text: string, line: number): string {
  return text.split('\n')[line - 1] ?? '';
}

/**
 * Records a declared dependency from a manifest.
 *
 * This is the exemplar of the only kind of fact this slice will produce: a line
 * in `package.json` says a dependency is declared, so "the manifest declares it"
 * is mechanically true. The same evidence can never support "the feature works",
 * which is why the claim text is fixed and narrow rather than free-form.
 *
 * Documentation is refused as a source on purpose: prose cannot prove a
 * dependency, and treating README text as machine-readable is exactly the
 * confusion this milestone exists to prevent.
 */
export function declaredDependencyEvidence(input: {
  reader: RepositoryReader;
  consent: ConsentDecision | undefined;
  budget?: Partial<DiscoveryBudget>;
  dependency: string;
}): EvidenceResult {
  if (!hasConsent(input.consent)) {
    return {
      kind: 'refused',
      refusal: { reason: 'no-consent', detail: 'repository inspection needs explicit consent' },
    };
  }
  if (typeof input.dependency !== 'string' || input.dependency.trim() === '') {
    return { kind: 'not-substantiated', detail: 'a dependency name is required' };
  }

  const selection = selectCandidates({ reader: input.reader, consent: input.consent, budget: input.budget });
  if (selection.kind === 'refused') return { kind: 'refused', refusal: selection.refusal };
  if (selection.kind === 'empty') return { kind: 'not-substantiated', detail: selection.detail };

  const manifest = selection.files.find((file) => file.path === 'package.json');
  if (manifest === undefined) {
    const why = selection.rejected.find((entry) => entry.path === 'package.json');
    return {
      kind: 'not-substantiated',
      detail: why === undefined
        ? 'this workspace has no package.json'
        : `package.json was not read: ${why.reason} (${why.detail})`,
    };
  }

  const needle = `"${input.dependency}"`;
  const offset = manifest.text.indexOf(needle);
  if (offset === -1) {
    return {
      kind: 'not-substantiated',
      detail: `"${input.dependency}" does not appear in package.json`,
    };
  }

  const line = lineNumberAt(manifest.text, offset);
  const excerpt = boundedExcerpt(lineText(manifest.text, line));

  return {
    kind: 'evidence',
    evidence: {
      claim: `package.json declares a dependency named "${input.dependency}"`,
      source: { path: manifest.path, lineStart: line, lineEnd: line },
      provenance: 'verified',
      excerpt,
    },
  };
}

/**
 * Re-checks an existing piece of evidence against the current reader.
 *
 * This is how a captured fact becomes honest after the world moves: the source
 * is re-read, the line is compared, and the result is `verified`, `stale` or
 * `missing`. It never upgrades a claim, and it never repairs one by searching
 * elsewhere.
 *
 * `evidence` is typed `unknown` on purpose. A record that came back from storage
 * is not trustworthy input, and a fabricated or malformed citation must be
 * reported as unverifiable rather than crashing or being silently promoted to
 * `verified`.
 */
export type ReverifyResult =
  | { kind: 'reverified'; evidence: Evidence }
  | { kind: 'not-verifiable'; detail: string };

function isEvidenceLike(value: unknown): value is Evidence {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.claim !== 'string' || candidate.claim.trim() === '') return false;
  if (typeof candidate.excerpt !== 'string') return false;
  if (candidate.provenance !== 'verified' && candidate.provenance !== 'stale' && candidate.provenance !== 'missing') {
    return false;
  }
  const source = candidate.source;
  if (typeof source !== 'object' || source === null) return false;
  const { path, lineStart, lineEnd } = source as Record<string, unknown>;
  if (typeof path !== 'string' || path === '') return false;
  if (typeof lineStart !== 'number' || !Number.isInteger(lineStart) || lineStart < 1) return false;
  if (typeof lineEnd !== 'number' || !Number.isInteger(lineEnd) || lineEnd < lineStart) return false;
  return true;
}

export function reverifyEvidence(input: {
  reader: RepositoryReader;
  consent: ConsentDecision | undefined;
  evidence: unknown;
}): ReverifyResult {
  if (!isEvidenceLike(input.evidence)) {
    return { kind: 'not-verifiable', detail: 'that record is not attributable evidence' };
  }
  const original = input.evidence;

  if (!hasConsent(input.consent)) {
    // Without consent nothing can be re-read, so the claim cannot stand as
    // verified. `stale` is the truthful state: it was once captured, and it can
    // no longer be confirmed.
    return { kind: 'reverified', evidence: { ...original, provenance: 'stale' } };
  }

  const read = input.reader.read(original.source.path);
  if (read.kind === 'missing') return { kind: 'reverified', evidence: { ...original, provenance: 'missing' } };
  if (read.kind === 'unreadable') return { kind: 'reverified', evidence: { ...original, provenance: 'stale' } };

  const text = decodeUtf8(read.bytes);
  if (text === undefined) return { kind: 'reverified', evidence: { ...original, provenance: 'stale' } };
  if (containsSecretLikeContent(text)) return { kind: 'reverified', evidence: { ...original, provenance: 'stale' } };

  const line = lineText(text, original.source.lineStart);
  const stillMatches = redactSecrets(line.trim().replace(/\s+/g, ' ')).startsWith(
    original.excerpt.replace(/…$/, ''),
  );
  return { kind: 'reverified', evidence: { ...original, provenance: stillMatches ? 'verified' : 'stale' } };
}

// ---------------------------------------------------------------------------
// Absence — deliberately not evidence
// ---------------------------------------------------------------------------

/**
 * The result of a bounded scan that found nothing.
 *
 * A distinct type, not an `Evidence` with an empty value, so no caller can store
 * it in place of a fact or render it as one. The note is part of the data
 * because the distinction is the whole point: absence of a match in a bounded
 * scan is not evidence of absence.
 */
export type AbsenceInBoundedScan = {
  kind: 'absence-in-bounded-scan';
  searched: string[];
  note: string;
};

export function absenceInBoundedScan(searched: readonly string[]): AbsenceInBoundedScan {
  return {
    kind: 'absence-in-bounded-scan',
    searched: [...searched],
    note: 'No match was found in the files this policy reads. That is not evidence the thing does not exist.',
  };
}
