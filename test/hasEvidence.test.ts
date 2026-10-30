/**
 * M2-5C: `hasEvidence` semantics.
 *
 * The field this replaces was set from `kind === 'inspected'`, which is true of
 * any completed read - including one that found nothing citable. These tests
 * pin the distinction between *files inspected*, *evidence verified* and
 * *evidence unavailable*, because collapsing them is how a mod starts claiming
 * facts it never established.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import {
  hasVerifiedEvidence,
  offerRepositoryContext,
  verifiedEvidenceOf,
} from '../src/host/offerRepositoryContext.ts';
import type { FixtureAuthorization } from '../src/host/offerRepositoryContext.ts';
import { CONSENT_LABELS } from '../src/host/repositoryConsent.ts';
import type { ModUi } from '../src/host/modApi.ts';
import type { PreviewDeclaration } from '../src/host/repositoryPreview.ts';

const created: string[] = [];
after(() => {
  for (const parent of created) {
    try { fs.rmSync(parent, { recursive: true, force: true }); } catch { /* disposable */ }
  }
});

const MANIFEST = (deps: Record<string, string>): string =>
  JSON.stringify({ name: 'synthetic', dependencies: deps }, null, 2);

/**
 * Canonical temp parent, so the pilot's canonical-root check has no benign case
 * to excuse: the fixture is born at the path it resolves to.
 */
function fixture(files: Record<string, string>): { root: string } {
  const parent = fs.mkdtempSync(nodePath.join(fs.realpathSync(os.tmpdir()), 'nid-5c-ev-'));
  created.push(parent);
  const root = nodePath.join(parent, 'project');
  fs.mkdirSync(root);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(nodePath.join(root, name), content);
  return { root };
}

function ui(options: { typed?: string; answer?: string } = {}): ModUi {
  return {
    input: async () => options.typed,
    notify: () => {},
    select: async () => options.answer,
    capabilities: { status: true, surface: true },
  };
}

const auth = (root: string): FixtureAuthorization => ({ fixtureRoot: root, issuedBy: 'test' });

async function inspect(files: Record<string, string>) {
  const { root } = fixture(files);
  return offerRepositoryContext({
    ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
    authorization: auth(root),
  });
}

const declaration = (over: Partial<PreviewDeclaration> = {}): PreviewDeclaration => ({
  claim: 'package.json lists "left-pad" under "dependencies"',
  path: 'package.json',
  lineStart: 5,
  lineEnd: 5,
  excerpt: '"left-pad": "^1.3.0"',
  provenance: 'verified',
  ...over,
});

