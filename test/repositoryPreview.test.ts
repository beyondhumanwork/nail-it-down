import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fsDefault from 'node:fs';
import * as fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import {
  IDEA_ONLY_NOTE,
  MAX_DECLARATIONS,
  renderPreview,
  reverifyPreviewEvidence,
  runRepositoryPreview,
  snapshotReader,
} from '../src/host/repositoryPreview.ts';
import { CONSENT_LABELS } from '../src/host/repositoryConsent.ts';
import { DEFAULT_BUDGET, declaredDependencyEvidence, selectCandidates } from '../src/core/discovery.ts';
import type { ConsentDecision, RepositoryReader } from '../src/core/discovery.ts';
import { createNodeRepositoryReader } from '../src/host/nodeRepositoryReader.ts';
import type { ModUi } from '../src/host/modApi.ts';
import previewMod from './previewMod.ts';

/** Every fixture lives under one `mkdtemp` parent and is removed in `after`. */
const created: string[] = [];
const TMP_ROOT = fs.realpathSync(os.tmpdir());

after(() => {
  for (const dir of created) {
    if (!dir.startsWith(`${TMP_ROOT}${nodePath.sep}`) || !nodePath.basename(dir).startsWith('nid-preview-')) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const GRANTED: ConsentDecision = { granted: true, obtainedBy: 'test' };

const PACKAGE_JSON = JSON.stringify({
  name: 'synthetic-tenant-reminders',
  private: true,
  dependencies: { 'left-pad': '^1.3.0' },
  devDependencies: { 'tiny-invariant': '^1.3.1' },
}, null, 2);

function project(files: Record<string, string | Uint8Array> = { 'README.md': '# hi', 'package.json': PACKAGE_JSON }): {
  parent: string;
  root: string;
} {
  const parent = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'nid-preview-'));
  created.push(parent);
  const root = nodePath.join(parent, 'project');
  fs.mkdirSync(root);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(nodePath.join(root, name), content);
  }
  return { parent, root };
}

/** A UI stub that answers one dialog with `answer`. */
function ui(answer: string | undefined, options: { surface?: boolean; throws?: boolean } = {}): ModUi {
  return {
    select: async () => {
      if (options.throws === true) throw new Error('dialog exploded at /home/ahmed/private');
      return answer;
    },
    capabilities: { status: options.surface ?? true, surface: options.surface ?? true },
  };
}

/**
 * Counts filesystem calls made against `root` while `run` executes.
 *
 * The preview constructs its own reader, so the only way to observe that a
 * refusal caused no read is to watch the filesystem itself.
 */
async function countFsTouches(root: string, run: () => Promise<unknown>): Promise<string[]> {
  const touched: string[] = [];
  const canonical = fs.realpathSync(root);
  // The root itself counts: listing it is filesystem work. An earlier version
  // only matched paths *inside* the root, so a listing went uncounted.
  const record = (target: unknown): void => {
    const text = String(target);
    if (text === canonical || text.startsWith(`${canonical}${nodePath.sep}`)) {
      touched.push(text.slice(canonical.length) || '.');
    }
  };

  const patchable = fsDefault as unknown as {
    openSync: typeof fsDefault.openSync;
    opendirSync: typeof fsDefault.opendirSync;
    lstatSync: typeof fsDefault.lstatSync;
    statSync: typeof fsDefault.statSync;
  };
  const original = {
    openSync: fsDefault.openSync,
    opendirSync: fsDefault.opendirSync,
    lstatSync: fsDefault.lstatSync,
    statSync: fsDefault.statSync,
  };

  try {
    patchable.openSync = ((target: fs.PathLike, ...args: unknown[]) => {
      record(target);
      return (original.openSync as (...values: unknown[]) => number)(target, ...args);
    }) as typeof fsDefault.openSync;
    patchable.opendirSync = ((target: fs.PathLike, ...args: unknown[]) => {
      record(target);
      return (original.opendirSync as (...values: unknown[]) => unknown)(target, ...args);
    }) as typeof fsDefault.opendirSync;
    patchable.lstatSync = ((target: fs.PathLike, ...args: unknown[]) => {
      record(target);
      return (original.lstatSync as (...values: unknown[]) => unknown)(target, ...args);
    }) as typeof fsDefault.lstatSync;
    patchable.statSync = ((target: fs.PathLike, ...args: unknown[]) => {
      record(target);
      return (original.statSync as (...values: unknown[]) => unknown)(target, ...args);
    }) as typeof fsDefault.statSync;
    syncBuiltinESMExports();

    await run();
  } finally {
    patchable.openSync = original.openSync;
    patchable.opendirSync = original.opendirSync;
    patchable.lstatSync = original.lstatSync;
    patchable.statSync = original.statSync;
    syncBuiltinESMExports();
  }

  return touched;
}

// ---------------------------------------------------------------------------

