/**
 * M2 Slice 2: an OS-backed `RepositoryReader` for disposable synthetic
 * workspaces only.
 *
 * This is the one module allowed to import Node's filesystem. It exists to prove
 * that the Slice 1 policy can be backed by real bytes without weakening, and it
 * is deliberately **not** imported by `src/index.ts`: no live `/naildown` path
 * can reach a real repository through it.
 *
 * The design in one paragraph: resolve and identify the workspace root once,
 * refuse anything that is not demonstrably inside a permitted fixture parent,
 * enumerate only the root and only up to the approved entry cap, then for each
 * read open with `O_NOFOLLOW | O_NONBLOCK`, judge the **descriptor** rather than
 * the path, read with a hard byte cap, and confirm nothing changed underneath.
 * Every descriptor is closed in a `finally`.
 *
 * What this cannot prove is stated in `CONTAINMENT_LIMITS` below. The resolve,
 * open and verify steps are not one atomic operation, and Node exposes no
 * `openat`/`dirfd`, so a directory swapped between two calls is detectable but
 * not preventable. That is reported, not papered over.
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';

import { CANDIDATE_POLICY, DEFAULT_BUDGET, inspectCandidatePath } from '../core/discovery.ts';
import type { EntryKind, ReadOutcome, ReaderEntry, RepositoryReader } from '../core/discovery.ts';

/**
 * The guarantees this adapter does and does not provide. Written down because a
 * reader that quietly implies more safety than it has is worse than one that
 * says where it stops.
 */
export const CONTAINMENT_LIMITS = {
  /** Parent components are compared after `realpath`, so `/tmp` → `/private/tmp` is handled. */
  resolvesSymlinkedAncestors: true,
  /** The root itself may not be a symlink, and its identity is re-checked per operation. */
  rejectsSymlinkedRoot: true,
  /** The opened descriptor is `fstat`ed; a symlink swapped in after listing fails `O_NOFOLLOW`. */
  verifiesOpenedDescriptor: true,
  /**
   * NOT proven: a parent directory replaced by a symlink between the `realpath`
   * check and the `open`. Node has no `openat`/`dirfd`, so there is no way to
   * anchor the open to a verified directory handle. Slice 2 treats this as a
   * documented residual risk, not a solved problem.
   */
  parentSwapRaceProven: false,
  /** NOT proven: behaviour on filesystems that fold case or normalise Unicode differently. */
  caseFoldingVerified: false,
} as const;

export type FileIdentity = {
  dev: number;
  ino: number;
};

export type RootRejection =
  | 'not-absolute'
  | 'missing'
  | 'not-a-directory'
  | 'symlinked-root'
  | 'no-permitted-parents'
  | 'invalid-permitted-parent'
  | 'outside-permitted-parents'
  | 'platform-unsupported';

export type RootValidation =
  | { ok: true; canonicalRoot: string; identity: FileIdentity }
  | { ok: false; reason: RootRejection; detail: string };

/**
 * The open flags, exported so a test can assert what is actually requested
 * rather than trusting a comment. `O_NONBLOCK` is load-bearing: without it,
 * opening a FIFO read-only blocks until a writer appears, which would hang the
 * mod before `fstat` ever got a chance to reject it.
 */
export type OpenFlagSet = {
  supported: boolean;
  flags: number;
  detail: string;
};

function resolveOpenFlags(): OpenFlagSet {
  const constants = fs.constants;
  const hasNoFollow = typeof constants.O_NOFOLLOW === 'number' && constants.O_NOFOLLOW !== 0;
  const hasNonBlock = typeof constants.O_NONBLOCK === 'number' && constants.O_NONBLOCK !== 0;
  if (!hasNoFollow || !hasNonBlock) {
    return {
      supported: false,
      flags: 0,
      detail: hasNoFollow
        ? 'this platform has no O_NONBLOCK, so a FIFO could block the open'
        : 'this platform has no O_NOFOLLOW, so a symlink could be followed silently',
    };
  }
  return {
    supported: true,
    flags: constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    detail: 'O_RDONLY | O_NOFOLLOW | O_NONBLOCK',
  };
}

