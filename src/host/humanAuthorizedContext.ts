/**
 * M2-5D: human-authorised repository context.
 *
 * The synthetic adapter (`offerRepositoryContext`) takes a `FixtureAuthorization`
 * from its caller. That is the right shape for a harness that mints its own
 * fixture, and the wrong shape for production: a caller-supplied path is a claim,
 * not a decision by the person using the tool.
 *
 * This module is the human-authorised counterpart. It supplies the pilot with an
 * `authorizeRoot` *function* instead of a static root, so the authorization is
 * established by a native dialog answered at runtime, in order, by the operator.
 * There is no parameter here through which a caller can name a root:
 *
 *     offerHumanAuthorizedContext({ ui })   // <- no root argument exists
 *
 * THE THREE POSITIVE HUMAN DECISIONS
 *
 *   1. opt in       - the interview asks whether to use repository context at all
 *   2. authorise    - the person types an exact root and then explicitly confirms
 *                     that this exact root may be inspected for this invocation
 *   3. consent      - the person explicitly grants a bounded read of the
 *                     disclosed allowlist
 *
 * Steps 2 and 3 are separate dialogs with separate labels and separate refusal
 * paths. Authorising a root is not authorising a read, and the tests assert each
 * is refused independently of the other.
 *
 * WHAT THIS IS NOT
 *
 * A callback is **not** proof of a human decision. `runWorkspacePilot` will
 * accept any function that returns `{ok: true, root: proposed, ...}` - a caller
 * of the general pilot can supply one without ever showing a dialog. The
 * trust boundary is *this wrapper*: `offerHumanAuthorizedContext` always passes
 * `authorizeRootByHuman`, which asks the operator. The callback shape makes the
 * root unforgeable *within this module*; it is not an unforgeable capability in
 * the language sense, and the pilot's own comment says so too.
 *
 * Nor is it proof that a filesystem is safe. Canonical-root and symlink checks
 * run in the reader; ownership and mount provenance are checked by the pre-read
 * gate below, which can only refuse and never establishes that a directory is
 * honest. The cooperative-workspace threat model is unchanged: hostile
 * concurrent replacement of a parent directory is not reliably prevented or
 * detected. The authorization says "the person chose this directory".
 */

import * as nodePath from 'node:path';
import { lstatSync, readFileSync, statSync } from 'node:fs';

import type { ModUi } from './modApi.ts';
import {
  PILOT_PERSISTENCE_STATEMENT,
  pilotDisclosure,
  runWorkspacePilot,
} from './workspacePilot.ts';
import type { PilotRefusalReason, PilotResult, PreReadDecision } from './workspacePilot.ts';
import { verifiedEvidenceOf } from './offerRepositoryContext.ts';
import type { RepositoryContextOutcome } from './offerRepositoryContext.ts';

/** The root-authorization dialog. Separate from the read-consent dialog. */
export const AUTHORIZE_TITLE = 'Inspect this exact workspace for this run?';
export const AUTHORIZE_LABELS = {
  refuse: 'Do not inspect it',
  grant: 'Inspect this workspace',
} as const;

/** The opt-in question, asked before anything else happens. */
export const OPT_IN_TITLE = 'Use repository context for this interview?';
export const OPT_IN_LABELS = {
  ideaOnly: 'Continue without reading files',
  useRepository: 'Offer to read project files',
} as const;

export type HumanRefusalReason =
  | 'opted-out'
  | 'opt-in-dismissed'
  | 'opt-in-malformed'
  | 'no-ui'
  /** The person declined to authorise the root. */
  | 'root-not-authorized'
  | 'authorization-dismissed'
  | 'authorization-malformed'
  /** The authorization dialog could not be shown the terms it authorises. */
  | 'authorization-surface-failed'
  | `pilot:${string}`;

export type HumanAuthorizedOutcome =
  | { kind: 'idea-only'; reason: HumanRefusalReason; message: string }
  | {
    kind: 'inspected';
    message: string;
    root: string;
    filesRead: number;
    filesRejected: number;
    evidence: ReturnType<typeof verifiedEvidenceOf>;
  };

function isUsable(ui: ModUi | undefined): ui is ModUi {
  if (ui === undefined) return false;
  if (typeof ui.select !== 'function' || typeof ui.input !== 'function') return false;
  // A host with no rendered surface resolves `undefined` for every dialog, which
  // is indistinguishable from a dismissal - and a dialog nobody saw is not a
  // decision. Refuse before asking rather than after.
  if (ui.capabilities?.surface === false) return false;
  return true;
}

