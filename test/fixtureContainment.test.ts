/**
 * M2-5C review correction: `mintWorkspace` must not write outside its fixture.
 *
 * The defect this pins: `writeFileSync(join(root, name), ...)` resolves `..`, so
 * a name like `'../outside.txt'` wrote to the fixture's *parent* and
 * `'../../escape.txt'` wrote outside the disposable directory entirely - which
 * `dispose()` only removes the parent of. A helper whose whole promise is "a
 * contained synthetic fixture" has to actually contain.
 *
 * Every negative case here uses a harmless, uniquely named file in the system
 * temp directory, and each test asserts the surrounding directory is unchanged
 * rather than merely that a throw happened. No real project is touched.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import { checkFixtureFilename, mintWorkspace } from '../src/host/syntheticIntegration.ts';

/** Canonical temp root, so a symlinked /var alias is not mistaken for an escape. */
const TEMP = fs.realpathSync(os.tmpdir());

/** Names that must never be accepted, each harmless if it ever were. */
const UNSAFE: Array<[string, string]> = [
  ['../nid-5c-outside-probe.txt', 'parent traversal'],
  ['../../nid-5c-escape-probe.txt', 'escapes the disposable parent'],
  ['../../../nid-5c-deep-probe.txt', 'deep traversal'],
  ['nested/nid-5c-inside-probe.txt', 'forward separator'],
  ['nested\\nid-5c-backslash-probe.txt', 'backslash separator'],
  ['/tmp/nid-5c-absolute-probe.txt', 'absolute POSIX path'],
  // A drive letter with no separator after it: absolute on Windows, and *not*
  // caught by the `/` or `\\` check, so this is what makes that guard load-bearing.
  ['C:nid-5c-drive-relative-probe.txt', 'Windows drive-relative'],
  ['C:/nid-5c-drive-probe.txt', 'Windows drive with separator (also a separator violation)'],
  ['\\\\server\\share\\nid-5c-unc-probe.txt', 'UNC path'],
  ['..', 'parent entry'],
  ['.', 'current entry'],
  ['', 'empty name'],
  ['   ', 'whitespace only'],
  ['~/.config/nid-5c-home-probe.txt', 'home-relative'],
  ['.nid-5c-dotfile-probe', 'leading dot creates a dotfile'],
  ['nid-5c\u0000nul-probe.txt', 'embedded NUL'],
  ['nid-5c\u001fcontrol-probe.txt', 'embedded control character'],
];

/** Names that are ordinary root-level files and must keep working. */
const SAFE = [
  'README.md',
  'package.json',
  'AGENTS.md',
  'unrelated.txt',
  'Cargo.toml',
  'go.mod',
  'tsconfig.json',
  'pyproject.toml',
  'a-very-long-but-ordinary-file-name.markdown',
  'file with spaces.txt',
  'file+plus.txt',
  'file_under_score.txt',
  'UPPER.MD',
];

const disposables: Array<{ dispose(): void }> = [];
after(() => {
  for (const workspace of disposables) workspace.dispose();
});

/** Snapshot of the temp root's entry names, so an escape is observable. */
function tempListing(): Set<string> {
  return new Set(fs.readdirSync(TEMP));
}

/**
 * Runs `body` with `TMPDIR` pointing at a private sandbox, so "nothing was
 * created" is a claim about a directory only this test owns.
 *
 * Necessary because `node --test` runs test *files* concurrently: a sibling
 * suite's live fixture would otherwise appear as residue and make the assertion
 * meaningless (it was, on the first attempt - the "leak" was another suite's
 * `nid-5c-*` directory). Isolation makes the property observable rather than
 * approximately true.
 */
function inPrivateTemp<T>(body: (sandbox: string) => T): T {
  const sandbox = fs.mkdtempSync(nodePath.join(TEMP, 'nid-5c-sandbox-'));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = sandbox;
  try {
    return body(sandbox);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    try {
      fs.rmSync(sandbox, { recursive: true, force: true });
    } catch {
      // Disposable.
    }
  }
}

describe('fixture containment: unsafe names are rejected', () => {
  it('rejects every unsafe name with a specific reason', () => {
    for (const [name, label] of UNSAFE) {
      const checked = checkFixtureFilename(name);
      assert.equal(checked.ok, false, `${label} (${JSON.stringify(name)}) must be rejected`);
      if (!checked.ok) {
        assert.equal(checked.name, name);
        assert.equal(typeof checked.reason, 'string');
        assert.ok(checked.reason.length > 0);
      }
    }
  });

  it('classifies the reasons, so a caller learns why rather than only that', () => {
    const reasonFor = (name: string): string => {
      const checked = checkFixtureFilename(name);
      return checked.ok ? 'accepted' : checked.reason;
    };
    assert.equal(reasonFor('../x.txt'), 'path-separator');
    assert.equal(reasonFor('a/b.txt'), 'path-separator');
    assert.equal(reasonFor('a\\b.txt'), 'path-separator');
    // POSIX-absolute is a separator violation: it contains `/`. Documented here
    // so the classification is deliberate rather than incidental.
    assert.equal(reasonFor('/tmp/x.txt'), 'path-separator');
    assert.equal(reasonFor('C:\\x.txt'), 'path-separator');
    // No separator: only the drive-prefix rule can catch this one.
    assert.equal(reasonFor('C:x.txt'), 'absolute');
    assert.equal(reasonFor('..'), 'self-or-parent');
    assert.equal(reasonFor('.'), 'self-or-parent');
    assert.equal(reasonFor(''), 'empty');
    assert.equal(reasonFor('   '), 'empty');
    assert.equal(reasonFor('~/.config/x'), 'path-separator');
    assert.equal(reasonFor('~x'), 'home-relative');
    assert.equal(reasonFor('.env'), 'dotfile');
    assert.equal(reasonFor('a\u0000b'), 'control-character');
  });

  it('accepts ordinary root-level filenames', () => {
    for (const name of SAFE) {
      assert.equal(checkFixtureFilename(name).ok, true, `${JSON.stringify(name)} must be accepted`);
    }
  });

  it('rejects a non-string key rather than coercing it', () => {
    for (const bad of [42, null, undefined, {}, ['a.txt']]) {
      assert.equal(checkFixtureFilename(bad).ok, false, `${String(bad)} must be rejected`);
    }
  });
});