describe('preview: consent gates every read', () => {
  const refusals: Array<[string, string | undefined, string, { surface?: boolean; throws?: boolean }?]> = [
    ['the refusal label', CONSENT_LABELS.refuse, 'refused-by-choice'],
    ['a dismissal', undefined, 'dismissed'],
    ['an unexpected answer', 'Sure, go ahead', 'unexpected-value'],
    ['a headless host', CONSENT_LABELS.grant, 'headless', { surface: false }],
    ['a throwing dialog', CONSENT_LABELS.grant, 'ui-failure', { throws: true }],
  ];

  for (const [label, answer, reason, options] of refusals) {
    it(`refuses on ${label} and reads nothing`, async () => {
      const { parent, root } = project();
      const touched = await countFsTouches(root, () =>
        runRepositoryPreview({ ui: ui(answer, options), root, permittedParent: parent }));

      assert.deepEqual(touched, [], 'a refusal must not touch the fixture at all');

      const result = await runRepositoryPreview({ ui: ui(answer, options), root, permittedParent: parent });
      assert.equal(result.kind, 'refused');
      if (result.kind !== 'refused') return;
      assert.equal(result.reason, reason);
      assert.equal(result.note, IDEA_ONLY_NOTE);
    });
  }

  it('says plainly that idea-only continuation is normal', async () => {
    const { parent, root } = project();
    const result = await runRepositoryPreview({ ui: ui(undefined), root, permittedParent: parent });
    const text = renderPreview(result);

    assert.match(text, /not started/);
    assert.match(text, /works without repository context/);
    // No citation, no file list, no path from the fixture.
    assert.doesNotMatch(text, /package\.json/);
    assert.doesNotMatch(text, /left-pad/);
  });

  it('reads and cites on the exact grant label', async () => {
    const { parent, root } = project();
    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });

    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    assert.deepEqual(result.files.map((file) => file.path), ['README.md', 'package.json']);
    assert.ok(result.declarations.length > 0);
  });
});

describe('preview: citations are real and attributable', () => {
  it('cites the declaration that is actually in the manifest', async () => {
    const { parent, root } = project();
    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });
    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;

    const lines = PACKAGE_JSON.split('\n');
    for (const declaration of result.declarations) {
      assert.equal(declaration.path, 'package.json');
      assert.equal(declaration.provenance, 'verified');
      const cited = lines[declaration.lineStart - 1];
      // The cited line really contains the declaration it is cited for.
      assert.match(cited, /":\s*"/);
      assert.match(declaration.claim, /^package\.json lists "[^"]+" under "(dependencies|devDependencies|peerDependencies|optionalDependencies)"$/);
      assert.ok(declaration.excerpt.length <= 161);
    }
  });

  it('caps how many declarations it will show', async () => {
    const many = JSON.stringify({
      name: 'x',
      dependencies: { alpha: '1.0.0', beta: '1.0.0', gamma: '1.0.0', delta: '1.0.0' },
    }, null, 2);
    const { parent, root } = project({ 'package.json': many });
    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });

    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    assert.equal(result.declarations.length, MAX_DECLARATIONS);
  });

  it('claims nothing when there is no manifest', async () => {
    const { parent, root } = project({ 'README.md': '# only docs here' });
    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });

    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    assert.deepEqual(result.declarations, []);
    assert.match(result.evidenceGap ?? '', /No package\.json/);
    // No negative claim: absence here is not a fact about the project.
    const text = renderPreview(result);
    assert.match(text, /not evidence/i);
  });

  it('claims nothing from a malformed manifest', async () => {
    const { parent, root } = project({ 'README.md': '# hi', 'package.json': '{ "dependencies": ' });
    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });

    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    assert.deepEqual(result.declarations, []);
    assert.match(result.evidenceGap ?? '', /no dependency this policy can cite/);
  });

  it('reports a missing manifest as a gap, not as zero dependencies', async () => {
    const { parent, root } = project({ 'README.md': '# hi' });
    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });
    const text = renderPreview(result);
    assert.match(text, /Nothing cited/);
    // The absence caveat is present, and no claim of absence is made.
    assert.match(text, /not evidence that the project has no dependencies/);
  });
});

