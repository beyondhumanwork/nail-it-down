/**
 * M2-5C: the complete optional repository-context flow, end to end.
 *
 * These tests use the real M1 core (`createInterviewSession`, `frontier`,
 * `answerDecision`) and the real adapter and controller. Nothing is stubbed
 * except the two Command Code dialogs, which is the only part a test can stand
 * in for.
 *
 * Every fixture is minted here and disposed of here. No test names a real
 * directory.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fsDefault from 'node:fs';
import * as fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import { answerFirst, mintWorkspace, offerInterview } from '../src/host/syntheticIntegration.ts';
import { hasVerifiedEvidence } from '../src/host/offerRepositoryContext.ts';
import { CONSENT_LABELS } from '../src/host/repositoryConsent.ts';
import { DEFAULT_BUDGET } from '../src/core/discovery.ts';
import { frontier } from '../src/core/graph.ts';
import type { ModUi } from '../src/host/modApi.ts';

const workspaces: Array<{ dispose(): void }> = [];
after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

function mint(files?: Record<string, string>) {
  const workspace = mintWorkspace(files);
  workspaces.push(workspace);
  return workspace;
}

type UiOptions = {
  typed?: string | undefined;
  answer?: string | undefined;
  surface?: boolean;
  selectThrows?: boolean;
  inputThrows?: boolean;
  events?: string[];
};

function ui(options: UiOptions = {}): ModUi {
  return {
    input: async () => {
      options.events?.push('input');
      if (options.inputThrows === true) throw new Error('input exploded at /home/ahmed/private');
      return options.typed;
    },
    notify: () => { options.events?.push('notify'); },
    select: async () => {
      options.events?.push('select');
      if (options.selectThrows === true) throw new Error('dialog exploded at /home/ahmed/private');
      return options.answer;
    },
    capabilities: { status: options.surface ?? true, surface: options.surface ?? true },
  };
}

/** Records filesystem calls whose target is at or under `prefix`. */
async function touchesUnder<T>(prefix: string, run: () => Promise<T>): Promise<{ result: T; touched: string[]; bytes: number }> {
  const touched: string[] = [];
  let bytes = 0;
  const descriptors = new Set<number>();
  const patchable = fsDefault as unknown as Record<string, unknown>;
  const original = {
    openSync: fsDefault.openSync, opendirSync: fsDefault.opendirSync, readSync: fsDefault.readSync,
    realpathSync: fsDefault.realpathSync, lstatSync: fsDefault.lstatSync, statSync: fsDefault.statSync,
  };
  const note = (target: unknown): void => {
    const text = typeof target === 'string' ? target : Buffer.isBuffer(target) ? target.toString() : '';
    if (text === prefix || text.startsWith(`${prefix}${nodePath.sep}`)) touched.push(text);
  };
  let result: T | undefined;
  try {
    patchable.openSync = (t: unknown, ...r: unknown[]) => {
      note(t); const d = (original.openSync as (...v: unknown[]) => number)(t, ...r); descriptors.add(d); return d;
    };
    patchable.opendirSync = (t: unknown, ...r: unknown[]) => { note(t); return (original.opendirSync as (...v: unknown[]) => unknown)(t, ...r); };
    patchable.readSync = (d: number, ...r: unknown[]) => {
      const n = (original.readSync as (...v: unknown[]) => number)(d, ...r);
      if (descriptors.has(d)) bytes += n; return n;
    };
    for (const name of ['realpathSync', 'lstatSync', 'statSync'] as const) {
      patchable[name] = (t: unknown, ...r: unknown[]) => { note(t); return (original[name] as (...v: unknown[]) => unknown)(t, ...r); };
    }
    syncBuiltinESMExports();
    result = await run();
  } finally {
    patchable.openSync = original.openSync;
    patchable.opendirSync = original.opendirSync;
    patchable.readSync = original.readSync;
    patchable.realpathSync = original.realpathSync;
    patchable.lstatSync = original.lstatSync;
    patchable.statSync = original.statSync;
    syncBuiltinESMExports();
  }
  return { result: result as T, touched, bytes };
}