/**
 * Asks whether to use repository context at all.
 *
 * Asked first, and refusal-first, so a person who did not want this feature
 * never sees a path prompt. A dismissal, an unexpected value or a headless host
 * all mean idea-only.
 */
async function askOptIn(ui: ModUi): Promise<{ ok: true } | { ok: false; reason: HumanRefusalReason }> {
  let picked: string | undefined;
  try {
    picked = await ui.select({
      title: OPT_IN_TITLE,
      options: [
        { label: OPT_IN_LABELS.ideaOnly, description: 'Nothing is read. The interview works without it.' },
        { label: OPT_IN_LABELS.useRepository, description: 'You will be asked for a folder, and then asked to allow a bounded read.' },
      ],
    });
  } catch {
    return { ok: false, reason: 'opt-in-dismissed' };
  }
  if (picked === OPT_IN_LABELS.useRepository) return { ok: true };
  if (picked === OPT_IN_LABELS.ideaOnly) return { ok: false, reason: 'opted-out' };
  if (picked === undefined) return { ok: false, reason: 'opt-in-dismissed' };
  return { ok: false, reason: 'opt-in-malformed' };
}

/**
 * The mid-sequence human root authorization.
 *
 * Returns the root the person authorised, or a refusal. The dialog shows the
 * exact path being authorised and the persistence boundary, because a person
 * agreeing to "inspect this workspace" should be able to see both at the moment
 * they decide.
 *
 * Note what is *not* here: no filesystem call. Nothing in this function stats,
 * resolves or opens the path. It is shown and confirmed, and the pilot does the
 * rest only after the read consent has also been granted.
 */
export async function authorizeRootByHuman(
  ui: ModUi,
  proposed: string,
): Promise<{ ok: true; root: string; issuedBy: string } | { ok: false; reason: PilotRefusalReason }> {
  const notify = ui.notify;
  if (typeof notify !== 'function') {
    // No surface means the terms were never shown, which means the answer is not
    // informed. Fail closed rather than asking anyway.
    //
    // This branch is behaviourally redundant with the `catch` below - calling
    // `notify.call` on `undefined` throws a TypeError, which lands on the same
    // refusal. It exists because an explicit check is legible and does not make
    // the safety property rest on exception control flow; it is asserted by the
    // zero-dialogs test, not claimed as independently necessary.
    return { ok: false, reason: 'authorization-disclosure-failed' };
  }
  try {
    notify.call(ui, [
      `You are about to authorise this exact folder for this run: ${proposed}`,
      'Authorising the folder is not the same as allowing a read: you will be asked separately.',
      `Only these root files can ever be read: README.md, AGENTS.md, package.json, pyproject.toml, Cargo.toml, go.mod, tsconfig.json.`,
      `Host persistence: ${PILOT_PERSISTENCE_STATEMENT}`,
    ].join('\n'), 'warning');
  } catch {
    return { ok: false, reason: 'authorization-disclosure-failed' };
  }

  let picked: string | undefined;
  try {
    picked = await ui.select({
      title: AUTHORIZE_TITLE,
      options: [
        { label: AUTHORIZE_LABELS.refuse, description: 'Nothing is inspected. This is the safe answer.' },
        { label: AUTHORIZE_LABELS.grant, description: `Authorise exactly ${proposed} for this run only.` },
      ],
    });
  } catch {
    return { ok: false, reason: 'disclosure-failed' };
  }

  if (picked === AUTHORIZE_LABELS.grant) {
    return { ok: true, root: proposed, issuedBy: 'human authorization dialog, this invocation' };
  }
  if (picked === AUTHORIZE_LABELS.refuse) return { ok: false, reason: 'not-authorized-root' };
  if (picked === undefined) return { ok: false, reason: 'not-authorized-root' };
  return { ok: false, reason: 'authorization-malformed' };
}

/**
 * Filesystem types that are known to be remote or distributed.
 *
 * Used only to choose between two refusal reasons - both of which refuse. The
 * allowlist above is what decides admission; this list never admits anything.
 */
export const NETWORK_FILESYSTEMS: readonly string[] = [
  'nfs', 'nfs4', 'cifs', 'smb3', 'smbfs', 'sshfs', 'fuse.sshfs', '9p', 'ceph',
  'cephfs', 'glusterfs', 'afs', 'davfs', 'fuse.davfs2', 'ncpfs', 'coda',
];