describe('preview: unsafe or unreadable content is reported, never quoted', () => {
  it('skips a file containing a credential and never prints it', async () => {
    const fakeKey = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
    const { parent, root } = project({
      'README.md': `deploy with ${fakeKey}\n`,
      'package.json': PACKAGE_JSON,
    });
    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });

    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    assert.ok(result.skipped.some((entry) => entry.path === 'README.md' && entry.reason === 'secret-like-content'));
    // The manifest is still cited; the credential never reaches the output.
    assert.ok(result.declarations.length > 0);
    assert.doesNotMatch(renderPreview(result), /AKIA/);
  });

  it('skips a symlinked manifest rather than following it', async () => {
    const outside = project({ 'package.json': PACKAGE_JSON });
    const { parent, root } = project({ 'README.md': '# hi' });
    fs.symlinkSync(nodePath.join(outside.root, 'package.json'), nodePath.join(root, 'package.json'));

    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });
    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    assert.ok(result.skipped.some((entry) => entry.path === 'package.json' && entry.reason === 'symlink'));
    assert.deepEqual(result.declarations, []);
  });

  it('skips a file over the per-file ceiling', async () => {
    const { parent, root } = project({
      'README.md': 'x'.repeat(DEFAULT_BUDGET.maxFileBytes + 1),
      'package.json': PACKAGE_JSON,
    });
    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });

    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    // The reader refuses on size before returning bytes, and the policy reports
    // every reader refusal as `unreadable`. The preview states that limitation
    // rather than inventing a finer reason it cannot observe.
    const skippedReadme = result.skipped.find((entry) => entry.path === 'README.md');
    assert.equal(skippedReadme?.reason, 'unreadable');
    assert.match(renderPreview(result), /does not distinguish those cases/);
    assert.ok(result.declarations.length > 0);
  });

  it('refuses an over-budget listing instead of inspecting part of it', async () => {
    const { parent, root } = project();
    for (let index = 0; index < DEFAULT_BUDGET.maxDirectoryEntries; index += 1) {
      fs.writeFileSync(nodePath.join(root, `noise-${index}.txt`), 'x');
    }
    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });

    assert.equal(result.kind, 'not-inspected');
    if (result.kind !== 'not-inspected') return;
    assert.equal(result.reason, 'too-many-directory-entries');
    assert.match(renderPreview(result), /could not be inspected/);
  });

  it('refuses a root that is not inside the harness parent', async () => {
    const outside = project();
    const other = project();
    // A root the caller does not own as a child of the permitted parent.
    const result = await runRepositoryPreview({
      ui: ui(CONSENT_LABELS.grant),
      root: outside.root,
      permittedParent: other.parent,
    });

    assert.equal(result.kind, 'not-inspected');
    if (result.kind !== 'not-inspected') return;
    assert.equal(result.reason, 'outside-permitted-parents');
  });

  it('never renders whole file content', async () => {
    const marker = 'MARKER-DOCUMENTATION-BODY-';
    const body = `${marker}${'z'.repeat(300)}`;
    const { parent, root } = project({ 'README.md': body, 'package.json': PACKAGE_JSON });

    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });
    const text = renderPreview(result);

    assert.equal(result.kind, 'inspected');
    // The documentation file is listed by name only; its body is never shown.
    assert.match(text, /README\.md/);
    assert.equal(text.includes(marker), false);
    assert.equal(text.includes('z'.repeat(50)), false);
  });
});

describe('preview: re-verification after a synthetic change', () => {
  it('goes stale once the cited declaration changes', async () => {
    const { parent, root } = project();

    // Capture a genuine citation through the public core path.
    const opened = createNodeRepositoryReader({ root, permittedParents: [parent] });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const captured = declaredDependencyEvidence({ reader: opened.reader, consent: GRANTED, dependency: 'left-pad' });
    assert.equal(captured.kind, 'evidence');
    if (captured.kind !== 'evidence') return;

    const unchanged = reverifyPreviewEvidence({ root, permittedParent: parent, consent: GRANTED, evidence: captured.evidence });
    assert.equal(unchanged.provenance, 'verified');

    // Same shape, different version: the line the citation points at no longer
    // says what it said.
    fs.writeFileSync(
      nodePath.join(root, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { 'left-pad': '^9.9.9' } }, null, 2),
    );
    const changed = reverifyPreviewEvidence({ root, permittedParent: parent, consent: GRANTED, evidence: captured.evidence });
    assert.equal(changed.provenance, 'stale');
    assert.match(changed.detail, /no longer trustworthy/);
  });

  it('reports missing once the manifest is gone', () => {
    const { parent, root } = project();
    const opened = createNodeRepositoryReader({ root, permittedParents: [parent] });
    if (!opened.ok) throw new Error('fixture should open');
    const captured = declaredDependencyEvidence({ reader: opened.reader, consent: GRANTED, dependency: 'left-pad' });
    if (captured.kind !== 'evidence') throw new Error('fixture should produce evidence');

    fs.rmSync(nodePath.join(root, 'package.json'));
    const gone = reverifyPreviewEvidence({ root, permittedParent: parent, consent: GRANTED, evidence: captured.evidence });
    assert.equal(gone.provenance, 'missing');
  });

  it('refuses to verify a hand-built claim', () => {
    const { parent, root } = project();
    const invented = {
      claim: 'package.json lists "left-pad" under "dependencies"',
      assertion: { kind: 'declared-dependency', dependency: 'left-pad', section: 'dependencies' },
      // A real file, but a line guessed rather than located.
      source: { path: 'package.json', lineStart: 1, lineEnd: 1 },
      provenance: 'verified',
      excerpt: '{"',
    };
    const result = reverifyPreviewEvidence({ root, permittedParent: parent, consent: GRANTED, evidence: invented });
    assert.equal(result.provenance, 'stale', 'a guess must not inherit a verified state');
  });

  it('does not verify without consent', () => {
    const { parent, root } = project();
    const opened = createNodeRepositoryReader({ root, permittedParents: [parent] });
    if (!opened.ok) throw new Error('fixture should open');
    const captured = declaredDependencyEvidence({ reader: opened.reader, consent: GRANTED, dependency: 'left-pad' });
    if (captured.kind !== 'evidence') throw new Error('fixture should produce evidence');

    const result = reverifyPreviewEvidence({ root, permittedParent: parent, consent: undefined, evidence: captured.evidence });
    assert.equal(result.provenance, 'stale');
  });
});