describe('fixture containment: nothing is created or written', () => {
  it('refuses before creating anything when any name is unsafe', () => {
    inPrivateTemp((sandbox) => {
      for (const [name, label] of UNSAFE) {
        assert.throws(
          () => mintWorkspace({ 'README.md': '# ok\n', [name]: 'probe' }),
          /not allowed/,
          `${label} (${JSON.stringify(name)}) must be refused`,
        );
      }
      // Validation precedes creation, so the private temp root is still empty.
      assert.deepEqual(fs.readdirSync(sandbox), [], 'a rejection must not create a fixture directory');
    });
  });

  it('writes nothing outside the fixture for any unsafe name', () => {
    // Two independent proofs: no probe path exists anywhere, and the private temp
    // root is untouched after every escape attempt.
    const probeNames = [
      'nid-5c-outside-probe.txt',
      'nid-5c-escape-probe.txt',
      'nid-5c-deep-probe.txt',
      'nid-5c-absolute-probe.txt',
    ];

    inPrivateTemp((sandbox) => {
      for (const [name] of UNSAFE) {
        try {
          const workspace = mintWorkspace({ [name]: 'probe' });
          workspace.dispose();
          assert.fail(`mintWorkspace accepted the unsafe name ${JSON.stringify(name)}`);
        } catch (error) {
          assert.match(String(error), /not allowed/, `unexpected error for ${JSON.stringify(name)}`);
        }
      }
      assert.deepEqual(fs.readdirSync(sandbox), [], 'no residue of any kind may remain');
    });

    // And the exact names that would have escaped do not exist in the real temp
    // tree, one level up from where `../` would have landed, or two.
    for (const probe of probeNames) {
      assert.equal(fs.existsSync(nodePath.join(TEMP, probe)), false, `${probe} must not exist`);
      assert.equal(fs.existsSync(nodePath.join(TEMP, '..', probe)), false, `${probe} must not exist one level up`);
    }
  });

  it('validates the whole set before writing any of it', () => {
    // A safe name first, an unsafe name second: the safe one must not be written
    // either, because validation precedes creation.
    inPrivateTemp((sandbox) => {
      assert.throws(
        () => mintWorkspace({ 'README.md': '# ok\n', '../nid-5c-ordering-probe.txt': 'probe' }),
        /not allowed/,
      );
      assert.deepEqual(fs.readdirSync(sandbox), [], 'nothing may be created');
    });
    assert.equal(fs.existsSync(nodePath.join(TEMP, 'nid-5c-ordering-probe.txt')), false);
  });
});

describe('fixture containment: valid fixtures still work', () => {
  it('mints the default fixture and writes exactly its three files', () => {
    const workspace = mintWorkspace();
    disposables.push(workspace);
    assert.deepEqual(fs.readdirSync(workspace.root).sort(), ['AGENTS.md', 'README.md', 'package.json']);
    for (const name of ['AGENTS.md', 'README.md', 'package.json']) {
      assert.equal(fs.existsSync(nodePath.join(workspace.root, name)), true);
    }
  });

  it('mints a custom fixture including the review-mentioned unrelated.txt', () => {
    const workspace = mintWorkspace({ 'unrelated.txt': 'nothing this policy reads', 'package.json': '{}' });
    disposables.push(workspace);
    assert.deepEqual(fs.readdirSync(workspace.root).sort(), ['package.json', 'unrelated.txt']);
    assert.equal(fs.readFileSync(nodePath.join(workspace.root, 'unrelated.txt'), 'utf8'), 'nothing this policy reads');
  });

  it('accepts every safe name in one fixture', () => {
    const files = Object.fromEntries(SAFE.map((name) => [name, `content of ${name}`]));
    const workspace = mintWorkspace(files);
    disposables.push(workspace);
    assert.deepEqual(fs.readdirSync(workspace.root).sort(), [...SAFE].sort());
    for (const name of SAFE) {
      assert.equal(fs.readFileSync(nodePath.join(workspace.root, name), 'utf8'), `content of ${name}`);
    }
  });

  it('keeps the root a direct child of its own disposable parent', () => {
    const workspace = mintWorkspace();
    disposables.push(workspace);
    assert.equal(nodePath.dirname(workspace.root), workspace.parent);
    assert.equal(workspace.root.startsWith(`${TEMP}${nodePath.sep}`), true, 'the fixture lives under the temp root');
  });

  it('disposes only its own directory', () => {
    const keep = fs.mkdtempSync(nodePath.join(TEMP, 'nid-5c-keep-'));
    try {
      const workspace = mintWorkspace();
      workspace.dispose();
      assert.equal(fs.existsSync(workspace.parent), false, 'the fixture is gone');
      assert.equal(fs.existsSync(keep), true, 'an unrelated directory survives');
    } finally {
      fs.rmSync(keep, { recursive: true, force: true });
    }
  });
});
