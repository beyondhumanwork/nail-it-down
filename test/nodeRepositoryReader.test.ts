import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsDefault from 'node:fs';
import * as fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as net from 'node:net';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import {
  CONTAINMENT_LIMITS,
  READ_OPEN_FLAGS,
  READABLE_NAMES,
  createNodeRepositoryReader,
  validateRoot,
} from '../src/host/nodeRepositoryReader.ts';
import {
  DEFAULT_BUDGET,
  declaredDependencyEvidence,
  reverifyEvidence,
  selectCandidates,
} from '../src/core/discovery.ts';
import type { ConsentDecision, RepositoryReader } from '../src/core/discovery.ts';

/**
 * Every fixture this file creates lives under one `mkdtemp` directory and is
 * removed in `after`. Nothing outside the created roots is ever touched, and the
 * repository checkout is never used as a read fixture.
 */
const created: string[] = [];
const TMP_ROOT = fs.realpathSync(os.tmpdir());

after(() => {
  for (const root of created) {
    // Guard: only ever remove a directory this file made, under the temp root.
    if (!root.startsWith(`${TMP_ROOT}${nodePath.sep}`) || !nodePath.basename(root).startsWith('nid-m2s2-')) continue;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const CONSENT: ConsentDecision = { granted: true, obtainedBy: 'test fixture' };

function workspace(files: Record<string, string | Uint8Array> = {}): string {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'nid-m2s2-'));
  created.push(root);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(nodePath.join(root, name), content);
  }
  return root;
}

function readerFor(root: string, extra: { maxFileBytes?: number } = {}): RepositoryReader {
  const result = createNodeRepositoryReader({ root, permittedParents: [os.tmpdir()], ...extra });
  assert.equal(result.ok, true, result.ok ? '' : `${result.reason}: ${result.detail}`);
  if (!result.ok) throw new Error('unreachable');
  return result.reader;
}

function text(result: ReturnType<RepositoryReader['read']>): string {
  assert.equal(result.kind, 'ok', result.kind === 'unreadable' ? result.reason : result.kind);
  if (result.kind !== 'ok') throw new Error('unreachable');
  return Buffer.from(result.bytes).toString('utf8');
}

const PACKAGE_JSON = JSON.stringify({
  name: 'fixture',
  keywords: ['left'],
  dependencies: { left: '^1.0.0', right: '^2.0.0' },
}, null, 2);

// ---------------------------------------------------------------------------

describe('OS reader: root provenance', () => {
  it('accepts a root inside a permitted fixture parent and reads an allowlisted file', () => {
    const root = workspace({ 'README.md': '# hello\n' });
    const reader = readerFor(root);

    const entries = reader.list('');
    assert.deepEqual(entries.map((entry) => [entry.path, entry.kind]), [['README.md', 'file']]);
    assert.equal(text(reader.read('README.md')), '# hello\n');
  });

  it('refuses a root outside the permitted parents', () => {
    const root = workspace();
    const elsewhere = workspace();
    const result = createNodeRepositoryReader({ root, permittedParents: [elsewhere] });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'outside-permitted-parents');
  });

  it('refuses a sibling whose name merely starts with the permitted parent', () => {
    // The classic prefix bug: /tmp/x and /tmp/xy. Containment must be by segment.
    const base = workspace();
    const parent = nodePath.join(base, 'a');
    const sibling = nodePath.join(base, 'ab');
    fs.mkdirSync(parent);
    fs.mkdirSync(sibling);

    const result = createNodeRepositoryReader({ root: sibling, permittedParents: [parent] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'outside-permitted-parents');
  });

  it('refuses a symlinked root, even when it points at a permitted directory', () => {
    const real = workspace({ 'README.md': '# hi' });
    const link = nodePath.join(workspace(), 'link');
    fs.symlinkSync(real, link, 'dir');

    const validation = validateRoot({ root: link, permittedParents: [os.tmpdir()] });
    assert.equal(validation.ok, false);
    if (validation.ok) return;
    assert.equal(validation.reason, 'symlinked-root');
  });

  it('refuses a missing root, a file root, and an empty permitted list', () => {
    const root = workspace();
    const missing = validateRoot({ root: nodePath.join(root, 'nope'), permittedParents: [os.tmpdir()] });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, 'missing');

    const file = nodePath.join(root, 'README.md');
    fs.writeFileSync(file, 'x');
    const notDir = validateRoot({ root: file, permittedParents: [os.tmpdir()] });
    assert.equal(notDir.ok, false);
    if (!notDir.ok) assert.equal(notDir.reason, 'not-a-directory');

    const noParents = validateRoot({ root, permittedParents: [] });
    assert.equal(noParents.ok, false);
    if (!noParents.ok) assert.equal(noParents.reason, 'no-permitted-parents');
  });

  it('detects the root being replaced after validation', () => {
    const root = workspace({ 'README.md': '# hi' });
    const reader = readerFor(root);
    reader.list('');

    // Replace the whole root with a different directory.
    const moved = `${root}-moved`;
    created.push(moved);
    fs.renameSync(root, moved);
    fs.mkdirSync(root);
    fs.writeFileSync(nodePath.join(root, 'README.md'), '# impostor');

    const result = reader.read('README.md');
    assert.equal(result.kind, 'unreadable');
    if (result.kind === 'unreadable') assert.equal(result.reason, 'root-replaced');
  });
});