/**
 * Counts physical filesystem work performed under `root`.
 *
 * A "read" here is a real `readSync`, and `bytes` is what those reads actually
 * returned — not what a policy intended to allow.
 */
async function countPhysicalIo(root: string, run: () => Promise<unknown>): Promise<{ opens: number; lists: number; bytes: number; meta: number }> {
  const canonical = fs.realpathSync(root);
  const underRoot = (target: unknown): boolean => {
    const text = String(target);
    return text === canonical || text.startsWith(`${canonical}${nodePath.sep}`);
  };
  const openUnderRoot = new Set<number>();
  // `meta` counts the metadata calls root validation makes. Without it a reader
  // could be constructed and inspect the root without any open or listing, and
  // a "zero filesystem operations" assertion would pass while being wrong.
  const stats = { opens: 0, lists: 0, bytes: 0, meta: 0 };

  const patchable = fsDefault as unknown as {
    openSync: typeof fsDefault.openSync;
    opendirSync: typeof fsDefault.opendirSync;
    readSync: typeof fsDefault.readSync;
    realpathSync: typeof fsDefault.realpathSync;
    lstatSync: typeof fsDefault.lstatSync;
    statSync: typeof fsDefault.statSync;
  };
  const original = {
    openSync: fsDefault.openSync,
    opendirSync: fsDefault.opendirSync,
    readSync: fsDefault.readSync,
    realpathSync: fsDefault.realpathSync,
    lstatSync: fsDefault.lstatSync,
    statSync: fsDefault.statSync,
  };

  try {
    patchable.openSync = ((target: fs.PathLike, ...args: unknown[]) => {
      const descriptor = (original.openSync as (...values: unknown[]) => number)(target, ...args);
      if (underRoot(target)) {
        stats.opens += 1;
        openUnderRoot.add(descriptor);
      }
      return descriptor;
    }) as typeof fsDefault.openSync;
    patchable.opendirSync = ((target: fs.PathLike, ...args: unknown[]) => {
      if (underRoot(target)) stats.lists += 1;
      return (original.opendirSync as (...values: unknown[]) => unknown)(target, ...args);
    }) as typeof fsDefault.opendirSync;
    patchable.readSync = ((descriptor: number, ...args: unknown[]) => {
      const read = (original.readSync as (...values: unknown[]) => number)(descriptor, ...args);
      if (openUnderRoot.has(descriptor)) stats.bytes += read;
      return read;
    }) as typeof fsDefault.readSync;
    patchable.realpathSync = ((target: fs.PathLike, ...args: unknown[]) => {
      if (underRoot(target)) stats.meta += 1;
      return (original.realpathSync as (...values: unknown[]) => string)(target, ...args);
    }) as typeof fsDefault.realpathSync;
    patchable.lstatSync = ((target: fs.PathLike, ...args: unknown[]) => {
      if (underRoot(target)) stats.meta += 1;
      return (original.lstatSync as (...values: unknown[]) => unknown)(target, ...args);
    }) as typeof fsDefault.lstatSync;
    patchable.statSync = ((target: fs.PathLike, ...args: unknown[]) => {
      if (underRoot(target)) stats.meta += 1;
      return (original.statSync as (...values: unknown[]) => unknown)(target, ...args);
    }) as typeof fsDefault.statSync;
    syncBuiltinESMExports();

    await run();
  } finally {
    patchable.openSync = original.openSync;
    patchable.opendirSync = original.opendirSync;
    patchable.readSync = original.readSync;
    patchable.realpathSync = original.realpathSync;
    patchable.lstatSync = original.lstatSync;
    patchable.statSync = original.statSync;
    syncBuiltinESMExports();
  }

  return stats;
}

