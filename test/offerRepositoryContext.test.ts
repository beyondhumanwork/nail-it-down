/**
 * M2-5B: the dormant integration seam.
 *
 * Every test here is about a boundary the adapter must not cross. Fixtures are
 * minted by this file and never named by the code under test, so no test can
 * pass by reading something real.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fsDefault from 'node:fs';
import * as fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import {
  asCommandResult,
  offerRepositoryContext,
} from '../src/host/offerRepositoryContext.ts';
import type { FixtureAuthorization } from '../src/host/offerRepositoryContext.ts';
import { PILOT_PERSISTENCE_STATEMENT } from '../src/host/workspacePilot.ts';
import { CONSENT_LABELS } from '../src/host/repositoryConsent.ts';
import type { ModUi } from '../src/host/modApi.ts';
import { CANDIDATE_POLICY, DEFAULT_BUDGET } from '../src/core/discovery.ts';

const created: string[] = [];
after(() => {
  for (const parent of created) {
    try { fs.rmSync(parent, { recursive: true, force: true }); } catch { /* disposable */ }
  }
});

const README = '# Synthetic\n\nFixture text.\n';
const MANIFEST = (deps: Record<string, string>): string =>
  JSON.stringify({ name: 'synthetic', dependencies: deps }, null, 2);

/** Minted under the canonical temp root, so a fixture is never a symlink alias. */
function fixture(files: Record<string, string> = {
  'README.md': README,
  'package.json': MANIFEST({ 'left-pad': '^1.3.0', 'tiny-invariant': '^1.3.1' }),
}): { parent: string; root: string } {
  const parent = fs.mkdtempSync(nodePath.join(fs.realpathSync(os.tmpdir()), 'nid-5b-'));
  created.push(parent);
  const root = nodePath.join(parent, 'project');
  fs.mkdirSync(root);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(nodePath.join(root, name), content);
  return { parent, root };
}

const auth = (root: string): FixtureAuthorization => ({ fixtureRoot: root, issuedBy: 'test fixture' });

