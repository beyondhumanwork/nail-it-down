import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fsDefault from 'node:fs';
import * as fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import {
  PILOT_CAVEATS,
  PILOT_INPUT_PLACEHOLDER,
  PILOT_INPUT_TITLE,
  PILOT_RISK_STATEMENT,
  pilotDisclosure,
  proposeWorkspaceRoot,
  renderWorkspacePilot,
  runWorkspacePilot,
} from '../src/host/workspacePilot.ts';
import type { PilotAuthorization, PilotResult } from '../src/host/workspacePilot.ts';
import { CONSENT_LABELS } from '../src/host/repositoryConsent.ts';
import { CANDIDATE_POLICY, DEFAULT_BUDGET } from '../src/core/discovery.ts';
import type { ModUi } from '../src/host/modApi.ts';
import pilotMod from './pilotMod.ts';

/** Every fixture lives under one `mkdtemp` parent and is removed in `after`. */
const created: string[] = [];

after(() => {
  for (const parent of created) {
    try {
      fs.rmSync(parent, { recursive: true, force: true });
    } catch {
      // Disposable; nothing depends on the removal succeeding.
    }
  }
});

const README = '# Synthetic\n\nFixture text.\n';
const MANIFEST = (deps: Record<string, string>): string =>
  JSON.stringify({ name: 'synthetic', dependencies: deps }, null, 2);

function project(files: Record<string, string | Uint8Array> = {
  'README.md': README,
  'package.json': MANIFEST({ 'left-pad': '^1.3.0', 'tiny-invariant': '^1.3.1' }),
}): { parent: string; root: string } {
  // Minted under the canonical temp directory, exactly as the harness does: the
  // pilot refuses a root that resolves anywhere other than the approved path, so
  // a fixture created under macOS's /var alias would be refused before reading.
  const parent = fs.mkdtempSync(nodePath.join(fs.realpathSync(os.tmpdir()), 'nid-pilot-'));
  created.push(parent);
  const root = nodePath.join(parent, 'project');
  fs.mkdirSync(root);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(nodePath.join(root, name), content);
  }
  return { parent, root };
}

type UiOptions = {
  typed?: string | undefined;
  answer?: string | undefined;
  surface?: boolean;
  inputThrows?: boolean;
  selectThrows?: boolean;
  events?: string[];
};

/** A UI stub standing in for the host dialogs, recording the order it was asked. */
function ui(options: UiOptions = {}): ModUi {
  return {
    input: async () => {
      options.events?.push('input');
      if (options.inputThrows === true) throw new Error('input exploded at /home/ahmed/private');
      return options.typed;
    },
    notify: () => {
      options.events?.push('notify');
    },
    select: async () => {
      options.events?.push('select');
      if (options.selectThrows === true) throw new Error('dialog exploded at /home/ahmed/private');
      return options.answer;
    },
    capabilities: { status: options.surface ?? true, surface: options.surface ?? true },
  };
}

type Io = {
  paths: string[];
  opens: number;
  lists: number;
  bytes: number;
  writeOpens: number;
};

/**
 * Records every filesystem call made while `run` executes.
 *
 * Paths are recorded verbatim so a test can assert that a *specific* directory
 * was never touched — which is the property that matters when the operator types
 * somewhere the pilot is not authorized to read.
 */