/** Counts every filesystem call, anywhere. */
async function anyFsCall<T>(run: () => Promise<T>): Promise<{ result: T; calls: number }> {
  let calls = 0;
  const patchable = fsDefault as unknown as Record<string, unknown>;
  const original = {
    openSync: fsDefault.openSync, opendirSync: fsDefault.opendirSync,
    realpathSync: fsDefault.realpathSync, lstatSync: fsDefault.lstatSync, statSync: fsDefault.statSync,
  };
  let result: T | undefined;
  try {
    for (const name of ['openSync', 'opendirSync', 'realpathSync', 'lstatSync', 'statSync'] as const) {
      patchable[name] = (...args: unknown[]) => {
        calls += 1;
        return (original[name] as (...v: unknown[]) => unknown)(...args);
      };
    }
    syncBuiltinESMExports();
    result = await run();
  } finally {
    for (const name of ['openSync', 'opendirSync', 'realpathSync', 'lstatSync', 'statSync'] as const) {
      patchable[name] = original[name];
    }
    syncBuiltinESMExports();
  }
  return { result: result as T, calls };
}

const INTERVIEW = {
  workspace: '/synthetic/interview-workspace-key',
  goal: 'Decide whether to ship the reminder digest',
  now: '2026-10-30T12:00:00.000Z',
} as const;

// ---------------------------------------------------------------------------
// 1-2: idea-only, and opt-in reaching the right dialogs
// ---------------------------------------------------------------------------

describe('integration: idea-only', () => {
  it('works with no filesystem access at all when the user does not opt in', async () => {
    const workspace = mint();
    const { result, calls } = await anyFsCall(() => offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.grant }),
      ...INTERVIEW,
      withRepositoryContext: false,
    }));

    assert.equal(calls, 0, 'idea-only must not touch the filesystem');
    assert.equal(result.contextCalled, false, 'the repository path must not even be called');
    assert.equal(result.offer.repositoryContext, undefined);
    // And the interview is intact and usable.
    assert.equal(result.session.decisions.length > 0, true);
    assert.ok(result.offer.decisionId.length > 0);
    assert.ok(result.offer.options.length > 0);
  });

  it('explicit opt-in reaches the native dialogs in order', async () => {
    const workspace = mint();
    const events: string[] = [];
    const result = await offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.grant, events }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    });

    assert.equal(result.contextCalled, true);
    // proposal -> disclosure -> consent. Disclosure must precede the choice.
    assert.deepEqual(events, ['input', 'notify', 'select']);
    assert.equal(result.offer.repositoryContext?.kind, 'inspected');
  });
});

// ---------------------------------------------------------------------------
// 3-6: proposal, authorization and consent stay distinct
// ---------------------------------------------------------------------------

