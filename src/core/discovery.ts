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

const BUDGET_FIELDS: readonly (keyof DiscoveryBudget)[] = [
  'maxFiles',
  'maxFileBytes',
  'maxTotalBytes',
  'maxFileLines',
  'maxDirectoryEntries',
];

/**
 * Resolves a caller's requested budget against the approved ceilings.
 *
 * `DEFAULT_BUDGET` is a hard ceiling for Slice 1, not a default that can be
 * raised: a caller may ask for something smaller, never for more. Anything that
 * is not a positive finite integer is refused. The diagnostic names the field
 * and the ceiling but never echoes the supplied value, because a malformed
 * value is untrusted input too.
 *
 * This runs before the reader is touched, so an invalid budget cannot cause a
 * directory listing or a file read.
 */
function resolveBudget(
  requested: Partial<DiscoveryBudget> | undefined,
): { ok: true; budget: DiscoveryBudget } | { ok: false; detail: string } {
  const budget: DiscoveryBudget = { ...DEFAULT_BUDGET };
  if (requested === undefined) return { ok: true, budget };
  if (typeof requested !== 'object' || requested === null) {
    return { ok: false, detail: 'the requested budget must be an object' };
  }

  for (const field of BUDGET_FIELDS) {
    const value = (requested as Record<string, unknown>)[field];
    if (value === undefined) continue;

    const ceiling = DEFAULT_BUDGET[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      return { ok: false, detail: `${field} must be a whole number` };
    }
    if (value < 1) return { ok: false, detail: `${field} must be at least 1` };
    if (value > ceiling) {
      return { ok: false, detail: `${field} cannot exceed the approved ceiling of ${ceiling}` };
    }
    budget[field] = value;
  }

  return { ok: true, budget };
}

/**
 * Classifies a reader failure into one of a few fixed phrases.
 *
 * The reader's message never reaches a caller: an OS adapter would put absolute
 * paths, filenames or credential fragments in there, and this text is shown to
 * a person. Mapping to a small closed set keeps it useful for troubleshooting
 * without letting untrusted strings through.
 */
function classifyReadFailure(reason: unknown): string {
  const text = typeof reason === 'string' ? reason.toUpperCase() : '';
  if (text.startsWith('EACCES') || text.startsWith('EPERM')) return 'permission denied';
  if (text.startsWith('EISDIR')) return 'it is a directory';
  if (text.startsWith('ENOENT')) return 'it disappeared';
  if (text.startsWith('ELOOP')) return 'too many links';
  if (text.startsWith('EIO')) return 'the device reported an error';
  if (text.startsWith('EMFILE') || text.startsWith('ENFILE')) return 'too many open files';
  return 'the reader did not explain why';
}

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
  // policy configuration
  | 'invalid-budget'
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

  // Budgets are validated before the reader is touched: an invalid or
  // over-ceiling request must not be able to cause a listing, let alone a read.
  const validated = resolveBudget(input.budget);
  if (!validated.ok) {
    return { kind: 'refused', refusal: { reason: 'invalid-budget', detail: validated.detail } };
  }
  const budget = validated.budget;

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
        // The link target is deliberately not echoed: it is attacker-controlled
        // text that may be a private absolute path, a token, or a credential.
        detail: 'a symlink is never followed, whatever it points at',
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
      // The reader's own message is not echoed: it can carry absolute paths,
      // filenames, or credential fragments from a future OS-backed adapter.
      rejected.push({
        path: spec.name,
        reason: 'unreadable',
        detail: `the file could not be read (${classifyReadFailure(read.reason)})`,
      });
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
 * The only dependency sections this policy understands.
 *
 * A name appearing in `scripts`, `description`, `keywords` or any other field is
 * *not* a dependency declaration, and treating it as one was a real defect: the
 * first version searched for a quoted name anywhere in the file.
 */
export const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

export type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

/**
 * The mechanical thing an item of evidence asserts.
 *
 * Evidence carries this rather than free text so re-verification can re-derive
 * the fact from current structure instead of trusting stored prose. Only one
 * claim kind is supported, and adding another must come with its own derivation.
 */
