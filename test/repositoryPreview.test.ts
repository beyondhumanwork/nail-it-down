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
} from '../src/host/repositoryPreview.ts';
import { CONSENT_LABELS } from '../src/host/repositoryConsent.ts';
import { DEFAULT_BUDGET, declaredDependencyEvidence } from '../src/core/discovery.ts';
import type { ConsentDecision } from '../src/core/discovery.ts';
import { createNodeRepositoryReader } from '../src/host/nodeRepositoryReader.ts';
import type { ModUi } from '../src/host/modApi.ts';

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
  const canonical = `${fs.realpathSync(root)}${nodePath.sep}`;
  const record = (target: unknown): void => {
    const text = String(target);
    if (text.startsWith(canonical)) touched.push(text.slice(canonical.length));
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