describe('hasEvidence: a read is not a claim', () => {
  it('reports zero evidence for a project that declares only non-dependency fields', async () => {
    // Files are read successfully; there is simply nothing this policy can cite.
    const outcome = await inspect({ 'README.md': '# hi\n', 'package.json': JSON.stringify({ name: 'x', version: '0.0.0' }) });

    assert.equal(outcome.kind, 'inspected');
    if (outcome.kind !== 'inspected') return;
    assert.ok(outcome.filesRead > 0, 'files really were read');
    assert.equal(outcome.evidence.length, 0, 'but no claim is available');
    assert.equal(hasVerifiedEvidence(outcome), false, 'a successful read must not imply evidence');
  });

  it('reports zero evidence when package.json is absent', async () => {
    const outcome = await inspect({ 'README.md': '# hi\n' });
    assert.equal(outcome.kind, 'inspected');
    if (outcome.kind !== 'inspected') return;
    assert.equal(outcome.evidence.length, 0);
    assert.equal(hasVerifiedEvidence(outcome), false);
    assert.match(outcome.message, /not evidence that the project has no dependencies/i);
  });

  it('reports zero evidence when the manifest was rejected', async () => {
    // Secret-like content: the file is refused, so nothing can be cited.
    const fakeAws = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
    const outcome = await inspect({
      'README.md': '# hi\n',
      'package.json': MANIFEST({ 'left-pad': '^1.3.0', note: fakeAws }),
    });

    assert.equal(outcome.kind, 'inspected');
    if (outcome.kind !== 'inspected') return;
    assert.equal(outcome.evidence.length, 0);
    assert.equal(hasVerifiedEvidence(outcome), false);
    assert.ok(outcome.filesRejected > 0, 'the rejection is reported, not hidden');
  });

  it('reports zero evidence when the manifest is unreadable', async () => {
    // A directory where the manifest should be: lstat says directory, so the
    // reader refuses it rather than reading something that is not a file.
    const parent = fs.mkdtempSync(nodePath.join(fs.realpathSync(os.tmpdir()), 'nid-5c-dir-'));
    created.push(parent);
    const root = nodePath.join(parent, 'project');
    fs.mkdirSync(root);
    fs.writeFileSync(nodePath.join(root, 'README.md'), '# hi\n');
    fs.mkdirSync(nodePath.join(root, 'package.json'));

    const outcome = await offerRepositoryContext({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: auth(root),
    });

    assert.equal(outcome.kind, 'inspected');
    if (outcome.kind !== 'inspected') return;
    assert.equal(outcome.evidence.length, 0);
    assert.equal(hasVerifiedEvidence(outcome), false);
  });

  it('reports evidence when a real declaration was verified', async () => {
    const outcome = await inspect({ 'package.json': MANIFEST({ 'left-pad': '^1.3.0' }) });

    assert.equal(outcome.kind, 'inspected');
    if (outcome.kind !== 'inspected') return;
    assert.equal(outcome.evidence.length, 1);
    assert.equal(hasVerifiedEvidence(outcome), true);

    const [claim] = outcome.evidence;
    assert.equal(claim?.path, 'package.json');
    // Line 1 is `{`, 2 is `"name"`, 3 is `"private"`, 4 is the dependency.
    // Asserted exactly, because a wrong span would still look plausible in prose.
    assert.equal(claim?.lineStart, 4);
    assert.equal(claim?.lineEnd, 4);
    assert.equal(claim?.provenance, 'verified');
    assert.match(claim?.excerpt ?? '', /left-pad/);
  });

  it('keeps files inspected and evidence verified as separate counts', async () => {
    const outcome = await inspect({
      'README.md': '# hi\n',
      'AGENTS.md': '# agents\n',
      'package.json': MANIFEST({ 'left-pad': '^1.3.0', 'tiny-invariant': '^1.3.1' }),
    });

    assert.equal(outcome.kind, 'inspected');
    if (outcome.kind !== 'inspected') return;
    assert.equal(outcome.filesRead, 3, 'three files inspected');
    assert.equal(outcome.evidence.length, 2, 'two claims verified');
    assert.equal(outcome.filesRejected, 0, 'nothing rejected');
  });

  it('caps evidence at the display limit while still reading every file', async () => {
    const outcome = await inspect({
      'README.md': '# hi\n',
      'package.json': MANIFEST({ a: '1.0.0', b: '1.0.0', c: '1.0.0', d: '1.0.0' }),
    });

    assert.equal(outcome.kind, 'inspected');
    if (outcome.kind !== 'inspected') return;
    assert.equal(outcome.filesRead, 2);
    assert.equal(outcome.evidence.length, 2, 'the two-citation cap still holds');
  });

  it('never reports evidence for a refusal', async () => {
    const { root } = fixture({ 'package.json': MANIFEST({ 'left-pad': '^1.3.0' }) });
    const outcome = await offerRepositoryContext({
      ui: ui({ typed: root, answer: CONSENT_LABELS.refuse }),
      authorization: auth(root),
    });

    assert.equal(outcome.kind, 'idea-only');
    assert.equal(hasVerifiedEvidence(outcome), false);
  });
});

describe('hasEvidence: only verified declarations count', () => {
  it('drops stale and missing declarations rather than downgrading them', () => {
    const verified = verifiedEvidenceOf([declaration()]);
    assert.equal(verified.length, 1);

    const stale = verifiedEvidenceOf([declaration({ provenance: 'stale' })]);
    assert.equal(stale.length, 0, 'a stale claim is not evidence');

    const missing = verifiedEvidenceOf([declaration({ provenance: 'missing' })]);
    assert.equal(missing.length, 0, 'a missing source is not evidence');
  });

  it('drops a declaration with no usable source span', () => {
    assert.equal(verifiedEvidenceOf([declaration({ path: '' })]).length, 0);
    assert.equal(verifiedEvidenceOf([declaration({ claim: '' })]).length, 0);
    assert.equal(verifiedEvidenceOf([declaration({ lineStart: 0 })]).length, 0);
    assert.equal(verifiedEvidenceOf([declaration({ lineEnd: 1, lineStart: 5 })]).length, 0);
    assert.equal(verifiedEvidenceOf([declaration({ lineStart: 1.5 })]).length, 0);
  });

  it('keeps the verified ones when mixed with unusable ones', () => {
    const mixed = verifiedEvidenceOf([
      declaration({ provenance: 'stale' }),
      declaration({ claim: 'good', provenance: 'verified' }),
      declaration({ path: '', provenance: 'verified' }),
    ]);
    assert.equal(mixed.length, 1);
    assert.equal(mixed[0]?.claim, 'good');
  });

  it('reports no evidence for an empty declaration list', () => {
    assert.equal(verifiedEvidenceOf([]).length, 0);
  });
});
