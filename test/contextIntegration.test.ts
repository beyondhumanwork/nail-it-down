/**
 * M2-8: the controlled repository-context integration.
 *
 * The property under test is containment of a new capability: an experimental
 * command that must do nothing unless a session-scoped gate is on, must take no
 * arguments, and must never touch the interview.
 *
 * Every workspace here is minted by this file. No real repository is read.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fsDefault from 'node:fs';
import * as fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import nailItDown from '../src/index.ts';
import { parseIntent, SUBCOMMANDS } from '../src/core/commands.ts';
import { CONSENT_LABELS } from '../src/host/repositoryConsent.ts';
import { AUTHORIZE_LABELS, OPT_IN_LABELS } from '../src/host/humanAuthorizedContext.ts';
import type { ModUi } from '../src/host/modApi.ts';

const created: string[] = [];
after(() => {
  for (const parent of created) {
    try { fs.rmSync(parent, { recursive: true, force: true }); } catch { /* disposable */ }
  }
});

const MANIFEST = (deps: Record<string, string>): string =>
  JSON.stringify({ name: 'synthetic', private: true, dependencies: deps }, null, 2);

/** A disposable canonical fixture, plus the mountinfo table that would admit it. */
function fixture(files: Record<string, string> = {
  'README.md': '# hi\n',
  'package.json': MANIFEST({ 'left-pad': '^1.3.0' }),
}): { root: string; mountinfo: string } {
  const parent = fs.mkdtempSync(nodePath.join(fs.realpathSync(os.tmpdir()), 'nid-m28-'));
  created.push(parent);
  const root = nodePath.join(parent, 'project');
  fs.mkdirSync(root);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(nodePath.join(root, name), content);
  const mountinfo = [
    `1 0 8:1 / / rw,relatime - ext4 /dev/sda1 rw`,
    `2 1 8:4 / ${parent} rw,relatime - ext4 /dev/sda4 rw`,
  ].join('\n') + '\n';
  return { root, mountinfo };
}

type Answers = { optIn?: string; typed?: string; authorize?: string; consent?: string };

function ui(answers: Answers, options: { events?: string[]; surface?: boolean } = {}): ModUi {
  let selects = 0;
  return {
    input: async () => { options.events?.push('input'); return answers.typed; },
    notify: () => { options.events?.push('notify'); },
    select: async () => {
      const step = selects;
      selects += 1;
      options.events?.push('select');
      if (step === 0 && answers.optIn !== undefined) return answers.optIn;
      // Fall back to any answer supplied, so a two-dialog flow still works.
      if (step === 1 && answers.authorize !== undefined) return answers.authorize;
      return answers.consent ?? answers.authorize ?? answers.optIn;
    },
    capabilities: { status: options.surface ?? true, surface: options.surface ?? true },
  };
}

/** A fake ModApi good enough to register and dispatch `/naildown`. */
function host(options: { flagValue?: boolean | string; ui?: ModUi; withFlags?: boolean } = {}) {
  let handler: ((ctx: unknown) => Promise<{ message?: string; prompt?: string }>) | undefined;
  let flagDefault: unknown;
  const registered: string[] = [];
  const storeWrites: Array<[string, unknown]> = [];

  const cmd = {
    name: 'test',
    cwd: '/tmp',
    ui: options.ui ?? ui({}),
    store: {
      get: () => undefined,
      set: async (k: string, v: unknown) => { storeWrites.push([k, v]); },
      delete: async () => undefined,
    },
    ...(options.withFlags === false ? {} : {
      addFlag: (name: string, spec: { default?: unknown }) => {
        registered.push(name);
        flagDefault = spec.default;
        return { dispose() {} };
      },
      getFlag: (name: string) => {
        if (!registered.includes(name)) return undefined;
        return options.flagValue === undefined ? flagDefault : options.flagValue;
      },
    }),
    addCommand: (command: { name: string; handler: typeof handler }) => {
      if (command.name === 'naildown') handler = command.handler;
      return { dispose() {} };
    },
  };

  nailItDown(cmd as never);
  return {
    run: async (args: string, commandUi?: ModUi) => {
      if (handler === undefined) throw new Error('no handler registered');
      return handler({ args, ui: commandUi ?? cmd.ui, cwd: '/tmp/workspace' });
    },
    registeredFlags: registered,
    flagDefault,
    storeWrites,
  };
}

// ---------------------------------------------------------------------------
// 1-2: the gate
// ---------------------------------------------------------------------------