export type EvidenceAssertion = {
  kind: 'declared-dependency';
  dependency: string;
  section: DependencySection;
};

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
  /** Re-derived from the reader and still matching. */
  | 'verified'
  /** The source is still there but no longer supports the claim. */
  | 'stale'
  /** The source is gone, so the claim can no longer be checked. */
  | 'missing';

/**
 * A claim tied to a source.
 *
 * There is deliberately no `unverified` variant: a claim without a source is not
 * evidence in this model, so fabricated provenance is a type error rather than a
 * runtime hope.
 */
export type Evidence = {
  /** Fixed, narrow text derived from the assertion. Never free-form prose. */
  claim: string;
  assertion: EvidenceAssertion;
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

/**
 * npm's own name shape, bounded to its 214-character limit. Deliberately
 * restrictive: the name is interpolated into a claim string and a regex, so
 * anything outside this alphabet is refused rather than escaped.
 */
const DEPENDENCY_NAME_PATTERN = /^@?[A-Za-z0-9][A-Za-z0-9._/-]{0,213}$/;

export function isSafeDependencyName(value: unknown): value is string {
  return typeof value === 'string' && DEPENDENCY_NAME_PATTERN.test(value);
}

/** The one canonical way to describe this assertion, so stored text cannot drift. */
function canonicalClaim(assertion: EvidenceAssertion): string {
  return `package.json lists "${assertion.dependency}" under "${assertion.section}"`;
}

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

/** Index of the brace closing the object opened at `openIndex`, string-aware. */
function matchingBrace(text: string, openIndex: number): number | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

type SectionRange =
  | { kind: 'found'; open: number; close: number }
  | { kind: 'absent' }
  | { kind: 'unsupported'; detail: string }
  | { kind: 'ambiguous'; detail: string };

/**
 * Locates one dependency section's object literal in the raw text.
 *
 * Exactly one occurrence is required. A duplicate `"dependencies": {` block
 * makes the citation ambiguous — JSON.parse would silently keep the last one,
 * so guessing a position would be inventing a citation.
 */
function findSectionRange(text: string, section: DependencySection): SectionRange {
  const pattern = new RegExp(`"${section}"\\s*:\\s*\\{`, 'g');
  const occurrences = [...text.matchAll(pattern)];
  if (occurrences.length === 0) {
    // A `"section": "not an object"` shape is unsupported, not absent.
    const wrongShape = new RegExp(`"${section}"\\s*:\\s*[^\\s{]`).test(text);
    return wrongShape
      ? { kind: 'unsupported', detail: `"${section}" is not an object` }
      : { kind: 'absent' };
  }
  if (occurrences.length > 1) {
    return { kind: 'ambiguous', detail: `more than one "${section}" section` };
  }
  const match = occurrences[0];
  const open = match.index + match[0].length - 1;
  const close = matchingBrace(text, open);
  if (close === undefined) {
    return { kind: 'ambiguous', detail: `the "${section}" section is not closed` };
  }
  return { kind: 'found', open, close };
}

export type DependencyLocation =
  | { ok: true; section: DependencySection; source: EvidenceSource; excerpt: string }
  | { ok: false; detail: string };

/**
 * Establishes, from a manifest's own structure, that it declares a dependency —
 * and where.
 *
 * Two independent checks must agree before anything is claimed:
 *
 * 1. `JSON.parse` is the authority on *whether* the declaration exists, in a
 *    supported section, with a string value.
 * 2. A bounded text scan of that same section is the authority on *where*,
 *    because JSON.parse discards positions.
 *
 * Both are required. Trusting the scan alone is what produced a false positive
 * when a name appeared in `scripts`; trusting the parse alone would invent a
 * line number.
 */
export function locateDeclaredDependency(text: string, dependency: string): DependencyLocation {
  if (!isSafeDependencyName(dependency)) {
    return { ok: false, detail: 'that is not a dependency name this policy will look for' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, detail: 'package.json is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, detail: 'package.json is not a JSON object' };
  }
  const root = parsed as Record<string, unknown>;

  let section: DependencySection | undefined;
  let sawUnsupported = false;

  for (const candidate of DEPENDENCY_SECTIONS) {
    const block = root[candidate];
    if (block === undefined) continue;
    if (typeof block !== 'object' || block === null || Array.isArray(block)) {
      sawUnsupported = true;
      continue;
    }
    if (!Object.hasOwn(block, dependency)) continue;
    const value = (block as Record<string, unknown>)[dependency];
    if (typeof value !== 'string' || value.trim() === '') {
      sawUnsupported = true;
      continue;
    }
    section = candidate;
    break;
  }

  if (section === undefined) {
    return {
      ok: false,
      detail: sawUnsupported
        ? `${dependency} is declared in an unsupported form`
        : `${dependency} is not declared in a supported dependency section`,
    };
  }

  const range = findSectionRange(text, section);
  if (range.kind === 'absent') return { ok: false, detail: `package.json has no "${section}" section` };
  if (range.kind === 'unsupported') return { ok: false, detail: range.detail };
  if (range.kind === 'ambiguous') return { ok: false, detail: `the citation is ambiguous: ${range.detail}` };

  const inner = text.slice(range.open + 1, range.close);
  const entryPattern = new RegExp(
    `"${dependency.replace(/[^A-Za-z0-9]/g, (character) => `\\${character}`)}"\\s*:\\s*"`,
    'g',
  );
  const entries = [...inner.matchAll(entryPattern)];
  if (entries.length === 0) {
    // The parse says it is declared but the text cannot show where. Refusing
    // beats pointing at a plausible-looking line.
    return { ok: false, detail: `the declaration of ${dependency} could not be located unambiguously` };
  }
  if (entries.length > 1) {
    return { ok: false, detail: `the citation is ambiguous: ${dependency} appears more than once in "${section}"` };
  }

  const keyOffset = range.open + 1 + entries[0].index;
  const valueOffset = keyOffset + entries[0][0].length - 1;
  const lineStart = lineNumberAt(text, keyOffset);
  const lineEnd = lineNumberAt(text, valueOffset);
  const excerpt = boundedExcerpt(lineText(text, lineStart));

  // The cited span must actually show the declaration it is cited for.
  if (!lineText(text, lineStart).includes(`"${dependency}"`)) {
    return { ok: false, detail: 'the declaration is not on the line it was located at' };
  }

  return {
    ok: true,
    section,
    source: { path: 'package.json', lineStart, lineEnd },
    excerpt,
  };
}

/**
 * Records a declared dependency from a manifest.
 *
 * The claim is narrow on purpose: the manifest *lists* the name in a dependency
 * section. It says nothing about whether the package is installed, whether it
 * works, or whether anything uses it — none of which a line of JSON can prove.
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
  if (!isSafeDependencyName(input.dependency)) {
    return { kind: 'not-substantiated', detail: 'that is not a dependency name this policy will look for' };
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

  const located = locateDeclaredDependency(manifest.text, input.dependency);
  if (!located.ok) return { kind: 'not-substantiated', detail: located.detail };

  const assertion: EvidenceAssertion = {
    kind: 'declared-dependency',
    dependency: input.dependency,
    section: located.section,
  };

  return {
    kind: 'evidence',
    evidence: {
      claim: canonicalClaim(assertion),
      assertion,
      source: located.source,
      provenance: 'verified',
      excerpt: located.excerpt,
    },
  };
}

// ---------------------------------------------------------------------------
// Re-verification
// ---------------------------------------------------------------------------

export type ReverifyResult =
  | { kind: 'reverified'; evidence: Evidence }
  | { kind: 'not-verifiable'; detail: string };

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDependencyAssertion(value: unknown): value is EvidenceAssertion {
  if (!isRecordLike(value)) return false;
  if (value.kind !== 'declared-dependency') return false;
  if (!isSafeDependencyName(value.dependency)) return false;
  return (DEPENDENCY_SECTIONS as readonly string[]).includes(value.section as string);
}

/**
 * Validates a stored record before it is allowed to cause a read.
 *
 * A record read back from anywhere is untrusted input. Everything it can steer —
 * the path, the assertion kind, the claim text — is checked against the policy,
 * and the claim must be exactly the canonical text for its assertion so that
 * arbitrary prose cannot ride along on a genuine citation.
 */
function isEvidenceLike(value: unknown): value is Evidence {
  if (!isRecordLike(value)) return false;
  if (!isDependencyAssertion(value.assertion)) return false;
  if (typeof value.claim !== 'string' || value.claim !== canonicalClaim(value.assertion)) return false;
  if (typeof value.excerpt !== 'string') return false;
  if (value.provenance !== 'verified' && value.provenance !== 'stale' && value.provenance !== 'missing') {
    return false;
  }
  if (!isRecordLike(value.source)) return false;
  const { path, lineStart, lineEnd } = value.source;
  if (typeof path !== 'string' || path === '') return false;
  if (typeof lineStart !== 'number' || !Number.isInteger(lineStart) || lineStart < 1) return false;
  if (typeof lineEnd !== 'number' || !Number.isInteger(lineEnd) || lineEnd < lineStart) return false;
  return true;
}

/**
 * Re-checks a stored piece of evidence against the current reader.
 *
 * The order matters and is the point of this function:
 *
 * 1. Validate the record. A malformed one is reported, never read.
 * 2. Refuse without consent — and without touching the reader at all, so a
 *    consent-less call cannot even disclose which paths exist.
 * 3. Validate the cited path against the same policy the reader uses. A forged
 *    citation pointing at `.env`, an absolute path, a traversal or a
 *    non-allowlisted name is rejected **before** any reader call, so a forbidden
 *    path is never read merely to discover it is forbidden.
 * 4. Re-run the full selection, which re-applies entry type, symlink, encoding,
 *    size, line, total and secret checks.
 * 5. Re-derive the assertion from the manifest's own structure and compare. The
 *    excerpt is compared for equality rather than as a prefix, so a tampered
 *    excerpt cannot inherit a verified state.
 */
export function reverifyEvidence(input: {
  reader: RepositoryReader;
  consent: ConsentDecision | undefined;
  budget?: Partial<DiscoveryBudget>;
  evidence: unknown;
}): ReverifyResult {
  if (!isEvidenceLike(input.evidence)) {
    return { kind: 'not-verifiable', detail: 'that record is not attributable evidence' };
  }
  const original = input.evidence;

  // No consent: read nothing, and never hand back a fresh verified claim.
  if (!hasConsent(input.consent)) {
    return { kind: 'reverified', evidence: { ...original, provenance: 'stale' } };
  }

  // Path policy first: pure, so a forbidden path causes zero reader calls.
  const inspection = inspectCandidatePath(original.source.path);
  if (!inspection.ok) {
    return {
      kind: 'not-verifiable',
      detail: `the cited source is not a path this policy reads (${inspection.rejection.reason})`,
    };
  }

  const selection = selectCandidates({
    reader: input.reader,
    consent: input.consent,
    budget: input.budget,
  });
  if (selection.kind === 'refused') {
    return { kind: 'not-verifiable', detail: `the source cannot be re-read (${selection.refusal.reason})` };
  }

  const rejected = selection.kind === 'selected'
    ? selection.rejected.find((entry) => entry.path === original.source.path)
    : undefined;
  const manifest = selection.kind === 'selected'
    ? selection.files.find((file) => file.path === original.source.path)
    : undefined;

  if (manifest === undefined) {
    // Refused by policy now (symlink, encoding, size, secret) means it can no
    // longer be confirmed; genuinely absent means it is gone.
    const provenance: ProvenanceState = rejected === undefined ? 'missing' : 'stale';
    return { kind: 'reverified', evidence: { ...original, provenance } };
  }

  if (manifest.kind !== 'manifest') {
    return { kind: 'reverified', evidence: { ...original, provenance: 'stale' } };
  }

  const located = locateDeclaredDependency(manifest.text, original.assertion.dependency);
  if (!located.ok) {
    return { kind: 'reverified', evidence: { ...original, provenance: 'stale' } };
  }

  const unchanged = located.section === original.assertion.section
    && located.source.path === original.source.path
    && located.source.lineStart === original.source.lineStart
    && located.source.lineEnd === original.source.lineEnd
    && located.excerpt === original.excerpt;

  return {
    kind: 'reverified',
    evidence: { ...original, provenance: unchanged ? 'verified' : 'stale' },
  };
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