describe('OS reader: path policy before OS access', () => {
  const forbidden = [
    ['absolute', '/etc/passwd'],
    ['traversal', '../../etc/passwd'],
    ['dotfile', '.env'],
    ['nested', 'docs/README.md'],
    ['backslash', 'sub\\README.md'],
    ['encoded', '%2e%2e%2fREADME.md'],
    ['non-allowlisted', 'index.html'],
    ['lockfile', 'package-lock.json'],
  ] as const;

  for (const [label, path] of forbidden) {
    it(`refuses ${label} without touching the filesystem`, () => {
      const root = workspace({ 'README.md': '# hi' });
      const reader = readerFor(root);
      reader.list('');

      const result = reader.read(path);
      assert.equal(result.kind, 'unreadable');
      if (result.kind !== 'unreadable') return;
      // `path-not-permitted` proves the policy ran first: an allowlisted-looking
      // but absent name would have produced `not-listed` or `missing` instead.
      assert.equal(result.reason, 'path-not-permitted');
    });
  }

  it('refuses a read for a file that was never listed', () => {
    const root = workspace({ 'package.json': PACKAGE_JSON });
    const reader = readerFor(root);
    // Deliberately no list() first.
    const result = reader.read('package.json');
    assert.equal(result.kind, 'unreadable');
    if (result.kind === 'unreadable') assert.equal(result.reason, 'not-listed');
  });

  it('only exposes the fixed allowlist', () => {
    assert.deepEqual(READABLE_NAMES, [
      'README.md', 'AGENTS.md', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'tsconfig.json',
    ]);
  });

  it('does not stat or open forbidden and unknown directory entries', () => {
    const root = workspace({
      'README.md': '# safe',
      '.env': 'synthetic-secret',
      'credentials.json': '{"token":"synthetic-secret"}',
      'private.pem': 'synthetic-secret',
      'unknown-note.txt': 'synthetic-secret',
    });
    const reader = readerFor(root);
    const candidatePaths = new Set([
      '.env', 'credentials.json', 'private.pem', 'unknown-note.txt',
    ].map((name) => nodePath.join(fs.realpathSync(root), name)));
    const touched: string[] = [];
    const originalLstat = fsDefault.lstatSync;
    const originalStat = fsDefault.statSync;
    const originalRealpath = fsDefault.realpathSync;
    const originalAccess = fsDefault.accessSync;
    const originalOpen = fsDefault.openSync;
    const originalReadFile = fsDefault.readFileSync;
    const originalRead = fsDefault.readSync;
    const candidateDescriptors = new Set<number>();
    // The ESM default export types its members as read-only; patch through a
    // view that mirrors the same signatures so the swap is type-checkable.
    const patchable = fsDefault as unknown as {
      lstatSync: typeof fsDefault.lstatSync;
      statSync: typeof fsDefault.statSync;
      realpathSync: typeof fsDefault.realpathSync;
      accessSync: typeof fsDefault.accessSync;
      openSync: typeof fsDefault.openSync;
      readFileSync: typeof fsDefault.readFileSync;
      readSync: typeof fsDefault.readSync;
    };

    try {
      patchable.lstatSync = ((path: fs.PathLike, ...args: unknown[]) => {
        if (candidatePaths.has(String(path))) touched.push(String(path));
        return (originalLstat as (...values: unknown[]) => unknown)(path, ...args);
      }) as typeof fsDefault.lstatSync;
      patchable.statSync = ((path: fs.PathLike, ...args: unknown[]) => {
        if (candidatePaths.has(String(path))) touched.push(String(path));
        return (originalStat as (...values: unknown[]) => unknown)(path, ...args);
      }) as typeof fsDefault.statSync;
      patchable.realpathSync = ((path: fs.PathLike, ...args: unknown[]) => {
        if (candidatePaths.has(String(path))) touched.push(String(path));
        return (originalRealpath as (...values: unknown[]) => unknown)(path, ...args);
      }) as typeof fsDefault.realpathSync;
      patchable.accessSync = ((path: fs.PathLike, ...args: unknown[]) => {
        if (candidatePaths.has(String(path))) touched.push(String(path));
        return (originalAccess as (...values: unknown[]) => unknown)(path, ...args);
      }) as typeof fsDefault.accessSync;
      patchable.openSync = ((path: fs.PathLike, ...args: unknown[]) => {
        const descriptor = (originalOpen as (...values: unknown[]) => number)(path, ...args);
        if (candidatePaths.has(String(path))) {
          touched.push(String(path));
          candidateDescriptors.add(descriptor);
        }
        return descriptor;
      }) as typeof fsDefault.openSync;
      patchable.readFileSync = ((path: fs.PathLike, ...args: unknown[]) => {
        if (candidatePaths.has(String(path))) touched.push(String(path));
        return (originalReadFile as (...values: unknown[]) => unknown)(path, ...args);
      }) as typeof fsDefault.readFileSync;
      patchable.readSync = ((descriptor: number, ...args: unknown[]) => {
        if (candidateDescriptors.has(descriptor)) touched.push(`fd:${descriptor}`);
        return (originalRead as (...values: unknown[]) => number)(descriptor, ...args);
      }) as typeof fsDefault.readSync;
      syncBuiltinESMExports();

      const entries = reader.list('');
      assert.ok(entries.length > 0);
      assert.deepEqual(touched, []);
      const selection = selectCandidates({ reader, consent: CONSENT });
      assert.equal(selection.kind, 'selected');
      assert.deepEqual(touched, []);
    } finally {
      patchable.lstatSync = originalLstat;
      patchable.statSync = originalStat;
      fsDefault.realpathSync = originalRealpath;
      fsDefault.accessSync = originalAccess;
      fsDefault.openSync = originalOpen;
      fsDefault.readFileSync = originalReadFile;
      fsDefault.readSync = originalRead;
      syncBuiltinESMExports();
    }
  });

  it('does not enumerate nested directories', () => {
    const root = workspace({ 'README.md': '# hi' });
    fs.mkdirSync(nodePath.join(root, 'src'));
    fs.writeFileSync(nodePath.join(root, 'src', 'app.ts'), 'secret');
    const reader = readerFor(root);

    assert.deepEqual(reader.list('src'), [], 'a nested listing must yield nothing');
    const entries = reader.list('');
    assert.equal(entries.some((entry) => entry.path === 'app.ts'), false);
  });
});