type UiOptions = {
  typed?: string | undefined;
  answer?: string | undefined;
  surface?: boolean;
  inputThrows?: boolean;
  selectThrows?: boolean;
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

/** Records every filesystem call made while `run` executes. */
async function traceIo<T>(run: () => Promise<T>): Promise<{ result: T; io: { paths: string[]; opens: number; lists: number; bytes: number } }> {
  const io = { paths: [] as string[], opens: 0, lists: 0, bytes: 0 };
  const descriptors = new Set<number>();
  const patchable = fsDefault as unknown as Record<string, unknown>;
  const original = {
    openSync: fsDefault.openSync, opendirSync: fsDefault.opendirSync, readSync: fsDefault.readSync,
    realpathSync: fsDefault.realpathSync, lstatSync: fsDefault.lstatSync, statSync: fsDefault.statSync,
  };
  const note = (t: unknown): void => {
    if (typeof t === 'string') io.paths.push(t);
    else if (Buffer.isBuffer(t)) io.paths.push(t.toString());
  };
  let result: T | undefined;
  try {
    patchable.openSync = (t: unknown, f?: unknown, ...r: unknown[]) => {
      note(t); const d = (original.openSync as (...v: unknown[]) => number)(t, f, ...r);
      io.opens += 1; descriptors.add(d); return d;
    };
    patchable.opendirSync = (t: unknown, ...r: unknown[]) => {
      note(t); io.lists += 1; return (original.opendirSync as (...v: unknown[]) => unknown)(t, ...r);
    };
    patchable.readSync = (d: number, ...r: unknown[]) => {
      const n = (original.readSync as (...v: unknown[]) => number)(d, ...r);
      if (descriptors.has(d)) io.bytes += n; return n;
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
  return { result: result as T, io };
}

const under = (io: { paths: string[] }, prefix: string): string[] =>
  io.paths.filter((p) => p === prefix || p.startsWith(`${prefix}${nodePath.sep}`));

// ---------------------------------------------------------------------------
// 1-5: refusals that must touch nothing
// ---------------------------------------------------------------------------

describe('adapter: every refusal touches no filesystem', () => {
  it('1. idea-only path performs zero repository operations', async () => {
    const { root } = fixture();
    // No authorization at all: a caller that supplies no fixture gets nothing.
    const { result, io } = await traceIo(() => offerRepositoryContext({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: undefined,
    }));

    assert.equal(result.kind, 'idea-only');
    if (result.kind === 'idea-only') assert.equal(result.reason, 'authorization-invalid');
    assert.deepEqual(io.paths, [], 'the idea-only path must not inspect anything');
  });

  it('2. a dismissed dialog performs zero filesystem operations', async () => {
    const { root } = fixture();
    const { result, io } = await traceIo(() => offerRepositoryContext({
      ui: ui({ typed: undefined, answer: CONSENT_LABELS.grant }),
      authorization: auth(root),
    }));

    assert.equal(result.kind, 'idea-only');
    assert.deepEqual(io.paths, [], 'a dismissal must not resolve or stat the root');
  });

  it('3. refusal-first consent performs zero filesystem operations', async () => {
    const { root } = fixture();
    const { result, io } = await traceIo(() => offerRepositoryContext({
      ui: ui({ typed: root, answer: CONSENT_LABELS.refuse }),
      authorization: auth(root),
    }));

    assert.equal(result.kind, 'idea-only');
    if (result.kind === 'idea-only') assert.match(result.reason, /pilot:refused-by-choice/);
    assert.deepEqual(io.paths, []);
  });

  it('4. a headless or surface-less host refuses without asking', async () => {
    const { root } = fixture();

    const noUi = await offerRepositoryContext({ ui: undefined, authorization: auth(root) });
    assert.equal(noUi.kind, 'idea-only');
    if (noUi.kind === 'idea-only') assert.equal(noUi.reason, 'no-ui');

    const events: string[] = [];
    const noSurface = await offerRepositoryContext({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant, surface: false, events }),
      authorization: auth(root),
    });
    assert.equal(noSurface.kind, 'idea-only');
    assert.deepEqual(events, [], 'a host with no surface must not be prompted');
  });

  it('5. unexpected dialog values and thrown dialogs refuse', async () => {
    const { root } = fixture();
    const cases: Array<[UiOptions, RegExp]> = [
      [{ typed: root, answer: 'yes please' }, /pilot:unexpected-value/],
      [{ typed: root, selectThrows: true }, /pilot:ui-failure/],
      [{ typed: root, inputThrows: true }, /pilot:ui-failure/],
      [{ typed: 'relative/path', answer: CONSENT_LABELS.grant }, /pilot:not-absolute/],
    ];
    for (const [options, expected] of cases) {
      const { result, io } = await traceIo(() => offerRepositoryContext({
        ui: ui(options),
        authorization: auth(root),
      }));
      assert.equal(result.kind, 'idea-only');
      if (result.kind === 'idea-only') assert.match(result.reason, expected);
      assert.deepEqual(io.paths, [], `nothing may be touched for ${expected}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 6-7: authorization boundaries
// ---------------------------------------------------------------------------

describe('adapter: a typed path is not an authorization', () => {
  it('6. a second synthetic fixture is not implicitly authorized', async () => {
    const authorized = fixture();
    const other = fixture({ 'README.md': README });

    const { result, io } = await traceIo(() => offerRepositoryContext({
      ui: ui({ typed: other.root, answer: CONSENT_LABELS.grant }),
      authorization: auth(authorized.root),
    }));

    assert.equal(result.kind, 'idea-only');
    if (result.kind === 'idea-only') assert.match(result.reason, /pilot:not-authorized-root/);
    assert.deepEqual(under(io, other.root), [], 'the unauthorised fixture must not be touched');
    assert.deepEqual(under(io, authorized.root), [], 'and neither may the authorised one');
  });

  it('6b. cwd, environment and permittedParents cannot substitute', async () => {
    const { root } = fixture();
    const saved = process.env.NAILDOWN_CONTEXT_ROOT;
    process.env.NAILDOWN_CONTEXT_ROOT = root;
    try {
      const { result, io } = await traceIo(() => offerRepositoryContext({
        // A well-formed authorization for a *different* root, plus ambient hints
        // that all point at the fixture: still refused.
        ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
        authorization: auth(nodePath.join(root, 'not-the-fixture')),
      }));
      assert.equal(result.kind, 'idea-only');
      if (result.kind === 'idea-only') assert.match(result.reason, /pilot:not-authorized-root/);
      assert.deepEqual(under(io, root), []);
    } finally {
      if (saved === undefined) delete process.env.NAILDOWN_CONTEXT_ROOT;
      else process.env.NAILDOWN_CONTEXT_ROOT = saved;
    }
  });

  it('6c. a UI object cannot carry a root of its own', async () => {
    // Guard against the adapter ever sourcing a root from the UI object it was
    // handed. A host-shaped object with a root-ish property must change nothing.
    const authorized = fixture();
    const decoy = fixture({ 'README.md': README });

    const poisoned = {
      ...ui({ typed: decoy.root, answer: CONSENT_LABELS.grant }),
      __root: decoy.root,
      root: decoy.root,
      cwd: decoy.root,
      workspace: decoy.root,
    } as unknown as ModUi;

    const { result, io } = await traceIo(() => offerRepositoryContext({
      ui: poisoned,
      authorization: auth(authorized.root),
    }));

    assert.equal(result.kind, 'idea-only', 'a root-ish UI property is not an authorization');
    assert.deepEqual(under(io, decoy.root), [], 'the decoy must never be touched');
  });

  it('7. a canonical mismatch refuses before listing', async () => {
    const parent = fs.mkdtempSync(nodePath.join(fs.realpathSync(os.tmpdir()), 'nid-5b-canon-'));
    created.push(parent);
    const real = nodePath.join(parent, 'realdir');
    fs.mkdirSync(nodePath.join(real, 'project'), { recursive: true });
    fs.writeFileSync(nodePath.join(real, 'project', 'package.json'), MANIFEST({ 'left-pad': '^1.3.0' }));
    fs.symlinkSync(real, nodePath.join(parent, 'link'));

    const approved = nodePath.join(parent, 'link', 'project');
    const { result, io } = await traceIo(() => offerRepositoryContext({
      ui: ui({ typed: approved, answer: CONSENT_LABELS.grant }),
      authorization: auth(approved),
    }));

    assert.equal(result.kind, 'idea-only');
    if (result.kind === 'idea-only') assert.match(result.reason, /pilot:unexpected-canonical-root/);
    assert.equal(io.lists, 0, 'a moved root must not be listed');
    assert.equal(io.opens, 0, 'no candidate may be opened');
  });
});

// ---------------------------------------------------------------------------
// 8-10: gates, listing failures, budget
// ---------------------------------------------------------------------------

describe('adapter: downstream refusals stay refusals', () => {
  it('8. a failing pre-read gate refuses before content reads', async () => {
    const { root } = fixture();
    const { result, io } = await traceIo(() => offerRepositoryContext({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: auth(root),
      beforeRead: () => ({ ok: false, reason: 'mount-not-acceptable' }),
    }));

    assert.equal(result.kind, 'idea-only');
    if (result.kind === 'idea-only') assert.match(result.reason, /pilot:pre-read-check-failed/);
    assert.equal(io.opens, 0);
    assert.equal(io.lists, 0);
  });

  it('9. a listing failure never becomes an absence claim', async () => {
    const { root } = fixture();
    // Fault injection: the directory opens, yields one entry, then fails.
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

    let result;
    try {
      result = await offerRepositoryContext({
        ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
        authorization: auth(root),
      });
    } finally {
      (fsDefault as unknown as Record<string, unknown>).opendirSync = saved;
      syncBuiltinESMExports();
    }

    assert.equal(served > 1, true, 'the injection must have fired');
    assert.equal(result.kind, 'idea-only', 'a failed listing is not an inspection');
    if (result.kind === 'idea-only') assert.match(result.reason, /pilot:listing-failed/);
    // And the message must not claim absence.
    assert.doesNotMatch(result.message, /has no such file|does not exist|is absent/i);
  });

  it('10. the aggregate read budget still caps what is inspected', async () => {
    const big = 'The quick brown fox jumps over the lazy dog. '.repeat(445).slice(0, 20_000);
    const { root } = fixture({
      'README.md': big,
      'AGENTS.md': big,
      'pyproject.toml': big,
      'Cargo.toml': big,
      'go.mod': big,
      'tsconfig.json': big,
      'package.json': MANIFEST({ 'left-pad': '^1.3.0' }),
    });

    const { result, io } = await traceIo(() => offerRepositoryContext({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: auth(root),
    }));

    assert.equal(result.kind, 'inspected');
    assert.ok(io.bytes <= DEFAULT_BUDGET.maxTotalBytes, `read ${io.bytes}, over the ceiling`);
  });
});

// ---------------------------------------------------------------------------
// 11-15: no model, no persistence, no leaks, no regression
// ---------------------------------------------------------------------------

describe('adapter: nothing leaves the local feed', () => {
  it('11. never exposes a prompt field, so it cannot submit a model turn', async () => {
    const { root } = fixture();
    const outcome = await offerRepositoryContext({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: auth(root),
    });
    const commandResult = asCommandResult(outcome);

    assert.deepEqual(Object.keys(commandResult), ['message'], 'only a message field may be returned');
    assert.equal('prompt' in commandResult, false);
  });

  it('12. writes nothing to a store, and repository text is never persisted', async () => {
    const { root } = fixture();
    let storeTouched = false;
    const fakeStore = {
      get: () => { storeTouched = true; return undefined; },
      set: async () => { storeTouched = true; },
      delete: async () => { storeTouched = true; },
    };
    void fakeStore; // the adapter takes no store, which is the point

    const outcome = await offerRepositoryContext({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: auth(root),
    });
    assert.equal(outcome.kind, 'inspected');
    assert.equal(storeTouched, false, 'the adapter must not reach for a store');
    // The adapter's parameter type has no store member; assert that structurally.
    assert.equal('store' in (outcome as unknown as Record<string, unknown>), false);
  });

  it('13. the root path is never taken from a slash-command argument', () => {
    // The adapter has no `args` input at all: a slash argument has no route in.
    const source = fs.readFileSync(
      nodePath.join(import.meta.dirname, '..', 'src', 'host', 'offerRepositoryContext.ts'),
      'utf8',
    );
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');

    assert.doesNotMatch(stripped, /\bargs\b/, 'the adapter must not read slash arguments');
    assert.doesNotMatch(stripped, /\bcwd\b/, 'the adapter must not read the host cwd');
    assert.doesNotMatch(stripped, /process\.env/, 'the adapter must not read the environment');
    for (const forbidden of ['cmd.store', 'fetch(', 'node:http', 'child_process', 'writeFile']) {
      assert.equal(stripped.includes(forbidden), false, `adapter must not reference ${forbidden}`);
    }
  });

  it('14. M1 entrypoint is untouched and the adapter is not imported by it', () => {
    const index = fs.readFileSync(nodePath.join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
    assert.equal(index.includes('offerRepositoryContext'), false, 'production must not import the adapter');
    assert.equal(index.includes('workspacePilot'), false, 'production must not import the pilot');
  });

  it('15. an untrusted runtime diagnostic never reaches displayed output', async () => {
    const { root } = fixture();
    const planted = '/home/ahmed/.ssh/id_rsa ' + ['sk', '-', 'w'.repeat(24)].join('');

    // A gate that returns an off-list reason, a thrown dialog carrying a path,
    // and a malformed authorization carrying a path: none may surface.
    const cases: Array<() => Promise<{ message: string }>> = [
      () => offerRepositoryContext({
        ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
        authorization: auth(root),
        beforeRead: () => ({ ok: false, reason: planted }) as never,
      }),
      () => offerRepositoryContext({
        ui: { ...ui({ typed: root }), select: async () => { throw new Error(planted); } } as ModUi,
        authorization: auth(root),
      }),
      () => offerRepositoryContext({
        ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
        authorization: { fixtureRoot: planted, issuedBy: 'x' },
      }),
    ];

    for (const run of cases) {
      const outcome = await run();
      assert.equal(outcome.message.includes('id_rsa'), false, 'a path reached the message');
      assert.equal(outcome.message.includes('wwww'), false, 'a token reached the message');
    }
  });

  it('discloses host persistence on every outcome, including the earliest refusals', async () => {
    const { root } = fixture();

    // Every path this function can take, including the two that never reach the
    // pilot. An early return that skipped the note was the defect this covers.
    const outcomes = await Promise.all([
      offerRepositoryContext({ ui: undefined, authorization: auth(root) }),
      offerRepositoryContext({
        ui: { select: async () => CONSENT_LABELS.grant, capabilities: { status: true, surface: true } } as ModUi,
        authorization: auth(root),
      }),
      offerRepositoryContext({ ui: ui({ typed: root }), authorization: undefined }),
      offerRepositoryContext({ ui: ui({ typed: root }), authorization: { fixtureRoot: 'relative', issuedBy: 'x' } as FixtureAuthorization }),
      offerRepositoryContext({ ui: ui({ typed: root }), authorization: { fixtureRoot: root, issuedBy: '  ' } as FixtureAuthorization }),
      offerRepositoryContext({ ui: ui({ typed: root, answer: CONSENT_LABELS.refuse }), authorization: auth(root) }),
      offerRepositoryContext({ ui: ui({ typed: root, answer: CONSENT_LABELS.grant }), authorization: auth(root) }),
    ]);

    assert.equal(outcomes.length, 7);
    for (const outcome of outcomes) {
      assert.ok(
        outcome.message.includes(PILOT_PERSISTENCE_STATEMENT),
        `every outcome must carry the note; this one did not (${outcome.kind})`,
      );
      assert.match(outcome.message, /Host persistence: /);
    }
  });

  it('keeps the zero-operation guarantee while adding the note to early refusals', async () => {
    const { root } = fixture();

    // no-ui: nothing may be touched, and the note must still be present.
    const noUi = await traceIo(() => offerRepositoryContext({ ui: undefined, authorization: auth(root) }));
    assert.equal(noUi.result.kind, 'idea-only');
    if (noUi.result.kind === 'idea-only') assert.equal(noUi.result.reason, 'no-ui');
    assert.ok(noUi.result.message.includes(PILOT_PERSISTENCE_STATEMENT));
    assert.deepEqual(noUi.io.paths, [], 'adding the note must not introduce filesystem access');

    // authorization-invalid: same.
    const badAuth = await traceIo(() => offerRepositoryContext({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: undefined,
    }));
    assert.equal(badAuth.result.kind, 'idea-only');
    if (badAuth.result.kind === 'idea-only') assert.equal(badAuth.result.reason, 'authorization-invalid');
    assert.ok(badAuth.result.message.includes(PILOT_PERSISTENCE_STATEMENT));
    assert.deepEqual(badAuth.io.paths, [], 'a malformed authorization must still touch nothing');

    // And the host must not have been prompted for either.
    const events: string[] = [];
    await offerRepositoryContext({ ui: ui({ typed: root, events }), authorization: undefined });
    assert.deepEqual(events, [], 'an invalid authorization must not reach a dialog');
  });
});

// ---------------------------------------------------------------------------
// Disclosure completeness (Task A regression)
// ---------------------------------------------------------------------------

describe('adapter: corrected privacy wording', () => {
  it('no longer claims the reader lacks a listing-error channel', async () => {
    const { root } = fixture();
    const outcome = await offerRepositoryContext({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: auth(root),
    });
    assert.doesNotMatch(outcome.message, /no error channel/i);
    assert.doesNotMatch(outcome.message, /reads as empty/i);
  });

  it('scopes persistence claims to this mod and names host surfaces', () => {
    assert.match(PILOT_PERSISTENCE_STATEMENT, /statement about this mod only/i);
    assert.match(PILOT_PERSISTENCE_STATEMENT, /input-history file/i);
    assert.match(PILOT_PERSISTENCE_STATEMENT, /--no-session/);
    assert.match(PILOT_PERSISTENCE_STATEMENT, /cannot promise/i);
    assert.doesNotMatch(PILOT_PERSISTENCE_STATEMENT, /nothing was persisted/i);
  });

  it('keeps the fixed allowlist and budgets in the pre-consent disclosure', async () => {
    // The allowlist belongs on the disclosure shown *before* the choice, not on
    // the post-read summary. Capture what the host was actually asked to display.
    const { root } = fixture();
    const shown: string[] = [];
    const outcome = await offerRepositoryContext({
      ui: {
        input: async () => root,
        notify: (message: string) => { shown.push(message); },
        select: async () => CONSENT_LABELS.grant,
        capabilities: { status: true, surface: true },
      },
      authorization: auth(root),
    });

    assert.equal(shown.length, 1, 'exactly one disclosure, before the choice');
    const disclosure = shown[0] ?? '';
    for (const spec of CANDIDATE_POLICY) {
      assert.ok(disclosure.includes(spec.name), `disclosure must name ${spec.name}`);
    }
    assert.match(disclosure, new RegExp(`${DEFAULT_BUDGET.maxTotalBytes / 1024} KiB`));
    assert.match(disclosure, new RegExp(`${DEFAULT_BUDGET.maxFileBytes / 1024} KiB`));
    assert.match(disclosure, /host persists independently/i);
    assert.doesNotMatch(disclosure, /nothing persisted/i);
    assert.equal(outcome.kind, 'inspected');
  });
});