/**
 * The pre-read gate for the human path.
 *
 * Why this exists: `validateRoot` and the OS reader check the path, symlinks and
 * canonical identity - they do **not** check UID ownership or whether the path
 * lives on an acceptable local filesystem. `permittedParents` is derived from
 * the approved root, so it proves nothing about provenance or localness. Without
 * this gate the human flow would be reading an arbitrary directory while the
 * handoff claimed ownership and mount checks ran.
 *
 * It can only refuse. It runs after the native grant and after the root is
 * validated, and before any candidate file is opened.
 *
 * WHAT IT DOES NOT CLAIM
 *
 * `statfs.type` is not a portable mount guarantee, so none is invented from it.
 * The check is narrow and honest:
 *
 *   - the root must be a directory, not a symlink, owned by the running user
 *   - the mount table must be readable, and a mount must actually cover the path
 *   - the deepest covering mount must not sit exactly on the root (that would be
 *     something mounted over the prepared directory)
 *   - when `/proc/mounts` is unavailable - macOS, for instance - the mount
 *     conditions are reported as **unverifiable** and the read is refused, rather
 *     than assumed safe. This is a deliberate narrowing: the human path stays
 *     closed on platforms where the check cannot run.
 *
 * A bind mount of the same filesystem is indistinguishable from this metadata
 * and is not detected. That remains a documented residual under Option A.
 */
/**
 * Filesystem types this policy will read from on Linux.
 *
 * A **narrow allowlist**, not a "not-network" denylist. The difference matters:
 * a denylist accepts every filesystem nobody thought to enumerate, so a new
 * network or FUSE type would pass by default. An allowlist fails closed on the
 * unknown, which is the direction a security gate has to fail.
 *
 * Each entry is a local, kernel-implemented filesystem whose contents live on a
 * block device this machine owns:
 *
 *   ext2/ext3/ext4  the standard Linux disk filesystems
 *   xfs, btrfs      local journaling/CoW filesystems
 *   f2fs            flash-oriented local filesystem
 *
 * Deliberately absent, and therefore refused: `tmpfs` (a RAM filesystem whose
 * contents vanish and whose "localness" is meaningless), `overlay` (a union
 * whose lower layers can be remote), any `fuse.*` including `fuse.sshfs`, `nfs`,
 * `nfs4`, `cifs`, `smb3`, `9p`, `ceph`, `glusterfs`, `afs`, `davfs`, and every
 * type not listed. A user whose workspace lives on btrfs-over-LVM is covered;
 * one on ZFS is not - and gets a refusal rather than a guess.
 */
export const LINUX_LOCAL_FILESYSTEMS: readonly string[] = [
  'ext2',
  'ext3',
  'ext4',
  'xfs',
  'btrfs',
  'f2fs',
];

/** One `/proc/self/mountinfo` entry, decoded. */
export type ParsedMount = {
  /** Decoded mount point. */
  point: string;
  /** Decoded root within the filesystem. */
  root: string;
  /** Filesystem type, or `undefined` when the entry is malformed. */
  fstype: string | undefined;
  /** Decoded mount source. */
  source: string | undefined;
};

/**
 * Decodes the octal escapes mountinfo uses for spaces and other bytes.
 *
 * `\040` is a space, `\011` a tab, `\012` a newline, `\134` a backslash. A path
 * containing any of them would otherwise be compared as the escaped text and
 * never match the real path - so a mount over `/mnt/my\040project` would be
 * invisible to the covering check.
 */