export const READ_OPEN_FLAGS: OpenFlagSet = resolveOpenFlags();

/**
 * Reads the identity of a path **without** following it.
 *
 * `lstat`, never `stat`: the point is to describe the directory entry, and
 * following a symlink here would defeat the identity comparison later.
 */
function identityOf(stats: fs.Stats | fs.BigIntStats): FileIdentity {
  return {
    dev: typeof stats.dev === 'bigint' ? Number(stats.dev) : stats.dev,
    ino: typeof stats.ino === 'bigint' ? Number(stats.ino) : stats.ino,
  };
}

function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

type FileVersion = {
  identity: FileIdentity;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
};

/**
 * Node exposes filesystem timestamps as bigint nanoseconds, which avoids
 * rounding them in this comparison. The value's effective precision is still
 * the underlying filesystem's: a coarse filesystem can give two rapid writes
 * identical timestamps. Comparing mtime and ctime before/after bounded reads
 * detects many same-inode rewrites, but no lock is held and concurrent writes
 * cannot be ruled out. This is a consistency check, not race-free containment.
 */
function fileVersionOf(stats: fs.BigIntStats): FileVersion {
  return {
    identity: identityOf(stats),
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
  };
}

function sameFileVersion(a: FileVersion, b: FileVersion): boolean {
  return sameIdentity(a.identity, b.identity)
    && a.size === b.size
    && a.mtimeNs === b.mtimeNs
    && a.ctimeNs === b.ctimeNs;
}

/**
 * Containment by path segments, not by string prefix.
 *
 * `/work/a` and `/work/ab` are different directories that a naive
 * `child.startsWith(parent)` check would confuse. `path.relative` answers in
 * segments, so an escape is a leading `..` or an absolute result.
 */
function contains(parent: string, child: string): boolean {
  const relative = nodePath.relative(parent, child);
  if (relative === '') return true;
  return !relative.startsWith('..') && !nodePath.isAbsolute(relative);
}

/**
 * Establishes that `root` is a real directory that belongs to one of the
 * permitted fixture parents.
 *
 * `permittedParents` is the provenance argument: it is how a caller proves the
 * root it is about to read belongs to a directory the harness created, rather
 * than to a user's project. Both sides are resolved before comparison so a
 * symlinked `/tmp` (macOS) does not look like an escape.
 */