describe('correction A: re-verification honours consent before touching the disk', () => {
  const denials: Array<[string, unknown]> = [
    ['missing consent', undefined],
    ['explicit refusal', { granted: false }],
    ['a truthy non-boolean', { granted: 'yes' }],
    ['a bare string', 'granted'],
    ['null', null],
  ];

  for (const [label, consent] of denials) {
    it(`performs zero filesystem operations for ${label}`, async () => {
      const { parent, root } = project();
      const opened = createNodeRepositoryReader({ root, permittedParents: [parent] });
      if (!opened.ok) throw new Error('fixture should open');
      const captured = declaredDependencyEvidence({ reader: opened.reader, consent: GRANTED, dependency: 'left-pad' });
      if (captured.kind !== 'evidence') throw new Error('fixture should produce evidence');

      let result: ReturnType<typeof reverifyPreviewEvidence> | undefined;
      const io = await countPhysicalIo(root, async () => {
        result = reverifyPreviewEvidence({ root, permittedParent: parent, consent: consent as never, evidence: captured.evidence });
      });

      assert.deepEqual(io, { opens: 0, lists: 0, bytes: 0, meta: 0 }, 'no reader may even be constructed');
      assert.equal(result?.provenance, 'stale');
      // Never promoted to verified without a fresh authorised check.
      assert.notEqual(result?.provenance, 'verified');
    });
  }

  it('still re-checks normally when consent is granted', async () => {
    const { parent, root } = project();
    const opened = createNodeRepositoryReader({ root, permittedParents: [parent] });
    if (!opened.ok) throw new Error('fixture should open');
    const captured = declaredDependencyEvidence({ reader: opened.reader, consent: GRANTED, dependency: 'left-pad' });
    if (captured.kind !== 'evidence') throw new Error('fixture should produce evidence');

    let result: ReturnType<typeof reverifyPreviewEvidence> | undefined;
    const io = await countPhysicalIo(root, async () => {
      result = reverifyPreviewEvidence({ root, permittedParent: parent, consent: GRANTED, evidence: captured.evidence });
    });

    assert.ok(io.opens > 0, 'a granted re-check does read the file');
    assert.ok(io.meta > 0, 'a granted re-check does validate the root');
    assert.equal(result?.provenance, 'verified');
  });
});

describe('correction B: the aggregate read budget covers the whole preview', () => {
  /** Six allowlisted files whose total sits just under the 96 KiB ceiling. */
  function nearBudgetProject(dependencies: Record<string, string>): { parent: string; root: string } {
    return project({
      // Spaced prose, not a repeated character: a long homogeneous run of
      // [A-Za-z0-9] makes the core's secret detector scan quadratically, which
      // says nothing about the budget this test is measuring.
      'README.md': 'The quick brown fox jumps over the lazy dog. '.repeat(450),
      'AGENTS.md': 'Pack my box with five dozen liquor jugs. '.repeat(480),
      'go.mod': 'How vexingly quick daft zebras jump. '.repeat(520),
      'Cargo.toml': 'Sphinx of black quartz, judge my vow. '.repeat(510),
      'tsconfig.json': 'Bright vixens jump; dozy fowl quack. '.repeat(440),
      'package.json': JSON.stringify({ name: 'x', dependencies }, null, 2),
    });
  }

  it('stays inside the disclosed ceilings for a two-citation preview', async () => {
    const { parent, root } = nearBudgetProject({ alpha: '1.0.0', beta: '1.0.0' });

    let result: Awaited<ReturnType<typeof runRepositoryPreview>> | undefined;
    const io = await countPhysicalIo(root, async () => {
      result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });
    });

    assert.equal(result?.kind, 'inspected');
    if (result?.kind !== 'inspected') return;
    assert.equal(result.declarations.length, 2);

    // Six files, each opened once: no file is re-read to produce a citation.
    assert.ok(io.opens <= DEFAULT_BUDGET.maxFiles, `opened ${io.opens} times`);
    assert.ok(io.lists >= 1, 'the root is listed at least once');
    // What was actually read is what was disclosed.
    assert.ok(io.bytes <= DEFAULT_BUDGET.maxTotalBytes, `read ${io.bytes} bytes, ceiling ${DEFAULT_BUDGET.maxTotalBytes}`);
    assert.ok(io.bytes > 0);
  });

  it('adds no physical reads beyond a single selection', async () => {
    // Four candidate citations, so an uncached preview would select five times.
    const { parent, root } = nearBudgetProject({ alpha: '1.0.0', beta: '1.0.0', gamma: '1.0.0', delta: '1.0.0' });

    // Baseline: one selection, nothing else.
    let baseline = { opens: 0, lists: 0, bytes: 0 };
    await countPhysicalIo(root, async () => {
      const opened = createNodeRepositoryReader({ root, permittedParents: [parent] });
      if (!opened.ok) throw new Error('fixture should open');
      selectCandidates({ reader: opened.reader, consent: { granted: true, obtainedBy: 'baseline' } });
    }).then((io) => { baseline = io; }, () => undefined);

    let result: Awaited<ReturnType<typeof runRepositoryPreview>> | undefined;
    const preview = await countPhysicalIo(root, async () => {
      result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });
    });

    assert.equal(result?.kind, 'inspected');
    if (result?.kind === 'inspected') assert.equal(result.declarations.length, MAX_DECLARATIONS);

    // The decisive assertion: the whole preview costs exactly one selection.
    assert.ok(baseline.opens > 0, 'baseline should have opened files');
    assert.equal(preview.opens, baseline.opens, 'citations must not trigger extra opens');
    assert.equal(preview.bytes, baseline.bytes, 'citations must not trigger extra bytes');
    assert.ok(preview.bytes <= DEFAULT_BUDGET.maxTotalBytes);
  });

  it('says that citations come from one snapshot, not a live re-check', async () => {
    const { parent, root } = project();
    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });
    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    assert.ok(result.caveats.some((caveat) => /single snapshot read/.test(caveat)));
  });
});