describe('OS reader: symlinks', () => {
  it('reports a symlink rather than following it, inside or outside the workspace', () => {
    const outside = workspace({ 'target.md': 'outside content' });
    const root = workspace({ 'README.md': '# real' });
    fs.symlinkSync(nodePath.join(outside, 'target.md'), nodePath.join(root, 'AGENTS.md'));
    fs.symlinkSync(nodePath.join(root, 'README.md'), nodePath.join(root, 'package.json'));

    const reader = readerFor(root);
    const entries = reader.list('');
    const agents = entries.find((entry) => entry.path === 'AGENTS.md');
    assert.equal(agents?.kind, 'symlink');
    // No target text is surfaced.
    assert.equal(agents?.target, undefined);

    const viaSymlink = reader.read('AGENTS.md');
    assert.equal(viaSymlink.kind, 'unreadable');
    if (viaSymlink.kind === 'unreadable') assert.equal(viaSymlink.reason, 'symlink-not-permitted');
  });

  it('refuses a dangling and a cyclic symlink', () => {
    const root = workspace();
    fs.symlinkSync(nodePath.join(root, 'nope.md'), nodePath.join(root, 'README.md'));
    fs.symlinkSync(nodePath.join(root, 'package.json'), nodePath.join(root, 'AGENTS.md'));
    fs.symlinkSync(nodePath.join(root, 'AGENTS.md'), nodePath.join(root, 'package.json'));

    const reader = readerFor(root);
    const kinds = reader.list('').map((entry) => entry.kind);
    assert.deepEqual(kinds.every((kind) => kind === 'symlink'), true);
    for (const name of ['README.md', 'AGENTS.md', 'package.json']) {
      const result = reader.read(name);
      assert.equal(result.kind, 'unreadable');
      if (result.kind === 'unreadable') assert.equal(result.reason, 'symlink-not-permitted');
    }
  });

  it('refuses a symlink swapped in after the listing', () => {
    const outside = workspace({ 'secret.md': 'PRIVATE CONTENT' });
    const root = workspace({ 'README.md': '# original' });
    const reader = readerFor(root);
    reader.list('');

    // The listing said `file`. Now it is a symlink to somewhere else.
    fs.rmSync(nodePath.join(root, 'README.md'));
    fs.symlinkSync(nodePath.join(outside, 'secret.md'), nodePath.join(root, 'README.md'));

    const result = reader.read('README.md');
    assert.equal(result.kind, 'unreadable');
    if (result.kind === 'unreadable') {
      assert.equal(result.reason, 'symlink-not-permitted', 'O_NOFOLLOW must stop the swap');
    }
  });
});