export function validateRoot(input: {
  root: string;
  permittedParents: readonly string[];
}): RootValidation {
  const parents = input.permittedParents;
  if (!Array.isArray(parents) || parents.length === 0) {
    return { ok: false, reason: 'no-permitted-parents', detail: 'a workspace root needs a permitted fixture parent' };
  }
  if (typeof input.root !== 'string' || !nodePath.isAbsolute(input.root)) {
    return { ok: false, reason: 'not-absolute', detail: 'the workspace root must be an absolute path' };
  }

  const resolvedParents: string[] = [];
  for (const parent of parents) {
    if (typeof parent !== 'string' || !nodePath.isAbsolute(parent)) {
      return { ok: false, reason: 'invalid-permitted-parent', detail: 'a permitted parent must be an absolute path' };
    }
    try {
      resolvedParents.push(fs.realpathSync(parent));
    } catch {
      // Deliberately no path in the message.
      return { ok: false, reason: 'invalid-permitted-parent', detail: 'a permitted parent could not be resolved' };
    }
  }

  let linkStats: fs.Stats;
  try {
    linkStats = fs.lstatSync(input.root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT'
      ? { ok: false, reason: 'missing', detail: 'the workspace root does not exist' }
      : { ok: false, reason: 'missing', detail: 'the workspace root could not be inspected' };
  }

  // The root itself may not be a symlink. Ancestors may be (and on macOS
  // normally are), which is why the comparison below resolves both sides.
  if (linkStats.isSymbolicLink()) {
    return { ok: false, reason: 'symlinked-root', detail: 'the workspace root is a symlink' };
  }
  if (!linkStats.isDirectory()) {
    return { ok: false, reason: 'not-a-directory', detail: 'the workspace root is not a directory' };
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = fs.realpathSync(input.root);
  } catch {
    return { ok: false, reason: 'missing', detail: 'the workspace root could not be resolved' };
  }

  if (!resolvedParents.some((parent) => contains(parent, canonicalRoot))) {
    return {
      ok: false,
      reason: 'outside-permitted-parents',
      detail: 'the workspace root is not inside a permitted fixture parent',
    };
  }

  try {
    const stats = fs.statSync(canonicalRoot);
    if (!stats.isDirectory()) {
      return { ok: false, reason: 'not-a-directory', detail: 'the resolved workspace root is not a directory' };
    }
    return { ok: true, canonicalRoot, identity: identityOf(stats) };
  } catch {
    return { ok: false, reason: 'missing', detail: 'the resolved workspace root could not be inspected' };
  }
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * Every failure the adapter reports, from a closed set.
 *
 * Nothing here is interpolated from an OS error message or a path: those carry
 * absolute paths, filenames and occasionally fragments of file contents.
 */
export type ReadFailureReason =
  | 'path-not-permitted'
  | 'not-listed'
  | 'root-replaced'
  | 'platform-unsupported'
  | 'symlink-not-permitted'
  | 'not-a-regular-file'
  | 'permission-denied'
  | 'file-too-large'
  | 'size-changed'
  | 'file-replaced'
  | 'file-changed'
  | 'too-many-open-files'
  | 'io-error';

function refuse(reason: ReadFailureReason): ReadOutcome {
  return { kind: 'unreadable', reason };
}

/**
 * Maps an errno code to a stable reason. The message is never read.
 *
 * `ENXIO` matters specifically: on a POSIX host, opening a socket or a
 * write-only FIFO with `O_NONBLOCK` fails this way instead of blocking.
 */
function classifyOpenError(error: unknown): ReadOutcome {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case 'ENOENT':
      return { kind: 'missing' };
    case 'ELOOP':
      return refuse('symlink-not-permitted');
    case 'EACCES':
    case 'EPERM':
      return refuse('permission-denied');
    case 'EISDIR':
    case 'ENXIO':
    case 'ENOTDIR':
      return refuse('not-a-regular-file');
    case 'EMFILE':
    case 'ENFILE':
      return refuse('too-many-open-files');
    case 'ENAMETOOLONG':
      return refuse('path-not-permitted');
    default:
      return refuse('io-error');
  }
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

export type NodeReaderOptions = {
  /** Absolute workspace root. Must resolve inside one of `permittedParents`. */
  root: string;
  /**
   * Absolute directories that may contain the root. This is the provenance
   * check: a test passes its own temp fixture parent, so pointing the reader at
   * a real project fails closed.
   */
  permittedParents: readonly string[];
  /**
   * May only tighten the approved per-file ceiling. A larger value is refused
   * rather than clamped, because silently ignoring a caller's request is its
   * own kind of lie.
   */
  maxFileBytes?: number;
};

export type NodeReaderResult =
  | { ok: true; reader: RepositoryReader; canonicalRoot: string }
  | { ok: false; reason: RootRejection; detail: string };

type ListedEntry = {
  kind: EntryKind;
  version?: FileVersion;
};

const READ_CHUNK_BYTES = 8 * 1024;

/**
 * Builds a reader bound to one validated root.
 *
 * Returns a failure rather than a half-working reader when the root cannot be
 * validated, so a caller cannot accidentally keep going without containment.
 */
export function createNodeRepositoryReader(options: NodeReaderOptions): NodeReaderResult {
  if (!READ_OPEN_FLAGS.supported) {
    return { ok: false, reason: 'platform-unsupported', detail: READ_OPEN_FLAGS.detail };
  }

  const maxFileBytes = options.maxFileBytes ?? DEFAULT_BUDGET.maxFileBytes;
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > DEFAULT_BUDGET.maxFileBytes) {
    return {
      ok: false,
      reason: 'platform-unsupported',
      detail: `maxFileBytes must be a whole number between 1 and ${DEFAULT_BUDGET.maxFileBytes}`,
    };
  }

  const validation = validateRoot({ root: options.root, permittedParents: options.permittedParents });
  if (!validation.ok) return { ok: false, reason: validation.reason, detail: validation.detail };

  const canonicalRoot = validation.canonicalRoot;
  const expectedRootIdentity = validation.identity;
  const rootIdentity = { dev: expectedRootIdentity.dev, ino: expectedRootIdentity.ino };

  /** Entries from the most recent root listing, so a read can check it is opening what was listed. */
  const listed = new Map<string, ListedEntry>();

  /**
   * Confirms the root is still the directory that was validated.
   *
   * This catches a root replaced wholesale — swapped for a symlink, or deleted
   * and recreated pointing elsewhere. It does not catch a parent directory being
   * swapped between this check and the following `open`; that window is
   * documented in `CONTAINMENT_LIMITS` and cannot be closed from Node.
   */
  function rootUnchanged(): boolean {
    let linkStats: fs.Stats;
    try {
      linkStats = fs.lstatSync(canonicalRoot);
    } catch {
      return false;
    }
    if (linkStats.isSymbolicLink() || !linkStats.isDirectory()) return false;
    if (!sameIdentity(identityOf(linkStats), rootIdentity)) return false;
    try {
      return fs.realpathSync(canonicalRoot) === canonicalRoot;
    } catch {
      return false;
    }
  }

  function listRoot(): readonly ReaderEntry[] {
    // A new listing attempt replaces the prior authorization, including when
    // this attempt fails before it can enumerate a single entry.
    listed.clear();
    if (!rootUnchanged()) {
      return [];
    }

    const entries: ReaderEntry[] = [];
    // Bound the enumeration itself: stop at cap + 1 so an enormous directory is
    // never materialised. The core turns "more than the cap" into a refusal.
    const cap = DEFAULT_BUDGET.maxDirectoryEntries + 1;
    let directory: fs.Dir | undefined;

    try {
      directory = fs.opendirSync(canonicalRoot);
      for (;;) {
        if (entries.length >= cap) break;
        const dirent = directory.readSync();
        if (dirent === null) break;

        const path = dirent.name;
        // Apply the Slice 1 path policy before candidate-specific metadata
        // access. Unknown and forbidden entries still count toward the bounded
        // scan and retain their names for collision handling, but are never
        // statted, resolved, or opened.
        const inspection = inspectCandidatePath(path);
        if (!inspection.ok) {
          entries.push({ path, kind: 'other' });
          continue;
        }

        if (dirent.isSymbolicLink()) {
          // Reported, never followed, and no target text is surfaced.
          entries.push({ path, kind: 'symlink' });
          listed.set(path, { kind: 'symlink' });
          continue;
        }
        if (dirent.isDirectory()) {
          entries.push({ path, kind: 'directory' });
          listed.set(path, { kind: 'directory' });
          continue;
        }
        if (!dirent.isFile()) {
          entries.push({ path, kind: 'other' });
          listed.set(path, { kind: 'other' });
          continue;
        }

        // Identity, size and change timestamps are captured here so the later
        // read can compare the opened descriptor with this listing snapshot.
        try {
          const stats = fs.lstatSync(nodePath.join(canonicalRoot, path), { bigint: true });
          if (!stats.isFile()) {
            entries.push({ path, kind: 'other' });
            listed.set(path, { kind: 'other' });
            continue;
          }
          entries.push({ path, kind: 'file', size: Number(stats.size) });
          listed.set(path, { kind: 'file', version: fileVersionOf(stats) });
        } catch {
          entries.push({ path, kind: 'other' });
          listed.set(path, { kind: 'other' });
        }
      }
    } catch {
      // An unlistable root reads as empty. Nothing about why is disclosed, and
      // the core then reports "nothing this policy reads" rather than a fact.
      listed.clear();
      return [];
    } finally {
      if (directory !== undefined) {
        try {
          directory.closeSync();
        } catch {
          // Already closed or unusable; nothing further to release.
        }
      }
    }

    // The core refuses a 101-entry listing. Do not leave the allowed entries
    // encountered before the overflow authorized for a later direct read.
    if (entries.length > DEFAULT_BUDGET.maxDirectoryEntries) listed.clear();

    return entries;
  }

  function readFile(relativePath: string): ReadOutcome {
    // Path policy first: pure, so a forbidden candidate never reaches the OS.
    const inspection = inspectCandidatePath(relativePath);
    if (!inspection.ok) return refuse('path-not-permitted');

    if (!rootUnchanged()) return refuse('root-replaced');

    const expectation = listed.get(inspection.path);
    // A read must follow a listing in this adapter instance. Without that there
    // is no captured identity to compare against, and "opened something I never
    // listed" is exactly the case that must not become evidence.
    if (expectation === undefined) return refuse('not-listed');
    // Reported precisely rather than lumped in with other non-regular kinds, so
    // a caller can tell "this was a link we refused" from "this was a device".
    if (expectation.kind === 'symlink') return refuse('symlink-not-permitted');
    if (expectation.kind !== 'file') return refuse('not-a-regular-file');

    const full = nodePath.join(canonicalRoot, inspection.path);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(full, READ_OPEN_FLAGS.flags);
    } catch (error) {
      return classifyOpenError(error);
    }

    try {
      let stats: fs.BigIntStats;
      try {
        stats = fs.fstatSync(descriptor, { bigint: true });
      } catch (error) {
        return classifyOpenError(error);
      }

      // Judge the descriptor, not the path: this is what makes a symlink
      // swapped in after the listing fail rather than be followed.
      if (!stats.isFile()) return refuse('not-a-regular-file');

      const openedVersion = fileVersionOf(stats);
      if (expectation.version !== undefined && !sameIdentity(openedVersion.identity, expectation.version.identity)) {
        return refuse('file-replaced');
      }
      if (stats.size > BigInt(maxFileBytes)) return refuse('file-too-large');
      if (expectation.version !== undefined && stats.size !== expectation.version.size) {
        return refuse('size-changed');
      }
      if (expectation.version !== undefined && !sameFileVersion(openedVersion, expectation.version)) {
        return refuse('file-changed');
      }

      // Read at most cap + 1 bytes, so an oversized file is detected without
      // reading all of it, and a file that grows mid-read cannot run away.
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxFileBytes + 1));
      const chunks: Buffer[] = [];
      let total = 0;

      for (;;) {
        const remaining = maxFileBytes + 1 - total;
        if (remaining <= 0) break;
        let read: number;
        try {
          read = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, remaining), null);
        } catch (error) {
          return classifyOpenError(error);
        }
        if (read === 0) break;
        chunks.push(Buffer.from(buffer.subarray(0, read)));
        total += read;
      }

      if (total > maxFileBytes) return refuse('file-too-large');

      // Any disagreement about how big the file is means the bytes we hold are
      // not the file that was measured. Refuse rather than present a partial
      // read as a complete source.
      if (BigInt(total) !== stats.size) return refuse('size-changed');
      let after: fs.BigIntStats;
      try {
        after = fs.fstatSync(descriptor, { bigint: true });
      } catch (error) {
        return classifyOpenError(error);
      }
      const afterVersion = fileVersionOf(after);
      if (!sameIdentity(afterVersion.identity, openedVersion.identity)) return refuse('file-replaced');
      if (afterVersion.size !== openedVersion.size) return refuse('size-changed');
      if (!sameFileVersion(afterVersion, openedVersion)
        || (expectation.version !== undefined && !sameFileVersion(afterVersion, expectation.version))) {
        return refuse('file-changed');
      }

      return { kind: 'ok', bytes: new Uint8Array(Buffer.concat(chunks, total)) };
    } finally {
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // Closing failed; the descriptor is gone with the process either way.
        }
      }
    }
  }

  const reader: RepositoryReader = {
    list(relativeDir: string): readonly ReaderEntry[] {
      // Root-only enumeration. A nested request yields nothing, so there is no
      // code path here that walks a tree.
      if (relativeDir !== '') {
        listed.clear();
        return [];
      }
      return listRoot();
    },
    read(relativePath: string): ReadOutcome {
      return readFile(relativePath);
    },
  };

  return { ok: true, reader, canonicalRoot };
}

/** The allowlisted names this adapter will ever read. Exported for tests and diagnostics. */
export const READABLE_NAMES: readonly string[] = CANDIDATE_POLICY.map((spec) => spec.name);