export function decodeMountField(field: string): string {
  return field.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

/**
 * Parses `/proc/self/mountinfo`.
 *
 * Chosen over `/proc/mounts` because it carries the filesystem **type** in a
 * separate field after the `-` separator, and an unambiguous mount root. The
 * format is:
 *
 *   id parent major:minor root mount-point options optional... - fstype source superopts
 *
 * The optional fields between the mount options and the `-` vary per mount, so
 * the separator has to be located rather than indexed positionally.
 */
export function parseMountInfo(text: string): ParsedMount[] {
  const mounts: ParsedMount[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const fields = line.split(' ');
    const dash = fields.indexOf('-');
    if (fields.length < 5) continue;
    const root = fields[3];
    const point = fields[4];
    if (root === undefined || point === undefined) continue;
    mounts.push({
      root: decodeMountField(root),
      point: decodeMountField(point),
      fstype: dash === -1 ? undefined : fields[dash + 1],
      source: dash === -1 ? undefined : fields[dash + 2],
    });
  }
  return mounts;
}

/** True when `point` covers `target` (or is the target itself). */
function covers(point: string, target: string): boolean {
  if (target === point) return true;
  return target.startsWith(point.endsWith('/') ? point : `${point}/`);
}

export function verifyHumanRootPreconditions(
  root: string,
  options: {
    uid?: number;
    /**
     * Injected mount data for tests. `undefined` reads the real
     * `/proc/self/mountinfo`; `null` means "no mount view is available".
     */
    mountTable?: string | null;
  } = {},
): PreReadDecision {
  let link;
  let stat;
  try {
    link = lstatSync(root);
    stat = statSync(root);
  } catch {
    return { ok: false, reason: 'root-not-directory' };
  }
  if (link.isSymbolicLink()) return { ok: false, reason: 'root-symlinked' };
  if (!stat.isDirectory()) return { ok: false, reason: 'root-not-directory' };

  // `process.getuid` does not exist on Windows. Without it there is no ownership
  // check to make, and "could not check" must not read as "checked and fine".
  const uid = options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined);
  if (uid === undefined) return { ok: false, reason: 'mount-unverifiable' };
  if (stat.uid !== uid) return { ok: false, reason: 'root-owner-mismatch' };

  // An explicitly supplied "no table" means the caller knows it is unavailable.
  let table: string;
  if (options.mountTable === null) return { ok: false, reason: 'mount-unverifiable' };
  if (typeof options.mountTable === 'string') {
    table = options.mountTable;
  } else {
    try {
      table = readFileSync('/proc/self/mountinfo', 'utf8');
    } catch {
      // No Linux mount view on this platform (macOS, Windows): fail closed rather
      // than guess. Those platforms need their own separately verified policy.
      return { ok: false, reason: 'mount-unverifiable' };
    }
  }

  const mounts = parseMountInfo(table).filter((entry) => covers(entry.point, root));
  if (mounts.length === 0) return { ok: false, reason: 'mount-unverifiable' };

  // The deepest covering mount is the filesystem the path actually lives on.
  let deepest = mounts[0]!;
  for (const entry of mounts) {
    if (entry.point.length >= deepest.point.length) deepest = entry;
  }

  // Something mounted exactly over the approved root means the path is no longer
  // the directory that was approved.
  if (deepest.point === root) return { ok: false, reason: 'root-is-a-mount-point' };

  // An entry without a `-` separator carries no filesystem type, so it cannot be
  // classified. Unknown is not the same as safe.
  if (deepest.fstype === undefined || deepest.fstype === '') {
    return { ok: false, reason: 'mount-unverifiable' };
  }

  // Everything not on the allowlist is refused, including filesystems this build
  // has never heard of. `network` is reported separately only so the reason a
  // caller sees is the more informative one; both refuse.
  if (!LINUX_LOCAL_FILESYSTEMS.includes(deepest.fstype)) {
    return {
      ok: false,
      reason: NETWORK_FILESYSTEMS.includes(deepest.fstype) ? 'mount-not-acceptable' : 'mount-unverifiable',
    };
  }

  return { ok: true };
}

/**
 * Appends the host-persistence note to any message.
 *
 * One helper for every outcome, including the ones that never reach the pilot:
 * a person told "nothing was read" still deserves to know what the host keeps.
 */
function withHostPersistenceNote(body: string): string {
  return `${body}\n\nHost persistence: ${PILOT_PERSISTENCE_STATEMENT}`;
}

/** Renders a pilot result, appending the host-persistence boundary. */
function messageFor(result: PilotResult): string {
  const body = result.kind === 'inspected'
    ? renderInspected(result)
    : renderOther(result);
  return withHostPersistenceNote(body);
}

function renderOther(result: Exclude<PilotResult, { kind: 'inspected' }>): string {
  if (result.kind === 'refused') {
    return ['Workspace pilot — nothing was read', '', `Reason: ${result.reason}`, result.note].join('\n');
  }
  if (result.kind === 'nothing-to-read') {
    return ['Workspace pilot — nothing to read', '', result.detail,
      'This is not evidence that the project lacks these files.'].join('\n');
  }
  return ['Workspace pilot — nothing was read', '',
    `The workspace was refused before any file was read (${result.reason}).`, result.detail].join('\n');
}