describe('OS reader: non-regular files', () => {
  it('refuses a directory that is named like an allowed file', () => {
    const root = workspace();
    fs.mkdirSync(nodePath.join(root, 'README.md'));
    const reader = readerFor(root);

    const entry = reader.list('').find((candidate) => candidate.path === 'README.md');
    assert.equal(entry?.kind, 'directory');
    const result = reader.read('README.md');
    assert.equal(result.kind, 'unreadable');
    if (result.kind === 'unreadable') assert.equal(result.reason, 'not-a-regular-file');
  });

  it('refuses a socket swapped in after the listing, without blocking', async () => {
    const root = workspace({ 'README.md': '# original' });
    const socketPath = nodePath.join(root, 'README.md');
    const reader = readerFor(root);
    reader.list('');

    fs.rmSync(socketPath);
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });

    try {
      const result = reader.read('README.md');
      assert.equal(result.kind, 'unreadable');
      if (result.kind !== 'unreadable') return;
      // ENXIO (or the fstat backstop) — either way a stable code, never a hang.
      assert.ok(['not-a-regular-file', 'io-error'].includes(result.reason), result.reason);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('declares O_NOFOLLOW and O_NONBLOCK in the open flags', () => {
    assert.equal(READ_OPEN_FLAGS.supported, true, READ_OPEN_FLAGS.detail);
    assert.notEqual(READ_OPEN_FLAGS.flags & fs.constants.O_NOFOLLOW, 0, 'O_NOFOLLOW must be set');
    assert.notEqual(READ_OPEN_FLAGS.flags & fs.constants.O_NONBLOCK, 0, 'O_NONBLOCK must be set');
  });

  it('opening a FIFO with these flags does not block (probed in a child process)', (t) => {
    // A synchronous blocking open would hang this test process with no timeout
    // able to interrupt it, so the probe runs in a child with a hard timeout.
    // Ask `mkfifo` to make the file directly: `--version` is GNU-only and would
    // wrongly report the tool missing on BSD/macOS.
    const root = workspace();
    const fifoPath = nodePath.join(root, 'README.md');
    try {
      execFileSync('mkfifo', [fifoPath], { stdio: 'ignore' });
    } catch {
      t.diagnostic('mkfifo unavailable: real FIFO open NOT VERIFIED');
      return;
    }

    const probe = [
      "const fs = require('node:fs');",
      `const flags = ${READ_OPEN_FLAGS.flags};`,
      `const path = ${JSON.stringify(fifoPath)};`,
      'const fd = fs.openSync(path, flags);',
      'try {',
      '  const stats = fs.fstatSync(fd);',
      '  process.stdout.write(String(stats.isFIFO()));',
      '} finally { fs.closeSync(fd); }',
    ].join('\n');

    const output = execFileSync(process.execPath, ['-e', probe], { timeout: 15000, encoding: 'utf8' });
    assert.equal(output, 'true', 'the opened descriptor must report a FIFO');
  });
});

describe('OS reader: budgets on actual bytes', () => {
  it('accepts a file at and below the per-file ceiling, and refuses above it', () => {
    const atLimit = workspace({ 'README.md': 'x'.repeat(DEFAULT_BUDGET.maxFileBytes) });
    const under = workspace({ 'README.md': 'x'.repeat(DEFAULT_BUDGET.maxFileBytes - 1) });
    const over = workspace({ 'README.md': 'x'.repeat(DEFAULT_BUDGET.maxFileBytes + 1) });

    for (const root of [atLimit, under]) {
      const reader = readerFor(root);
      reader.list('');
      const result = reader.read('README.md');
      assert.equal(result.kind, 'ok', root);
    }

    const reader = readerFor(over);
    reader.list('');
    const result = reader.read('README.md');
    assert.equal(result.kind, 'unreadable');
    if (result.kind === 'unreadable') assert.equal(result.reason, 'file-too-large');
  });

  it('refuses a file that grew after the listing', () => {
    const root = workspace({ 'README.md': '# small' });
    const reader = readerFor(root);
    reader.list('');
    fs.appendFileSync(nodePath.join(root, 'README.md'), 'x'.repeat(100));

    const result = reader.read('README.md');
    assert.equal(result.kind, 'unreadable');
    if (result.kind === 'unreadable') assert.equal(result.reason, 'size-changed');
  });

  it('refuses a file that shrank after the listing', () => {
    const root = workspace({ 'README.md': '# a longer original body' });
    const reader = readerFor(root);
    reader.list('');
    fs.writeFileSync(nodePath.join(root, 'README.md'), '#');

    const result = reader.read('README.md');
    assert.equal(result.kind, 'unreadable');
    if (result.kind === 'unreadable') assert.equal(result.reason, 'size-changed');
  });

  it('refuses a file replaced by a different inode of the same size', () => {
    const root = workspace({ 'README.md': '# original' });
    const reader = readerFor(root);
    reader.list('');
    // Same length, different file: only identity can catch this.
    fs.rmSync(nodePath.join(root, 'README.md'));
    fs.writeFileSync(nodePath.join(root, 'README.md'), '# replaced');

    const result = reader.read('README.md');
    assert.equal(result.kind, 'unreadable');
    if (result.kind === 'unreadable') {
      assert.ok(['file-replaced', 'size-changed'].includes(result.reason), result.reason);
    }
  });

  it('refuses a same-inode, same-length rewrite after listing', () => {
    const root = workspace({ 'README.md': '# original' });
    const reader = readerFor(root);
    const path = nodePath.join(root, 'README.md');
    const before = fs.statSync(path, { bigint: true });
    reader.list('');
    fs.writeFileSync(path, '# replaced');
    const after = fs.statSync(path, { bigint: true });
    assert.equal(after.ino, before.ino, 'fixture must rewrite the same inode');
    assert.equal(after.size, before.size, 'fixture must retain the same byte length');
    assert.ok(after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs,
      'filesystem must expose a change timestamp for the deterministic rewrite');

    const result = reader.read('README.md');
    assert.equal(result.kind, 'unreadable');
    if (result.kind === 'unreadable') assert.equal(result.reason, 'file-changed');
  });

  it('bounds directory enumeration at the cap and reports 100 versus 101', () => {
    const hundred = workspace({ 'README.md': '# hi' });
    for (let index = 0; index < 99; index += 1) {
      fs.writeFileSync(nodePath.join(hundred, `extra-${index}.txt`), 'x');
    }
    const atCap = readerFor(hundred).list('');
    assert.equal(atCap.length, 100);

    const overCap = workspace({ 'README.md': '# hi' });
    for (let index = 0; index < 100; index += 1) {
      fs.writeFileSync(nodePath.join(overCap, `extra-${index}.txt`), 'x');
    }
    const over = readerFor(overCap).list('');
    // Stops at cap + 1 rather than materialising the whole directory.
    assert.equal(over.length, DEFAULT_BUDGET.maxDirectoryEntries + 1);

    // And the core turns that into a refusal.
    const refused = selectCandidates({ reader: readerFor(overCap), consent: CONSENT });
    assert.equal(refused.kind, 'refused');
    if (refused.kind === 'refused') assert.equal(refused.refusal.reason, 'too-many-directory-entries');
  });

  it('invalidates prior listing authorization after an over-limit relist', () => {
    const root = workspace({ 'README.md': '# hi' });
    const reader = readerFor(root);
    reader.list('');
    for (let index = 0; index < DEFAULT_BUDGET.maxDirectoryEntries; index += 1) {
      fs.writeFileSync(nodePath.join(root, `overflow-${index}.txt`), 'x');
    }

    assert.equal(reader.list('').length, DEFAULT_BUDGET.maxDirectoryEntries + 1);
    const result = reader.read('README.md');
    assert.equal(result.kind, 'unreadable');
    if (result.kind === 'unreadable') assert.equal(result.reason, 'not-listed');
  });

  it('invalidates prior authorization when a later enumeration fails', (t) => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      t.diagnostic('running as root: unreadable-directory case NOT VERIFIED');
      return;
    }
    const root = workspace({ 'README.md': '# hi' });
    const reader = readerFor(root);
    // A good listing first, so there is authorization to invalidate.
    assert.equal(reader.list('').some((entry) => entry.path === 'README.md'), true);

    // 0o000 on the directory makes opendir fail for a non-root process.
    fs.chmodSync(root, 0o000);
    try {
      assert.deepEqual(reader.list(''), [], 'a failed enumeration yields nothing');
      const blocked = reader.read('README.md');
      assert.equal(blocked.kind, 'unreadable');
      if (blocked.kind === 'unreadable') assert.equal(blocked.reason, 'not-listed');
    } finally {
      fs.chmodSync(root, 0o755);
    }

    // With access restored, only a fresh listing re-authorizes the read.
    assert.equal(reader.list('').some((entry) => entry.path === 'README.md'), true);
    assert.equal(reader.read('README.md').kind, 'ok');
  });

  it('invalidates removed-file authorization after a successful relist', () => {
    const root = workspace({ 'README.md': '# hi' });
    const reader = readerFor(root);
    assert.equal(reader.list('').some((entry) => entry.path === 'README.md'), true);
    fs.rmSync(nodePath.join(root, 'README.md'));

    assert.equal(reader.list('').some((entry) => entry.path === 'README.md'), false);
    const result = reader.read('README.md');
    assert.equal(result.kind, 'unreadable');
    if (result.kind === 'unreadable') assert.equal(result.reason, 'not-listed');
  });
});