describe('correction C: a partially created fixture is removed', () => {
  type Command = { name: string; handler: (context: { args: string; ui: ModUi; cwd: string }) => Promise<{ message?: string }> };

  /** A minimal ModApi that only records the command the mod registers. */
  function fakeCmd(): { commands: Command[]; api: unknown } {
    const commands: Command[] = [];
    const api = { addCommand: (command: Command) => { commands.push(command); return { dispose() {} }; } };
    return { commands, api };
  }

  /**
   * Runs the test-only mod's handler with injected failures.
   *
   * `mkdtempSync` is redirected into a directory this test owns, so the created
   * parent can be inspected afterwards without touching the system temp root.
   */
  async function runWithFailures(options: {
    failWrite: boolean;
    failCleanup?: boolean;
  }): Promise<{ message: string; parent: string; leftovers: string[] }> {
    const sandbox = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'nid-preview-'));
    created.push(sandbox);
    const sentinel = nodePath.join(sandbox, 'keep-me');
    fs.mkdirSync(sentinel);

    const patchable = fsDefault as unknown as {
      mkdtempSync: typeof fsDefault.mkdtempSync;
      writeFileSync: typeof fsDefault.writeFileSync;
      rmSync: typeof fsDefault.rmSync;
    };
    const original = {
      mkdtempSync: fsDefault.mkdtempSync,
      writeFileSync: fsDefault.writeFileSync,
      rmSync: fsDefault.rmSync,
    };
    let writes = 0;

    try {
      patchable.mkdtempSync = ((_prefix: string, ...rest: unknown[]) =>
        (original.mkdtempSync as (...values: unknown[]) => string)(nodePath.join(sandbox, 'nid-preview-mod-'), ...rest)
      ) as typeof fsDefault.mkdtempSync;
      if (options.failWrite) {
        patchable.writeFileSync = ((target: fs.PathLike, ...rest: unknown[]) => {
          writes += 1;
          // Fail on the second file, so the parent exists and already has content.
          if (writes === 2) throw new Error('synthetic write failure');
          return (original.writeFileSync as (...values: unknown[]) => void)(target, ...rest);
        }) as typeof fsDefault.writeFileSync;
      }
      if (options.failCleanup === true) {
        patchable.rmSync = (() => {
          throw new Error('synthetic cleanup failure');
        }) as typeof fsDefault.rmSync;
      }
      syncBuiltinESMExports();

      const cmd = fakeCmd();
      previewMod(cmd.api as never);
      const command = cmd.commands[0];
      const result = await command.handler({ args: '', ui: ui(CONSENT_LABELS.grant), cwd: '/unused' });

      return {
        message: result.message ?? '',
        parent: sandbox,
        leftovers: fs.readdirSync(sandbox).filter((entry) => entry !== 'keep-me'),
      };
    } finally {
      patchable.mkdtempSync = original.mkdtempSync;
      patchable.writeFileSync = original.writeFileSync;
      patchable.rmSync = original.rmSync;
      syncBuiltinESMExports();
    }
  }

  it('removes the parent it created when population fails', async () => {
    const outcome = await runWithFailures({ failWrite: true });

    assert.match(outcome.message, /could not be created/);
    assert.match(outcome.message, /nothing was read/);
    assert.deepEqual(outcome.leftovers, [], 'no temporary directory may survive');
    // A directory beside the fixture is untouched.
    assert.equal(fs.existsSync(nodePath.join(outcome.parent, 'keep-me')), true);
  });

  it('reports a bounded failure, without a path, when cleanup itself fails', async () => {
    const outcome = await runWithFailures({ failWrite: true, failCleanup: true });

    assert.match(outcome.message, /could not be created/);
    assert.match(outcome.message, /may remain under the system temp directory/);
    // Bounded: no absolute path from the sandbox leaks into the message.
    assert.equal(outcome.message.includes(outcome.parent), false);
    assert.doesNotMatch(outcome.message, /nid-preview-mod-/);

    // The real directory did survive (cleanup was sabotaged), so remove it here.
    for (const entry of outcome.leftovers) {
      fs.rmSync(nodePath.join(outcome.parent, entry), { recursive: true, force: true });
    }
  });

  it('leaves nothing behind on the success path either', async () => {
    const cmd = fakeCmd();
    previewMod(cmd.api as never);
    const result = await cmd.commands[0].handler({ args: '', ui: ui(CONSENT_LABELS.grant), cwd: '/unused' });
    // The real tmpdir is used here; the mod cleans it up in its own `finally`.
    assert.match(result.message ?? '', /Repository preview/);
  });
});