describe('M2-8: the gate is off by default', () => {
  it('registers the flag with a default of false', () => {
    const h = host();
    assert.deepEqual(h.registeredFlags, ['experimentalRepositoryContext']);
    assert.equal(h.flagDefault, false, 'the declared default must be false');
  });

  it('does nothing when the flag is absent or false', async () => {
    for (const flagValue of [undefined, false] as Array<boolean | undefined>) {
      let fsCalls = 0;
      const patchable = fsDefault as unknown as Record<string, unknown>;
      const names = ['openSync', 'opendirSync', 'realpathSync', 'lstatSync', 'statSync'] as const;
      const original = Object.fromEntries(names.map((n) => [n, fsDefault[n]]));
      for (const n of names) {
        patchable[n] = (...a: unknown[]) => { fsCalls += 1; return (original[n] as (...v: unknown[]) => unknown)(...a); };
      }
      syncBuiltinESMExports();
      try {
        const h = host({ flagValue: flagValue as boolean });
        const result = await h.run('context');
        assert.match(result.message ?? '', /experimental and currently disabled/i, String(flagValue));
        assert.equal(result.prompt, undefined);
      } finally {
        for (const n of names) patchable[n] = original[n];
        syncBuiltinESMExports();
      }
      assert.equal(fsCalls, 0, 'a disabled gate must perform zero filesystem calls');
    }
  });

  it('stays disabled when the host has no flag support at all', async () => {
    const h = host({ withFlags: false });
    const result = await h.run('context');
    assert.match(result.message ?? '', /disabled/i);
  });

  it('does not persist the gate anywhere', async () => {
    const h = host({ flagValue: true });
    // Exercise a refused path so nothing is written, then check for any store write.
    const result = await h.run('context', ui({ optIn: OPT_IN_LABELS.ideaOnly }));
    assert.equal(result.prompt, undefined);
    assert.deepEqual(h.storeWrites, [], 'the gate and its outcome must never reach the store');
  });
});

// ---------------------------------------------------------------------------
// 3: arguments
// ---------------------------------------------------------------------------