describe('OS reader: errors are classified, never echoed', () => {
  it('reports a vanished file as missing', () => {
    const root = workspace({ 'README.md': '# hi' });
    const reader = readerFor(root);
    reader.list('');
    fs.rmSync(nodePath.join(root, 'README.md'));

    const result = reader.read('README.md');
    assert.equal(result.kind, 'missing');
  });

  it('classifies permission denied without disclosing the path', (t) => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      t.diagnostic('running as root: permission-denied case NOT VERIFIED');
      return;
    }
    const root = workspace({ 'README.md': '# hi' });
    const reader = readerFor(root);
    reader.list('');
    fs.chmodSync(nodePath.join(root, 'README.md'), 0o000);

    try {
      const result = reader.read('README.md');
      assert.equal(result.kind, 'unreadable');
      if (result.kind !== 'unreadable') return;
      assert.equal(result.reason, 'permission-denied');
      // `reason` is a closed code; it can never contain a path or OS text.
      assert.doesNotMatch(result.reason, /\//);
    } finally {
      fs.chmodSync(nodePath.join(root, 'README.md'), 0o600);
    }
  });

  it('reports only reasons from a closed set', () => {
    const allowed = new Set([
      'path-not-permitted', 'not-listed', 'root-replaced', 'platform-unsupported',
      'symlink-not-permitted', 'not-a-regular-file', 'permission-denied', 'file-too-large',
      'size-changed', 'file-replaced', 'file-changed', 'too-many-open-files', 'io-error',
    ]);
    const root = workspace({ 'README.md': '# hi' });
    const reader = readerFor(root);
    reader.list('');
    for (const name of ['README.md', 'AGENTS.md', '.env', '/etc/passwd']) {
      const result = reader.read(name);
      if (result.kind === 'unreadable') assert.ok(allowed.has(result.reason), result.reason);
    }
  });
});