describe('preview: rendering', () => {
  it('states the limits and the no-model guarantee', async () => {
    const { parent, root } = project();
    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });
    const text = renderPreview(result);

    assert.match(text, /at most 6 files/);
    assert.match(text, /32 KiB/);
    assert.match(text, /sent to a model or an external service/i);
    assert.match(text, /never an instruction/);
    assert.match(text, /resolve\/open race/);
  });

  it('shows a line span for each citation', async () => {
    const { parent, root } = project();
    const result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });
    const text = renderPreview(result);
    assert.match(text, /package\.json lines? \d+(?:-\d+)?:/);
  });
});

// ---------------------------------------------------------------------------
// Correction D: the aggregate ceiling is enforced before a file is opened.
//
// `selectCandidates` checks the running total only *after* it has asked for the
// bytes, so six individually valid files can be read in full while only four are
// kept. These tests count real filesystem calls, not the policy's own numbers.
// ---------------------------------------------------------------------------

describe('correction D: the aggregate byte ceiling bounds physical reads', () => {
  const LINE = 'The quick brown fox jumps over the lazy dog. ';
  const BIG = LINE.repeat(455);           // 20_475 bytes: valid alone, 5 of them are not
  const MANIFEST = (deps: Record<string, string>): string =>
    JSON.stringify({ name: 'over', dependencies: deps }, null, 2);

  /**
   * Five permitted files at 20_475 bytes plus a manifest: 102 KiB in total, well
   * over the 96 KiB ceiling, while every individual file is inside the 32 KiB one.
   * Candidate order is README, AGENTS, package.json, Cargo.toml, go.mod, tsconfig.
   */
  function overBudgetProject(deps: Record<string, string>): { parent: string; root: string } {
    return project({
      'README.md': BIG,
      'AGENTS.md': BIG,
      'package.json': MANIFEST(deps),
      'Cargo.toml': BIG,
      'go.mod': BIG,
      'tsconfig.json': BIG,
    });
  }

  const totalOf = (files: readonly { bytes: number }[]): number =>
    files.reduce((sum, file) => sum + file.bytes, 0);

  it('reads only the bytes it keeps, and never opens the over-budget file', async () => {
    const { parent, root } = overBudgetProject({ alpha: '1.0.0', beta: '1.0.0' });

    let result: Awaited<ReturnType<typeof runRepositoryPreview>> | undefined;
    const io = await countPhysicalIo(root, async () => {
      result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });
    });

    assert.equal(result?.kind, 'inspected');
    if (result?.kind !== 'inspected') return;

    // The decisive invariant: every physically read byte was retained as evidence
    // and every retained file was opened exactly once. Under-counting bytes or
    // over-reading candidates both break it.
    assert.equal(io.bytes, totalOf(result.files), 'physical bytes must equal the bytes kept');
    assert.ok(io.bytes <= DEFAULT_BUDGET.maxTotalBytes, `read ${io.bytes} bytes, over the ceiling`);
    assert.equal(io.opens, result.files.length, 'one open per retained file, and none for the rest');

    // The file that did not fit is refused without being read at all.
    const refused = result.skipped.find((entry) => entry.path === 'tsconfig.json');
    assert.ok(refused !== undefined, 'the over-budget file must be reported as skipped');
    // Not "unreadable": the guard refused it before opening, and the preview
    // reports the real reason rather than the core's generic fallback.
    assert.equal(refused?.reason, 'total-too-large');
    assert.ok(!result.files.some((file) => file.path === 'tsconfig.json'));

    // 102 KiB of candidates, and only four large files plus the manifest were kept.
    assert.equal(result.files.length, 5);
    assert.equal(result.declarations.length, 2, 'within-budget manifests still yield citations');
  });

  it('does not open more files when more citations are requested', async () => {
    const one = overBudgetProject({ alpha: '1.0.0' });
    const four = overBudgetProject({ alpha: '1.0.0', beta: '1.0.0', gamma: '1.0.0', delta: '1.0.0' });

    let oneResult: Awaited<ReturnType<typeof runRepositoryPreview>> | undefined;
    const oneIo = await countPhysicalIo(one.root, async () => {
      oneResult = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root: one.root, permittedParent: one.parent });
    });

    let fourResult: Awaited<ReturnType<typeof runRepositoryPreview>> | undefined;
    const fourIo = await countPhysicalIo(four.root, async () => {
      fourResult = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root: four.root, permittedParent: four.parent });
    });

    assert.equal(oneResult?.kind, 'inspected');
    assert.equal(fourResult?.kind, 'inspected');
    if (fourResult?.kind !== 'inspected') return;

    assert.equal(fourResult.declarations.length, 2, 'the display cap is still two');
    assert.equal(oneIo.opens, fourIo.opens, 'the same files are opened');
    assert.equal(fourIo.bytes, totalOf(fourResult.files));
    assert.ok(fourIo.bytes <= DEFAULT_BUDGET.maxTotalBytes);
  });

  it('refuses without reading when consent is withheld', async () => {
    const { parent, root } = overBudgetProject({ alpha: '1.0.0' });

    for (const answer of [undefined, CONSENT_LABELS.refuse]) {
      let result: Awaited<ReturnType<typeof runRepositoryPreview>> | undefined;
      const io = await countPhysicalIo(root, async () => {
        result = await runRepositoryPreview({ ui: ui(answer), root, permittedParent: parent });
      });
      assert.equal(result?.kind, 'refused');
      assert.deepEqual(io, { opens: 0, lists: 0, bytes: 0, meta: 0 }, 'nothing may be touched');
    }
  });

  it('cannot be bypassed by a file that grows between listing and open', async () => {
    const { parent, root } = overBudgetProject({ alpha: '1.0.0', beta: '1.0.0' });
    // The reader joins onto its realpath'd root, so compare against that: on
    // macOS the temp dir is a /var -> /private/var symlink and a comparison
    // against the un-resolved path silently never matches.
    const target = nodePath.join(fs.realpathSync(root), 'Cargo.toml');

    // Grow the file after it was listed but before the reader opens it. Truncate
    // extends in place without going through the patched openSync, so the growth
    // itself is not counted as preview work. The OS reader must notice that the
    // descriptor no longer matches the listed size and refuse before reading.
    const growOnOpen = (): (() => void) => {
      const saved = fsDefault.openSync;
      let grown = false;
      (fsDefault as { openSync: typeof fsDefault.openSync }).openSync = ((path: fs.PathLike, ...args: unknown[]) => {
        if (!grown && String(path) === target) {
          grown = true;
          fs.truncateSync(target, BIG.length + 5_000);
        }
        return (saved as (...values: unknown[]) => number)(path, ...args);
      }) as typeof fsDefault.openSync;
      syncBuiltinESMExports();
      return () => {
        (fsDefault as { openSync: typeof fsDefault.openSync }).openSync = saved;
        syncBuiltinESMExports();
      };
    };

    const restore = growOnOpen();
    let result: Awaited<ReturnType<typeof runRepositoryPreview>> | undefined;
    let io = { opens: 0, lists: 0, bytes: 0, meta: 0 };
    try {
      io = await countPhysicalIo(root, async () => {
        result = await runRepositoryPreview({ ui: ui(CONSENT_LABELS.grant), root, permittedParent: parent });
      });
    } finally {
      restore();
    }

    assert.equal(result?.kind, 'inspected');
    if (result?.kind !== 'inspected') return;

    // The grown file contributed nothing: it was refused as size-changed before a
    // single byte was read, so the ceiling still holds and the invariant survives.
    assert.ok(!result.files.some((file) => file.path === 'Cargo.toml'), 'a changed file is not evidence');
    assert.ok(result.skipped.some((entry) => entry.path === 'Cargo.toml'));
    assert.equal(io.bytes, totalOf(result.files), 'the grown file was not read');
    assert.ok(io.bytes <= DEFAULT_BUDGET.maxTotalBytes);
  });

  it('fails closed when a reader hands over more bytes than it listed', () => {
    const calls: string[] = [];
    const lying: RepositoryReader = {
      list: () => ({
        kind: 'ok',
        entries: [
          { path: 'a.md', kind: 'file', size: 100 },
          { path: 'b.md', kind: 'file', size: 10 },
        ],
      }),
      read: (path) => {
        calls.push(path);
        // The listing claimed 100 bytes; the read returns 200.
        return path === 'a.md' ? { kind: 'ok', bytes: new Uint8Array(200) } : { kind: 'ok', bytes: new Uint8Array(10) };
      },
    };

    const reader = snapshotReader(lying, { ...DEFAULT_BUDGET, maxTotalBytes: 10_000 });
    reader.list('');

    assert.equal(reader.read('a.md').kind, 'ok');
    // A size that does not match the listing means the budget can no longer be
    // trusted, so the next read is refused rather than risked.
    assert.equal(reader.read('b.md').kind, 'unreadable');
    assert.deepEqual(calls, ['a.md'], 'the refused file was never handed to the reader');
  });

  it('refuses an unsized file when the remaining budget cannot cover the worst case', () => {
    const calls: string[] = [];
    const unsized: RepositoryReader = {
      list: () => ({ kind: 'ok', entries: [{ path: 'a.md', kind: 'file', size: 6_000 }] }),
      read: (path) => {
        calls.push(path);
        return { kind: 'ok', bytes: new Uint8Array(6_000) };
      },
    };

    // 4_000 bytes left, but a permitted file may be up to 32_768: admitting it
    // could overspend, so it is refused unopened.
    const reader = snapshotReader(unsized, { ...DEFAULT_BUDGET, maxTotalBytes: 10_000 });
    reader.list('');

    assert.equal(reader.read('a.md').kind, 'ok');
    assert.equal(reader.read('unlisted.toml').kind, 'unreadable');
    assert.deepEqual(calls, ['a.md']);
  });
});