async function traceIo<T>(run: () => Promise<T>): Promise<{ result: T; io: Io }> {
  const io: Io = { paths: [], opens: 0, lists: 0, bytes: 0, writeOpens: 0 };
  const descriptors = new Set<number>();
  const patchable = fsDefault as unknown as Record<string, unknown>;
  const original = {
    openSync: fsDefault.openSync,
    opendirSync: fsDefault.opendirSync,
    readSync: fsDefault.readSync,
    realpathSync: fsDefault.realpathSync,
    lstatSync: fsDefault.lstatSync,
    statSync: fsDefault.statSync,
  };

  const note = (target: unknown): void => {
    if (typeof target === 'string') io.paths.push(target);
    else if (Buffer.isBuffer(target)) io.paths.push(target.toString());
  };

  let result: T | undefined;
  try {
    patchable.openSync = (target: unknown, flags?: unknown, ...rest: unknown[]) => {
      note(target);
      const descriptor = (original.openSync as (...values: unknown[]) => number)(target, flags, ...rest);
      io.opens += 1;
      descriptors.add(descriptor);
      const numeric = typeof flags === 'number'
        ? (flags & 3) !== 0
        : typeof flags === 'string' && /[wa]/.test(flags);
      if (numeric) io.writeOpens += 1;
      return descriptor;
    };
    patchable.opendirSync = (target: unknown, ...rest: unknown[]) => {
      note(target);
      io.lists += 1;
      return (original.opendirSync as (...values: unknown[]) => unknown)(target, ...rest);
    };
    patchable.readSync = (descriptor: number, ...rest: unknown[]) => {
      const read = (original.readSync as (...values: unknown[]) => number)(descriptor, ...rest);
      if (descriptors.has(descriptor)) io.bytes += read;
      return read;
    };
    for (const name of ['realpathSync', 'lstatSync', 'statSync'] as const) {
      patchable[name] = (target: unknown, ...rest: unknown[]) => {
        note(target);
        return (original[name] as (...values: unknown[]) => unknown)(target, ...rest);
      };
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

const authorizationFor = (root: string): PilotAuthorization => ({
  root,
  issuedBy: 'test fixture',
});

const under = (io: Io, prefix: string): string[] =>
  io.paths.filter((path) => path === prefix || path.startsWith(`${prefix}${nodePath.sep}`));

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

describe('pilot: disclosure before consent', () => {
  it('states the exact root, allowlist, budgets, exclusions and the residual risk', () => {
    const disclosure = pilotDisclosure('/tmp/example/project');

    assert.match(disclosure, /Workspace root: \/tmp\/example\/project/);
    for (const spec of CANDIDATE_POLICY) {
      assert.ok(disclosure.includes(spec.name), `allowlist must name ${spec.name}`);
    }
    assert.match(disclosure, new RegExp(`at most ${DEFAULT_BUDGET.maxFiles} files`));
    assert.match(disclosure, new RegExp(`${DEFAULT_BUDGET.maxFileBytes / 1024} KiB per file`));
    assert.match(disclosure, new RegExp(`${DEFAULT_BUDGET.maxTotalBytes / 1024} KiB physically read in total`));
    assert.match(disclosure, new RegExp(`${DEFAULT_BUDGET.maxFileLines} lines per file`));
    assert.match(disclosure, new RegExp(`${DEFAULT_BUDGET.maxDirectoryEntries} root entries`));
    assert.match(disclosure, /\.env\*/);
    assert.match(disclosure, /no model, no network request/i);
    assert.match(disclosure, /nothing persisted/i);
    // The claims that must never be softened, and must not overstate either.
    assert.match(disclosure, /Some filesystem changes are detected and refused/);
    assert.match(disclosure, /NOT reliably prevented or detected/);
    assert.match(disclosure, /cooperative, user-controlled local workspaces only/);
    assert.match(disclosure, /not a sandbox/);
    assert.match(disclosure, /Filesystem type is NOT VERIFIED/);
    assert.match(disclosure, /statfs does not prove a mount is local/);
    // The superseded wording overstated the guarantee. It must be gone.
    assert.doesNotMatch(disclosure, /detected, not prevented/);
  });

  it('displays the disclosure before asking for consent', async () => {
    const { root } = project();
    const events: string[] = [];

    await runWorkspacePilot({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant, events }),
      authorization: authorizationFor(root),
    });

    assert.deepEqual(events, ['input', 'notify', 'select'], 'disclosure must precede the choice');
  });
});

// ---------------------------------------------------------------------------
// Root selection and exact-root authorization
// ---------------------------------------------------------------------------

describe('pilot: the root must be proposed and then authorized', () => {
  it('accepts the authorized fixture and cites two dependencies', async () => {
    const { root } = project();
    const result = await runWorkspacePilot({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: authorizationFor(root),
    });

    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    assert.equal(result.root.proposed, nodePath.resolve(root));
    assert.equal(result.declarations.length, 2);
    for (const declaration of result.declarations) {
      assert.equal(declaration.path, 'package.json');
      assert.ok(declaration.lineStart > 0);
      assert.match(declaration.excerpt, /"(left-pad|tiny-invariant)"/);
    }
    assert.equal(result.evidenceGap, undefined);
  });

  it('refuses a different path without touching it', async () => {
    const { root } = project();
    const trap = project({ 'README.md': README });
    const { result, io } = await traceIo(() => runWorkspacePilot({
      ui: ui({ typed: trap.root, answer: CONSENT_LABELS.grant }),
      authorization: authorizationFor(root),
    }));

    assert.equal(result.kind, 'refused');
    if (result.kind !== 'refused') return;
    assert.equal(result.reason, 'not-authorized-root');
    assert.deepEqual(under(io, trap.root), [], 'the refused path must not be inspected');
    assert.deepEqual(under(io, root), [], 'no read may happen at all');
  });

  it('refuses a relative path, an empty answer and a dismissed prompt', async () => {
    const { root } = project();
    const cases: Array<[string | undefined, string]> = [
      ['relative/path', 'not-absolute'],
      ['   ', 'empty'],
      [undefined, 'dismissed'],
    ];
    for (const [typed, expected] of cases) {
      const { result, io } = await traceIo(() => runWorkspacePilot({
        ui: ui({ typed, answer: CONSENT_LABELS.grant }),
        authorization: authorizationFor(root),
      }));
      assert.equal(result.kind, 'refused', String(typed));
      if (result.kind === 'refused') assert.equal(result.reason, expected, String(typed));
      assert.deepEqual(io.paths, [], `nothing may be touched for ${String(typed)}`);
    }
  });

  it('refuses when the prompt is headless or throws', async () => {
    const { root } = project();

    const headlessUi = { select: async () => CONSENT_LABELS.grant, capabilities: { status: true, surface: true } } as ModUi;
    const headless = await runWorkspacePilot({ ui: headlessUi, authorization: authorizationFor(root) });
    assert.equal(headless.kind, 'refused');
    if (headless.kind === 'refused') assert.equal(headless.reason, 'headless');

    const headlessEvents: string[] = [];
    const withoutSurface = await runWorkspacePilot({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant, surface: false, events: headlessEvents }),
      authorization: authorizationFor(root),
    });
    assert.equal(withoutSurface.kind, 'refused');
    if (withoutSurface.kind === 'refused') assert.equal(withoutSurface.reason, 'headless');
    // Not merely "it ended in a refusal" - a host with no surface must never
    // even be prompted for a root, because there is nothing to answer with.
    assert.deepEqual(headlessEvents, [], 'a headless host must not be prompted at all');

    const { result, io } = await traceIo(() => runWorkspacePilot({
      ui: ui({ typed: root, inputThrows: true }),
      authorization: authorizationFor(root),
    }));
    assert.equal(result.kind, 'refused');
    if (result.kind === 'refused') assert.equal(result.reason, 'ui-failure');
    assert.deepEqual(io.paths, []);
  });

  it('refuses when the disclosure cannot be shown', async () => {
    // A UI that can ask but cannot disclose would produce a grant made without
    // the terms. That is not consent, so it is refused before the question.
    const { root } = project();

    const withoutNotify = {
      input: async () => root,
      select: async () => CONSENT_LABELS.grant,
      capabilities: { status: true, surface: true },
    } as ModUi;

    const { result, io } = await traceIo(() => runWorkspacePilot({
      ui: withoutNotify,
      authorization: authorizationFor(root),
    }));
    assert.equal(result.kind, 'refused');
    if (result.kind === 'refused') assert.equal(result.reason, 'no-disclosure-surface');
    assert.deepEqual(io.paths, [], 'a failed disclosure must touch nothing');

    const throwingNotify = {
      input: async () => root,
      notify: () => { throw new Error('surface exploded at /home/ahmed/private'); },
      select: async () => CONSENT_LABELS.grant,
      capabilities: { status: true, surface: true },
    } as ModUi;

    const second = await traceIo(() => runWorkspacePilot({
      ui: throwingNotify,
      authorization: authorizationFor(root),
    }));
    assert.equal(second.result.kind, 'refused');
    if (second.result.kind === 'refused') assert.equal(second.result.reason, 'disclosure-failed');
    assert.deepEqual(second.io.paths, [], 'a throwing disclosure must touch nothing');
  });

  it('never asks for consent when the disclosure was not shown', async () => {
    const { root } = project();
    let asked = false;
    const uiWithoutDisclosure = {
      input: async () => root,
      select: async () => { asked = true; return CONSENT_LABELS.grant; },
      capabilities: { status: true, surface: true },
    } as ModUi;

    await runWorkspacePilot({ ui: uiWithoutDisclosure, authorization: authorizationFor(root) });
    assert.equal(asked, false, 'the grant question must not be reached without a disclosure');
  });

  it('puts the exact root and the risk on the consent decision surface', async () => {
    const { root } = project();
    let captured: { title: string; options: readonly { label: string; description?: string }[] } | undefined;

    const result = await runWorkspacePilot({
      ui: {
        input: async () => root,
        notify: () => {},
        select: async (input) => { captured = input; return CONSENT_LABELS.grant; },
        capabilities: { status: true, surface: true },
      },
      authorization: authorizationFor(root),
    });

    assert.equal(result.kind, 'inspected');
    const grant = captured?.options.find((option) => option.label === CONSENT_LABELS.grant);
    assert.ok(grant?.description !== undefined);
    assert.match(grant.description, new RegExp(`Root: ${nodePath.resolve(root).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.ok(grant.description.includes(PILOT_RISK_STATEMENT));
    // Refusal still comes first.
    assert.equal(captured?.options[0]?.label, CONSENT_LABELS.refuse);
  });

  it('refuses a malformed authorization', async () => {
    const { root } = project();
    for (const authorization of [
      { root: 'relative', issuedBy: 'x' },
      { root, issuedBy: '' },
      { root: '', issuedBy: 'x' },
      // Absent entirely. Reading properties off this would throw, so the shape
      // check is load-bearing rather than defensive decoration.
      undefined as unknown as PilotAuthorization,
      null as unknown as PilotAuthorization,
    ]) {
      const result = await runWorkspacePilot({
        ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
        authorization,
      });
      assert.equal(result.kind, 'refused');
      if (result.kind === 'refused') assert.equal(result.reason, 'authorization-invalid');
    }
  });
});

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

describe('pilot: refusal-first consent', () => {
  it('refuses every non-grant answer with zero filesystem operations', async () => {
    const { root } = project();
    const cases: Array<[UiOptions, string]> = [
      [{ typed: root, answer: CONSENT_LABELS.refuse }, 'refused-by-choice'],
      [{ typed: root, answer: undefined }, 'dismissed'],
      [{ typed: root, answer: 'yes please' }, 'unexpected-value'],
      [{ typed: root, selectThrows: true }, 'ui-failure'],
    ];
    for (const [options, expected] of cases) {
      const { result, io } = await traceIo(() => runWorkspacePilot({
        ui: ui(options),
        authorization: authorizationFor(root),
      }));
      assert.equal(result.kind, 'refused', expected);
      if (result.kind === 'refused') assert.equal(result.reason, expected);
      assert.deepEqual(io.paths, [], `nothing may be touched when consent is not granted (${expected})`);
      assert.equal(io.writeOpens, 0);
    }
  });

  it('never reads when consent is granted but the root is unusable', async () => {
    const { root } = project();
    const missing = nodePath.join(nodePath.dirname(root), 'absent');

    // The authorization names a directory that does not exist. Consent is real,
    // and the pilot still refuses rather than falling back to a neighbour.
    const result = await runWorkspacePilot({
      ui: ui({ typed: missing, answer: CONSENT_LABELS.grant }),
      authorization: authorizationFor(missing),
    });
    assert.equal(result.kind, 'not-inspected');
    if (result.kind === 'not-inspected') assert.equal(result.reason, 'missing');
  });

  it('refuses a symlinked root', async () => {
    const real = project();
    const parent = fs.mkdtempSync(nodePath.join(fs.realpathSync(os.tmpdir()), 'nid-pilot-link-'));
    created.push(parent);
    const link = nodePath.join(parent, 'link');
    fs.symlinkSync(real.root, link);

    const result = await runWorkspacePilot({
      ui: ui({ typed: link, answer: CONSENT_LABELS.grant }),
      authorization: authorizationFor(link),
    });
    assert.equal(result.kind, 'not-inspected');
    if (result.kind === 'not-inspected') assert.equal(result.reason, 'symlinked-root');
  });

  it('refuses when the approved root resolves somewhere else', async () => {
    // A symlinked ancestor makes the approved path resolve to a different
    // directory. Reading that directory would be reading something nobody
    // approved, so it must refuse before listing - not print "Resolved to:".
    const parent = fs.mkdtempSync(nodePath.join(fs.realpathSync(os.tmpdir()), 'nid-pilot-canon-'));
    created.push(parent);
    const real = nodePath.join(parent, 'realdir');
    fs.mkdirSync(nodePath.join(real, 'project'), { recursive: true });
    fs.writeFileSync(nodePath.join(real, 'project', 'package.json'), MANIFEST({ 'left-pad': '^1.3.0' }));
    fs.symlinkSync(real, nodePath.join(parent, 'link'));

    const approved = nodePath.join(parent, 'link', 'project');
    const { result, io } = await traceIo(() => runWorkspacePilot({
      ui: ui({ typed: approved, answer: CONSENT_LABELS.grant }),
      authorization: authorizationFor(approved),
    }));

    assert.equal(result.kind, 'not-inspected');
    if (result.kind !== 'not-inspected') return;
    assert.equal(result.reason, 'unexpected-canonical-root');
    assert.equal(io.lists, 0, 'the root must not be listed');
    assert.equal(io.opens, 0, 'no candidate may be opened');
  });

  it('refuses a root replaced with a symlink between consent and resolution', async () => {
    const real = project();
    const elsewhere = project({ 'README.md': README });
    const approved = nodePath.join(nodePath.dirname(real.root), 'swappable');
    fs.renameSync(real.root, approved);

    // The swap happens while consent is being answered: deterministic, no racing.
    const swappedUi: ModUi = {
      input: async () => approved,
      notify: () => {},
      select: async () => {
        fs.rmSync(approved, { recursive: true, force: true });
        fs.symlinkSync(elsewhere.root, approved);
        return CONSENT_LABELS.grant;
      },
      capabilities: { status: true, surface: true },
    };

    const { result, io } = await traceIo(() => runWorkspacePilot({
      ui: swappedUi,
      authorization: authorizationFor(approved),
    }));

    assert.equal(result.kind, 'not-inspected');
    if (result.kind !== 'not-inspected') return;
    assert.equal(result.reason, 'symlinked-root');
    assert.equal(io.opens, 0, 'nothing may be opened from the replacement');
  });
});

// ---------------------------------------------------------------------------
// Reading, limits and evidence
// ---------------------------------------------------------------------------

describe('pilot: bounded reading and honest evidence', () => {
  it('reports an empty workspace without claiming absence', async () => {
    const { root } = project({ 'unrelated.txt': 'nothing this policy reads' });
    const result = await runWorkspacePilot({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: authorizationFor(root),
    });

    assert.equal(result.kind, 'nothing-to-read');
    if (result.kind !== 'nothing-to-read') return;
    const rendered = renderWorkspacePilot(result);
    assert.match(rendered, /not evidence that the project lacks these files/);
  });

  it('refuses secret-like synthetic content', async () => {
    const fakeAws = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
    const { root } = project({
      'README.md': `token ${fakeAws} here\n`,
      'package.json': MANIFEST({ 'left-pad': '^1.3.0' }),
    });
    const result = await runWorkspacePilot({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: authorizationFor(root),
    });

    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    assert.ok(result.skipped.some((entry) => entry.path === 'README.md'));
    assert.ok(!result.files.some((file) => file.path === 'README.md'));
    assert.ok(!renderWorkspacePilot(result).includes(fakeAws));
  });

  it('refuses symlinked and non-regular candidate files', async () => {
    const { root } = project({ 'package.json': MANIFEST({ 'left-pad': '^1.3.0' }) });
    fs.symlinkSync(nodePath.join(root, 'package.json'), nodePath.join(root, 'README.md'));
    fs.mkdirSync(nodePath.join(root, 'AGENTS.md'));

    const result = await runWorkspacePilot({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: authorizationFor(root),
    });
    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    assert.ok(!result.files.some((file) => file.path === 'README.md'));
    assert.ok(!result.files.some((file) => file.path === 'AGENTS.md'));
    assert.ok(result.skipped.length >= 2);
  });

  it('keeps physical bytes at the bytes it keeps, and citations do not add reads', async () => {
    const { root } = project({
      'README.md': 'The quick brown fox jumps over the lazy dog. '.repeat(200),
      'package.json': MANIFEST({
        alpha: '1.0.0',
        beta: '1.0.0',
        gamma: '1.0.0',
        delta: '1.0.0',
      }),
    });

    const { result, io } = await traceIo(() => runWorkspacePilot({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: authorizationFor(root),
    }));

    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    const kept = result.files.reduce((sum, file) => sum + file.bytes, 0);
    assert.equal(io.bytes, kept, 'every physical byte must be one that was kept');
    assert.equal(io.opens, result.files.length, 'one open per kept file, none for the rest');
    assert.ok(io.bytes <= DEFAULT_BUDGET.maxTotalBytes);
    assert.equal(result.declarations.length, 2, 'the display cap still holds');
  });

  it('does not forge a citation when a file changes between listing and open', async () => {
    const { root } = project();
    const target = nodePath.join(fs.realpathSync(root), 'package.json');

    const saved = fsDefault.openSync;
    let grown = false;
    (fsDefault as unknown as Record<string, unknown>).openSync = (path: unknown, ...rest: unknown[]) => {
      if (!grown && String(path) === target) {
        grown = true;
        // `truncate` extends in place without going through the patched openSync,
        // so the mutation itself is not counted as pilot reading.
        fs.truncateSync(target, 4096);
      }
      return (saved as (...values: unknown[]) => number)(path, ...rest);
    };
    syncBuiltinESMExports();

    let result: PilotResult | undefined;
    try {
      result = await runWorkspacePilot({
        ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
        authorization: authorizationFor(root),
      });
    } finally {
      (fsDefault as unknown as Record<string, unknown>).openSync = saved;
      syncBuiltinESMExports();
    }

    assert.equal(grown, true, 'the growth must actually have been injected');
    assert.equal(result?.kind, 'inspected');
    if (result?.kind !== 'inspected') return;
    assert.equal(result.declarations.length, 0, 'a changed file must not yield a citation');
    assert.ok(result.skipped.some((entry) => entry.path === 'package.json'));
    assert.ok(result.evidenceGap !== undefined, 'the gap must be explained, not left blank');
  });

  it('writes nothing, anywhere', async () => {
    const { root } = project();
    const { io } = await traceIo(() => runWorkspacePilot({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: authorizationFor(root),
    }));
    assert.equal(io.writeOpens, 0, 'the pilot must never open a file for writing');
  });
});

// ---------------------------------------------------------------------------
// Rendering and the harness
// ---------------------------------------------------------------------------

describe('pilot: rendering and harness', () => {
  it('renders a refusal as idea-only continuation, not as a failure', async () => {
    const { root } = project();
    const result = await runWorkspacePilot({
      ui: ui({ typed: root, answer: CONSENT_LABELS.refuse }),
      authorization: authorizationFor(root),
    });
    const rendered = renderWorkspacePilot(result);
    assert.match(rendered, /nothing was read/i);
    assert.match(rendered, /works without repository context/);
  });

  it('carries every caveat into an inspected result', async () => {
    const { root } = project();
    const result = await runWorkspacePilot({
      ui: ui({ typed: root, answer: CONSENT_LABELS.grant }),
      authorization: authorizationFor(root),
    });
    assert.equal(result.kind, 'inspected');
    if (result.kind !== 'inspected') return;
    assert.equal(result.caveats.length, PILOT_CAVEATS.length);
    const rendered = renderWorkspacePilot(result);
    assert.match(rendered, /NOT VERIFIED/);
    assert.match(rendered, /NOT reliably prevented or detected/);
    assert.doesNotMatch(rendered, /detected, not prevented/);
  });

  it('the harness registers one command and mints its own fixture', async () => {
    const commands: Array<{ name: string; handler: (context: unknown) => unknown }> = [];
    const disposables: Array<{ dispose(): void }> = [];
    let storeTouched = false;

    const fakeCmd = {
      name: 'pilot-test',
      cwd: '/',
      ui: ui({}),
      store: {
        get: () => { storeTouched = true; return undefined; },
        set: async () => { storeTouched = true; },
        delete: async () => { storeTouched = true; },
      },
      addCommand: (command: { name: string; handler: (context: unknown) => unknown }) => {
        commands.push(command);
        const disposable = { dispose() {} };
        disposables.push(disposable);
        return disposable;
      },
    };

    pilotMod(fakeCmd as never);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].name, 'naildown-pilot');

    // Refusal path: no grant, and the fixture must not outlive the call.
    const typed: string[] = [];
    const context = {
      args: '',
      ui: {
        input: async () => { typed.push('asked'); return undefined; },
        notify: () => {},
        select: async () => undefined,
        capabilities: { status: true, surface: true },
      },
      cwd: '/',
    };

    const before = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('nid-pilot-mod-')).length;
    const rendered = await commands[0].handler(context) as { message: string };
    const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('nid-pilot-mod-')).length;

    assert.equal(typed.length, 1, 'the operator is asked for a root');
    assert.match(rendered.message, /nothing was read/i);
    assert.equal(after, before, 'the disposable fixture must be removed');
    assert.equal(storeTouched, false, 'the pilot must not touch M1 or any store');
  });

  it('shows the authorized root as a hint without accepting it', async () => {
    // The operator cannot guess a fixture path, so it is offered as a visible
    // placeholder. It is still only a hint: the typed value is what gets compared.
    let seen: { title: string; placeholder?: string } | undefined;
    const { root } = project();
    const result = await runWorkspacePilot({
      ui: {
        input: async (input) => {
          seen = input;
          return root;
        },
        notify: () => {},
        select: async () => CONSENT_LABELS.grant,
        capabilities: { status: true, surface: true },
      },
      authorization: authorizationFor(root),
    });
    assert.equal(seen?.placeholder, nodePath.resolve(root));
    assert.equal(result.kind, 'inspected');
  });

  it('asks for the root with the documented prompt', async () => {
    let seen: { title: string; placeholder?: string } | undefined;
    const result = await proposeWorkspaceRoot({
      input: async (input) => {
        seen = input;
        return '/tmp/example';
      },
      select: async () => undefined,
      capabilities: { status: true, surface: true },
    });
    assert.equal(seen?.title, PILOT_INPUT_TITLE);
    assert.equal(seen?.placeholder, PILOT_INPUT_PLACEHOLDER);
    assert.deepEqual(result, { ok: true, root: '/tmp/example' });
  });
});