function renderInspected(result: Extract<PilotResult, { kind: 'inspected' }>): string {
  const lines = ['Workspace pilot', '', `Root: ${result.root.proposed}`, ''];
  lines.push(`Read ${result.files.length} files:`);
  for (const file of result.files) lines.push(`  ${file.path}  (${file.kind}, ${file.lines} lines)`);
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

/**
 * The production-facing entrypoint.
 *
 * Takes **only** the UI. There is no root parameter and no mount-table override,
 * so a caller cannot name a directory to authorise nor fabricate the mount data
 * that the pre-read gate consults. The gate always reads the real
 * `/proc/mounts`, and refuses when it cannot.
 */
export async function offerHumanAuthorizedContext(input: {
  ui: ModUi | undefined;
}): Promise<HumanAuthorizedOutcome> {
  return runHumanFlow(input.ui, {});
}

/**
 * Test-only harness.
 *
 * Exists because macOS has no `/proc/mounts`, so without an injectable table the
 * *success* path of this module could never be exercised on the machine that runs
 * the tests. It is a separate named export, deliberately not a member of the
 * production input, so reaching the override requires importing a symbol whose
 * name says what it is for.
 *
 * This is a boundary by *convention and naming*, not by capability. Nothing stops
 * production code from importing this function - TypeScript has no "test-only"
 * enforcement, and a build-time exclusion would be a packaging concern this slice
 * does not own. What it does guarantee is that the ordinary entrypoint cannot be
 * misused by accident, which is the failure that was actually reported. A real
 * capability boundary would need the mount check to be uninjectable, and then the
 * positive path would be untestable on this platform; that trade-off is recorded
 * as a blocker rather than hidden.
 */
export async function offerHumanAuthorizedContextForTests(input: {
  ui: ModUi | undefined;
  /** Fabricated mount table, so the covering-mount check can pass on macOS. */
  mountTable?: string;
}): Promise<HumanAuthorizedOutcome> {
  return runHumanFlow(
    input.ui,
    input.mountTable === undefined ? {} : { mountTable: input.mountTable },
  );
}

/** The flow both entrypoints share, so the two cannot drift apart. */
async function runHumanFlow(
  ui: ModUi | undefined,
  gate: { mountTable?: string },
): Promise<HumanAuthorizedOutcome> {
  if (!isUsable(ui)) {
    return {
      kind: 'idea-only',
      reason: 'no-ui',
      message: withHostPersistenceNote(
        'Repository context was not offered: this host has no dialog surface, so nothing was read.',
      ),
    };
  }

  const optIn = await askOptIn(ui);
  if (!optIn.ok) {
    return {
      kind: 'idea-only',
      reason: optIn.reason,
      message: withHostPersistenceNote(
        `Repository context was not used (${optIn.reason}), so nothing was read.`,
      ),
    };
  }

  const result = await runWorkspacePilot({
    ui,
    // The root is established by the human step, not supplied here. There is no
    // `authorization` member on purpose.
    authorizeRoot: (proposed) => authorizeRootByHuman(ui, proposed),
    // Ownership and mount provenance, which the reader does not check. Fail-closed.
    beforeRead: (root) => verifyHumanRootPreconditions(
      root.canonical,
      gate.mountTable === undefined ? {} : { mountTable: gate.mountTable },
    ),
  });

  if (result.kind !== 'inspected') {
    const reason: HumanRefusalReason = result.kind === 'refused'
      ? `pilot:${result.reason}`
      : result.kind === 'not-inspected'
        ? `pilot:${result.reason}`
        : 'pilot:nothing-to-read';
    return { kind: 'idea-only', reason, message: messageFor(result) };
  }

  return {
    kind: 'inspected',
    message: messageFor(result),
    root: result.root.canonical,
    filesRead: result.files.length,
    filesRejected: result.skipped.length,
    evidence: verifiedEvidenceOf(result.declarations),
  };
}

/** True only when this outcome carries at least one verified, citable claim. */
export function hasVerifiedHumanEvidence(outcome: HumanAuthorizedOutcome): boolean {
  return outcome.kind === 'inspected' && outcome.evidence.length > 0;
}

/** The disclosure shown before the read consent, for tests and review. */
export function humanDisclosure(proposedRoot: string): string {
  return pilotDisclosure(nodePath.resolve(proposedRoot));
}

/** Re-exported so a future interview step needs one import. */
export type { RepositoryContextOutcome };