describe('OS reader: integration with the Slice 1 policy', () => {
  it('feeds real bytes to selectCandidates without a second policy engine', () => {
    const root = workspace({ 'README.md': '# hi', 'package.json': PACKAGE_JSON, '.env': 'SECRET=1' });
    const result = selectCandidates({ reader: readerFor(root), consent: CONSENT });

    assert.equal(result.kind, 'selected');
    if (result.kind !== 'selected') return;
    assert.deepEqual(result.files.map((file) => file.path), ['README.md', 'package.json']);
    // `.env` is never even opened, so it cannot appear as rejected-with-content.
    assert.equal(result.files.some((file) => file.path === '.env'), false);
  });

  it('attributes a dependency fact to the real file and line', () => {
    const root = workspace({ 'package.json': PACKAGE_JSON });
    const result = declaredDependencyEvidence({
      reader: readerFor(root),
      consent: CONSENT,
      dependency: 'left',
    });

    assert.equal(result.kind, 'evidence');
    if (result.kind !== 'evidence') return;
    assert.equal(result.evidence.source.path, 'package.json');
    const cited = PACKAGE_JSON.split('\n')[result.evidence.source.lineStart - 1];
    assert.match(cited, /"left":/);
    assert.equal(result.evidence.provenance, 'verified');
  });

  it('re-verifies through the OS reader and goes stale when the declaration moves', () => {
    const root = workspace({ 'package.json': PACKAGE_JSON });
    const capture = declaredDependencyEvidence({ reader: readerFor(root), consent: CONSENT, dependency: 'left' });
    assert.equal(capture.kind, 'evidence');
    if (capture.kind !== 'evidence') return;

    const same = reverifyEvidence({ reader: readerFor(root), consent: CONSENT, evidence: capture.evidence });
    assert.equal(same.kind, 'reverified');
    if (same.kind === 'reverified') assert.equal(same.evidence.provenance, 'verified');

    const moved = JSON.stringify({ name: 'x', dependencies: { left: '^1.0.0' } }, null, 2);
    fs.writeFileSync(nodePath.join(root, 'package.json'), moved);
    const after = reverifyEvidence({ reader: readerFor(root), consent: CONSENT, evidence: capture.evidence });
    assert.equal(after.kind, 'reverified');
    if (after.kind === 'reverified') assert.equal(after.evidence.provenance, 'stale');
  });

  it('refuses a forged citation pointing outside the workspace without reading it', () => {
    const root = workspace({ 'package.json': PACKAGE_JSON });
    const capture = declaredDependencyEvidence({ reader: readerFor(root), consent: CONSENT, dependency: 'left' });
    if (capture.kind !== 'evidence') throw new Error('fixture should produce evidence');

    const forged = { ...capture.evidence, source: { ...capture.evidence.source, path: '.env' } };
    const result = reverifyEvidence({ reader: readerFor(root), consent: CONSENT, evidence: forged });
    assert.equal(result.kind, 'not-verifiable');
  });

  it('rejects binary and invalid UTF-8 through the real reader', () => {
    const binary = workspace({ 'README.md': new Uint8Array([0x00, 0xff, 0xfe, 0x00]) });
    const invalid = workspace({ 'README.md': new Uint8Array([0x68, 0x69, 0xc3, 0x28]) });
    for (const root of [binary, invalid]) {
      const result = selectCandidates({ reader: readerFor(root), consent: CONSENT });
      assert.equal(result.kind, 'selected');
      if (result.kind !== 'selected') continue;
      assert.equal(result.files.length, 0);
      assert.equal(result.rejected[0]?.reason, 'invalid-encoding');
    }
  });

  it('refuses a fake credential found in a real allowlisted file', () => {
    const fakeKey = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
    const root = workspace({ 'README.md': `token ${fakeKey}\n`, 'package.json': PACKAGE_JSON });
    const result = selectCandidates({ reader: readerFor(root), consent: CONSENT });

    assert.equal(result.kind, 'selected');
    if (result.kind !== 'selected') return;
    assert.equal(result.files.some((file) => file.path === 'README.md'), false);
    const rejection = result.rejected.find((entry) => entry.path === 'README.md');
    assert.equal(rejection?.reason, 'secret-like-content');
    assert.doesNotMatch(JSON.stringify(result.rejected), /AKIA/);
  });

  it('honours tighter caller budgets against real files', () => {
    const root = workspace({
      'README.md': 'a'.repeat(600),
      'package.json': PACKAGE_JSON,
      'go.mod': Array.from({ length: DEFAULT_BUDGET.maxFileLines + 1 }, () => 'line').join('\n'),
    });

    const total = selectCandidates({ reader: readerFor(root), consent: CONSENT, budget: { maxTotalBytes: 601 } });
    assert.equal(total.kind, 'selected');
    if (total.kind === 'selected') {
      assert.deepEqual(total.files.map((file) => file.path), ['README.md']);
      assert.ok(total.rejected.some((entry) => entry.reason === 'total-too-large'));
    }

    const lines = selectCandidates({ reader: readerFor(root), consent: CONSENT });
    assert.equal(lines.kind, 'selected');
    if (lines.kind === 'selected') {
      assert.ok(lines.rejected.some((entry) => entry.reason === 'too-many-lines'));
    }
  });
});

describe('OS reader: containment limits are stated, not assumed', () => {
  it('records what is and is not proven', () => {
    assert.equal(CONTAINMENT_LIMITS.resolvesSymlinkedAncestors, true);
    assert.equal(CONTAINMENT_LIMITS.rejectsSymlinkedRoot, true);
    assert.equal(CONTAINMENT_LIMITS.verifiesOpenedDescriptor, true);
    // These two are the honest gaps. Flipping either to true without new
    // evidence would be claiming a guarantee this slice does not have.
    assert.equal(CONTAINMENT_LIMITS.parentSwapRaceProven, false);
    assert.equal(CONTAINMENT_LIMITS.caseFoldingVerified, false);
  });
});