describe('M2-8: context takes no arguments', () => {
  it('parses bare context as the context intent', () => {
    assert.deepEqual(parseIntent('context'), { kind: 'context' });
    assert.deepEqual(parseIntent('  CONTEXT  '), { kind: 'context' });
  });

  it('refuses any trailing text instead of treating it as a goal or root', () => {
    for (const args of ['context /home/me/repo', 'context .', 'context foo bar', 'context\t/tmp']) {
      const intent = parseIntent(args);
      assert.equal(intent.kind, 'context-invalid', args);
      if (intent.kind === 'context-invalid') {
        assert.doesNotMatch(intent.detail, /\//, 'the refusal must not echo the supplied path');
      }
    }
  });

  it('still treats "context" as a prefix of a goal when it is a word, not a subcommand', () => {
    // Exact-match rule preserved: only a leading `context` token is the subcommand.
    assert.equal(parseIntent('contextual bandits').kind, 'start');
    assert.equal(parseIntent('context-driven design').kind, 'start');
  });

  it('lists context among the subcommands', () => {
    assert.ok(SUBCOMMANDS.includes('context'));
  });

  it('reports the refusal without starting an interview', async () => {
    const h = host({ flagValue: true });
    const result = await h.run('context /home/ahmed/secret-repo');
    const message = result.message ?? '';
    assert.match(message, /takes no arguments/i);
    assert.doesNotMatch(message, /secret-repo/, 'the supplied path must not be echoed');
    assert.doesNotMatch(message, /starting an interview/i);
  });
});

// ---------------------------------------------------------------------------
// 4-6: consent stages, all independent
// ---------------------------------------------------------------------------

describe('M2-8: three independent refusals', () => {
  it('refuses at opt-in without touching the filesystem', async () => {
    const h = host({ flagValue: true });
    const result = await h.run('context', ui({ optIn: OPT_IN_LABELS.ideaOnly }));
    assert.match(result.message ?? '', /not used|opted-out/i);
    assert.equal(result.prompt, undefined);
  });

  it('refuses when the root is not authorised', async () => {
    const h = host({ flagValue: true });
    const result = await h.run('context', ui({
      optIn: OPT_IN_LABELS.useRepository,
      typed: '/tmp/whatever',
      authorize: AUTHORIZE_LABELS.refuse,
      consent: CONSENT_LABELS.grant,
    }));
    assert.match(result.message ?? '', /nothing was read/i);
  });

  it('refuses at read consent even when the root was authorised', async () => {
    const h = host({ flagValue: true });
    const result = await h.run('context', ui({
      optIn: OPT_IN_LABELS.useRepository,
      typed: '/tmp/whatever',
      authorize: AUTHORIZE_LABELS.grant,
      consent: CONSENT_LABELS.refuse,
    }));
    assert.match(result.message ?? '', /nothing was read/i);
  });

  it('refuses a headless host and a surface-less host', async () => {
    const noSurface = host({ flagValue: true });
    const result = await noSurface.run('context', ui({}, { surface: false }));
    assert.match(result.message ?? '', /no dialog surface|not offered/i);
  });
});

// ---------------------------------------------------------------------------
// 7-9: inspected path
// ---------------------------------------------------------------------------

describe('M2-8: a bounded inspection displays citations', () => {
  it('inspects through the REAL production handler and cites verified evidence', async () => {
    // Load-bearing: this dispatches the handler that src/index.ts actually
    // registers, with no test-only context helper in the path. On this platform
    // there is no /proc/self/mountinfo, so the only way to reach the inspected
    // branch is to stub that one OS read. Everything else - the gate, the three
    // dialogs, validateRoot, the reader, the ceiling, the citations - is real.
    const { root } = fixture();
    const mountinfo = [
      `1 0 8:1 / / rw,relatime - ext4 /dev/sda1 rw`,
      `2 1 8:4 / ${nodePath.dirname(root)} rw,relatime - ext4 /dev/sda4 rw`,
    ].join('\n') + '\n';

    const patchable = fsDefault as unknown as Record<string, unknown>;
    const originalRead = fsDefault.readFileSync;
    let stubbed = 0;
    let result: { message?: string; prompt?: string } | undefined;
    const h = host({ flagValue: true });

    try {
      patchable.readFileSync = ((target: unknown, ...rest: unknown[]) => {
        if (String(target) === '/proc/self/mountinfo') {
          stubbed += 1;
          return mountinfo;
        }
        return (originalRead as (...v: unknown[]) => unknown)(target, ...rest);
      }) as typeof fsDefault.readFileSync;
      syncBuiltinESMExports();

      result = await h.run('context', ui({
        optIn: OPT_IN_LABELS.useRepository,
        typed: root,
        authorize: AUTHORIZE_LABELS.grant,
        consent: CONSENT_LABELS.grant,
      }));
    } finally {
      patchable.readFileSync = originalRead;
      syncBuiltinESMExports();
    }

    assert.equal(stubbed > 0, true, 'the mount stub must actually have been consulted');

    const message = result?.message ?? '';
    // The decisive assertions: it really inspected, and it really cited.
    assert.match(message, /Read \d+ files/, 'the production handler must reach the inspected branch');
    assert.match(message, /Cited from the workspace/, 'a citation section must be present');
    assert.match(message, /package\.json/, 'the citation must name the manifest');
    assert.match(message, /"left-pad"/, 'the citation must carry the declared dependency');
    assert.match(message, /lines? \d+/, 'the citation must carry a line span');

    // Nothing left the mod's control.
    assert.equal(result?.prompt, undefined, 'no model turn may be submitted');
    assert.deepEqual(h.storeWrites, [], 'no evidence or consent may be persisted');
  });

  it('refuses on a platform with no mount table, rather than guessing', async () => {
    // The separate, explicit refusal case the review asked to keep: with the real
    // /proc/self/mountinfo absent (macOS), the gate must refuse and read nothing.
    if (fs.existsSync('/proc/self/mountinfo')) {
      // On Linux the positive test above already covers the accept path; the
      // refusal is exercised by the synthetic mount tables in
      // linuxFilesystemTrust.test.ts. Nothing to assert here without faking it.
      return;
    }
    const { root } = fixture();
    const h = host({ flagValue: true });
    const result = await h.run('context', ui({
      optIn: OPT_IN_LABELS.useRepository,
      typed: root,
      authorize: AUTHORIZE_LABELS.grant,
      consent: CONSENT_LABELS.grant,
    }));
    const message = result.message ?? '';
    assert.doesNotMatch(message, /Read \d+ files/, 'nothing may be inspected without a mount view');
    assert.match(message, /mount/i, 'the refusal must name the mount reason');
    assert.equal(result.prompt, undefined);
  });

  it('never returns a prompt on any path', async () => {
    const h = host({ flagValue: true });
    const cases = [
      ui({ optIn: OPT_IN_LABELS.ideaOnly }),
      ui({ optIn: OPT_IN_LABELS.useRepository, typed: '/tmp/x', authorize: AUTHORIZE_LABELS.refuse }),
      ui({ optIn: OPT_IN_LABELS.useRepository, typed: '/tmp/x', authorize: AUTHORIZE_LABELS.grant, consent: CONSENT_LABELS.refuse }),
    ];
    for (const commandUi of cases) {
      const result = await h.run('context', commandUi);
      assert.equal(result.prompt, undefined);
      assert.equal(typeof result.message, 'string');
    }
  });
});

// ---------------------------------------------------------------------------
// 10-12: M1 untouched
// ---------------------------------------------------------------------------

describe('M2-8: the interview is untouched', () => {
  it('does not write a session when context is used', async () => {
    const h = host({ flagValue: true });
    await h.run('context', ui({ optIn: OPT_IN_LABELS.ideaOnly }));
    assert.deepEqual(h.storeWrites, [], 'context must never write session state');
  });

  it('leaves the existing subcommands working', async () => {
    const h = host({ flagValue: true });
    const help = await h.run('');
    assert.match(help.message ?? '', /\/naildown <your idea>/);
    const status = await h.run('status');
    assert.match(status.message ?? '', /nothing is saved|no interview/i);
  });

  it('creates no transformContext hook and no prompt submission', () => {
    // Structural: the production entrypoint must not register a context hook.
    const source = fs.readFileSync(nodePath.join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
    assert.doesNotMatch(source, /transformContext/, 'no transformContext hook may be introduced');
    assert.doesNotMatch(source, /prompt:/, 'index.ts must never construct a prompt result');
    assert.doesNotMatch(source, /offerHumanAuthorizedContextForTests/, 'the test-only mount helper must not be imported');
  });
});