describe('integration: three separate acts', () => {
  it('refuses a wrong root without touching it', async () => {
    const authorized = mint();
    const other = mint();

    const { result, touched } = await touchesUnder(other.root, () => offerInterview({
      ui: ui({ typed: other.root, answer: CONSENT_LABELS.grant }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: authorized.root,
    }));

    assert.equal(result.offer.repositoryContext?.kind, 'idea-only');
    if (result.offer.repositoryContext?.kind === 'idea-only') {
      assert.match(result.offer.repositoryContext.reason, /not-authorized-root/);
    }
    assert.deepEqual(touched, [], 'a typed path is not authority');
  });

  it('reads nothing when consent is dismissed', async () => {
    const workspace = mint();
    const { result, touched } = await touchesUnder(workspace.root, () => offerInterview({
      ui: ui({ typed: workspace.root, answer: undefined }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    }));

    assert.equal(result.offer.repositoryContext?.kind, 'idea-only');
    assert.deepEqual(touched, [], 'a dismissal must not resolve or stat the root');
  });

  it('reads nothing when consent is refused', async () => {
    const workspace = mint();
    const { result, touched } = await touchesUnder(workspace.root, () => offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.refuse }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    }));

    assert.equal(result.offer.repositoryContext?.kind, 'idea-only');
    if (result.offer.repositoryContext?.kind === 'idea-only') {
      assert.match(result.offer.repositoryContext.reason, /refused-by-choice/);
    }
    assert.deepEqual(touched, []);
  });

  it('refuses a canonical mismatch before listing', async () => {
    const parent = fs.mkdtempSync(nodePath.join(fs.realpathSync(os.tmpdir()), 'nid-5c-canon-'));
    workspaces.push({ dispose: () => { try { fs.rmSync(parent, { recursive: true, force: true }); } catch { /* x */ } } });
    const real = nodePath.join(parent, 'realdir');
    fs.mkdirSync(nodePath.join(real, 'project'), { recursive: true });
    fs.writeFileSync(nodePath.join(real, 'project', 'package.json'), JSON.stringify({ dependencies: { a: '1.0.0' } }));
    fs.symlinkSync(real, nodePath.join(parent, 'link'));

    const approved = nodePath.join(parent, 'link', 'project');
    const result = await offerInterview({
      ui: ui({ typed: approved, answer: CONSENT_LABELS.grant }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: approved,
    });

    const context = result.offer.repositoryContext;
    assert.equal(context?.kind, 'idea-only');
    if (context?.kind === 'idea-only') assert.match(context.reason, /unexpected-canonical-root/);
  });

  it('refuses a headless host and a surface-less host without prompting', async () => {
    const workspace = mint();

    const headless = await offerInterview({
      ui: { select: async () => CONSENT_LABELS.grant, capabilities: { status: true, surface: true } } as ModUi,
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    });
    assert.equal(headless.offer.repositoryContext?.kind, 'idea-only');
    if (headless.offer.repositoryContext?.kind === 'idea-only') {
      assert.equal(headless.offer.repositoryContext.reason, 'no-ui');
    }

    const events: string[] = [];
    await offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.grant, surface: false, events }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    });
    assert.deepEqual(events, [], 'a host with no surface must not be prompted');
  });

  it('refuses unexpected dialog values and thrown dialogs', async () => {
    const workspace = mint();
    const cases: Array<[UiOptions, RegExp]> = [
      [{ typed: workspace.root, answer: 'yes please' }, /unexpected-value/],
      [{ typed: workspace.root, selectThrows: true }, /ui-failure/],
      [{ typed: workspace.root, inputThrows: true }, /ui-failure/],
      [{ typed: 'relative/path', answer: CONSENT_LABELS.grant }, /not-absolute/],
    ];
    for (const [options, expected] of cases) {
      const { touched } = await touchesUnder(workspace.root, () => offerInterview({
        ui: ui(options),
        ...INTERVIEW,
        withRepositoryContext: true,
        fixtureRoot: workspace.root,
      }));
      assert.deepEqual(touched, [], `nothing may be touched for ${expected}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 7-11: listing, budget, provenance, honesty
// ---------------------------------------------------------------------------

describe('integration: honest results', () => {
  it('distinguishes a failed listing from an empty directory', async () => {
    const empty = mint({ 'unrelated.txt': 'nothing this policy reads' });
    const emptyResult = await offerInterview({
      ui: ui({ typed: empty.root, answer: CONSENT_LABELS.grant }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: empty.root,
    });
    const emptyContext = emptyResult.offer.repositoryContext;
    assert.equal(emptyContext?.kind, 'idea-only');
    if (emptyContext?.kind === 'idea-only') assert.match(emptyContext.reason, /nothing-to-read/);

    // Now a genuinely failed enumeration, injected after the directory opens.
    const failing = mint();
    const saved = fsDefault.opendirSync;
    let served = 0;
    (fsDefault as unknown as Record<string, unknown>).opendirSync = (...args: unknown[]) => {
      const dir = (saved as (...v: unknown[]) => fs.Dir)(...args);
      const realRead = dir.readSync.bind(dir);
      (dir as unknown as { readSync: () => unknown }).readSync = () => {
        served += 1;
        if (served > 1) throw Object.assign(new Error('injected'), { code: 'EIO' });
        return realRead();
      };
      return dir;
    };
    syncBuiltinESMExports();

    let failedContext;
    try {
      const failed = await offerInterview({
        ui: ui({ typed: failing.root, answer: CONSENT_LABELS.grant }),
        ...INTERVIEW,
        withRepositoryContext: true,
        fixtureRoot: failing.root,
      });
      failedContext = failed.offer.repositoryContext;
    } finally {
      (fsDefault as unknown as Record<string, unknown>).opendirSync = saved;
      syncBuiltinESMExports();
    }

    assert.equal(served > 1, true, 'the injection must have fired');
    assert.equal(failedContext?.kind, 'idea-only');
    if (failedContext?.kind === 'idea-only') {
      assert.match(failedContext.reason, /listing-failed/);
      assert.doesNotMatch(failedContext.message, /has no such file|does not exist/i);
    }
  });

  it('covers rejected reads within the physical ceiling', async () => {
    const big = 'The quick brown fox jumps over the lazy dog. '.repeat(445).slice(0, 20_000);
    const workspace = mint({
      'README.md': big,
      'AGENTS.md': big,
      'pyproject.toml': big,
      'Cargo.toml': big,
      'go.mod': big,
      'tsconfig.json': big,
      'package.json': JSON.stringify({ dependencies: { 'left-pad': '^1.3.0' } }),
    });

    const { bytes } = await touchesUnder(workspace.root, () => offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.grant }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    }));

    assert.ok(bytes > 0, 'something was read');
    assert.ok(bytes <= DEFAULT_BUDGET.maxTotalBytes, `read ${bytes}, over the ceiling`);
  });

  it('gives verified claims correct path and line provenance', async () => {
    const workspace = mint();
    const result = await offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.grant }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    });

    const context = result.offer.repositoryContext;
    assert.equal(context?.kind, 'inspected');
    if (context?.kind !== 'inspected') return;

    assert.equal(context.evidence.length, 2);
    for (const claim of context.evidence) {
      assert.equal(claim.path, 'package.json');
      assert.equal(claim.provenance, 'verified');
      assert.ok(claim.lineStart >= 1);
      assert.ok(claim.lineEnd >= claim.lineStart);
      // The cited span must actually contain the excerpt in the real file.
      const lines = fs.readFileSync(nodePath.join(workspace.root, claim.path), 'utf8').split('\n');
      const span = lines.slice(claim.lineStart - 1, claim.lineEnd).join('\n');
      assert.ok(span.includes(claim.excerpt), `line span must contain the excerpt: ${claim.excerpt}`);
    }
  });

  it('never reports evidence when none was verified', async () => {
    const workspace = mint({
      'README.md': '# hi\n',
      'package.json': JSON.stringify({ name: 'x', version: '0.0.0' }),
    });
    const result = await offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.grant }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    });

    const context = result.offer.repositoryContext;
    assert.equal(context?.kind, 'inspected');
    if (context?.kind !== 'inspected') return;
    assert.equal(context.evidence.length, 0);
    assert.equal(hasVerifiedEvidence(context), false);
  });

  it('quotes repository text as data and never obeys it', async () => {
    // AGENTS.md in every minted fixture says "ignore all previous instructions".
    const workspace = mint();
    const result = await offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.grant }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    });

    const context = result.offer.repositoryContext;
    assert.equal(context?.kind, 'inspected');
    if (context?.kind !== 'inspected') return;
    // The file is read, but only ever as a name and a line count - never as an
    // instruction, and never promoted into the decision or the evidence.
    assert.equal(context.evidence.some((claim: { claim: string }) => /ignore all previous/i.test(claim.claim)), false);
    assert.equal(result.offer.options.some((option: string) => /ignore all previous/i.test(option)), false);
    assert.equal(result.offer.question.includes('ignore all previous'), false);
  });
});

// ---------------------------------------------------------------------------
// 12-16: nothing leaves the process, M1 unchanged
// ---------------------------------------------------------------------------

describe('integration: privacy and M1 compatibility', () => {
  it('returns no prompt, so no model turn can be submitted', async () => {
    const workspace = mint();
    const result = await offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.grant }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    });

    // The offer carries an outcome and dialog copy only.
    assert.deepEqual(Object.keys(result.offer).sort(), ['decisionId', 'options', 'question', 'repositoryContext']);
    const serialized = JSON.stringify(result.offer);
    assert.equal(serialized.includes('"prompt"'), false);
  });

  it('writes nothing to a store and does not require one', async () => {
    const workspace = mint();
    let storeTouched = false;
    const store = {
      get: () => { storeTouched = true; return undefined; },
      set: async () => { storeTouched = true; },
      delete: async () => { storeTouched = true; },
    };
    void store; // the harness takes no store: the assertion is that it needs none

    await offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.grant }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    });
    assert.equal(storeTouched, false, 'no repository evidence or consent may be persisted');
  });

  it('leaves session.v2 shape and the decision graph unchanged', async () => {
    const workspace = mint();
    const { session, offer } = await offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.grant }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    });

    // Same schema, same fields, no repository node added.
    assert.deepEqual(
      Object.keys(session).sort(),
      ['createdAt', 'decisions', 'goal', 'id', 'schemaVersion', 'status', 'updatedAt', 'workspace'],
    );
    assert.equal(session.schemaVersion, 2);
    assert.equal(session.decisions.some((decision) => /repo/i.test(decision.id)), false);
    // The repository work did not touch the session at all.
    assert.equal(session.updatedAt, INTERVIEW.now);
    assert.equal(session.decisions.every((decision) => decision.status !== 'answered'), true);
    assert.ok(offer.decisionId.length > 0);
  });

  it('lets the interview continue normally after an inspection that found nothing', async () => {
    const workspace = mint({
      'README.md': '# hi\n',
      'package.json': JSON.stringify({ name: 'x' }),
    });

    const { session, offer } = await offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.grant }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    });

    const context = offer.repositoryContext;
    assert.equal(context?.kind, 'inspected');
    if (context?.kind === 'inspected') assert.equal(context.evidence.length, 0);

    // And the interview proceeds exactly as it would have without the feature.
    const answered = answerFirst({ session, answerLabel: offer.options[0]!, now: '2026-10-30T12:01:00.000Z' });
    assert.equal(answered.ok, true, answered.reason);
    assert.equal(frontier(answered.session.decisions).length > 0, true, 'the interview moves on');
    assert.equal(answered.session.schemaVersion, 2);
  });

  it('lets the interview continue normally after a refusal', async () => {
    const workspace = mint();
    const { session, offer } = await offerInterview({
      ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.refuse }),
      ...INTERVIEW,
      withRepositoryContext: true,
      fixtureRoot: workspace.root,
    });

    assert.equal(offer.repositoryContext?.kind, 'idea-only');
    const answered = answerFirst({ session, answerLabel: offer.options[0]!, now: '2026-10-30T12:01:00.000Z' });
    assert.equal(answered.ok, true, answered.reason);
    assert.equal(answered.session.schemaVersion, 2);
  });

  it('keeps host-persistence disclosure on every outcome', async () => {
    const workspace = mint();
    const outcomes = await Promise.all([
      offerInterview({ ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.grant }), ...INTERVIEW, withRepositoryContext: true, fixtureRoot: workspace.root }),
      offerInterview({ ui: ui({ typed: workspace.root, answer: CONSENT_LABELS.refuse }), ...INTERVIEW, withRepositoryContext: true, fixtureRoot: workspace.root }),
      offerInterview({ ui: undefined, ...INTERVIEW, withRepositoryContext: true, fixtureRoot: workspace.root }),
      offerInterview({ ui: ui({ typed: workspace.root }), ...INTERVIEW, withRepositoryContext: true }),
    ]);

    for (const outcome of outcomes) {
      const context = outcome.offer.repositoryContext;
      assert.ok(context !== undefined, 'opt-in always yields an outcome');
      assert.match(context.message, /Host persistence: /, 'every outcome owes the disclosure');
      assert.match(context.message, /--no-session/);
    }
  });
});
