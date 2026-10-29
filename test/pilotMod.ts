/**
 * A disposable, test-only Command Code mod for M2 Slice 3B2.
 *
 * Loaded with `cmd --mod test/pilotMod.ts` and never installed, never imported by
 * `src/index.ts`, and never registered by the real `/naildown` mod.
 *
 * The synthetic workspace is minted here, in this process, inside its own
 * `mkdtemp` parent, and the *only* authorization this invocation receives names
 * that directory. The root is not `cmd.cwd`, not a slash argument, not an
 * environment variable and not anything stored — so there is no input by which a
 * caller could point the pilot at a real repository. A path the operator types
 * that is not exactly this fixture is refused before a single filesystem call
 * touches it.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModApi } from '../src/host/modApi.ts';
import { renderWorkspacePilot, runWorkspacePilot } from '../src/host/workspacePilot.ts';

const README = [
  '# Tenant reminder API (synthetic)',
  '',
  'This file exists only to be read by the M2 Slice 3B2 pilot fixture.',
  'It contains no project data and no instructions are followed from it.',
].join('\n');

const PACKAGE_JSON = JSON.stringify({
  name: 'synthetic-tenant-reminders',
  private: true,
  dependencies: {
    'left-pad': '^1.3.0',
  },
  devDependencies: {
    'tiny-invariant': '^1.3.1',
  },
}, null, 2);

type FixtureResult =
  | { ok: true; parent: string; root: string }
  /** `cleanupFailed` means the parent may still be on disk. No path is returned. */
  | { ok: false; cleanupFailed: boolean };

/**
 * Mints the synthetic workspace for exactly one invocation.
 *
 * The parent is tracked from the moment `mkdtemp` returns, so a failure part-way
 * through population cannot leave a temporary directory behind, and a failed
 * cleanup reports that something may remain without saying where.
 */
function createFixture(): FixtureResult {
  let parent: string | undefined;
  try {
    parent = mkdtempSync(join(tmpdir(), 'nid-pilot-mod-'));
    const root = join(parent, 'project');
    mkdirSync(root);
    writeFileSync(join(root, 'README.md'), README);
    writeFileSync(join(root, 'package.json'), PACKAGE_JSON);
    return { ok: true, parent, root };
  } catch {
    if (parent === undefined) return { ok: false, cleanupFailed: false };
    try {
      // Only the directory this invocation created is removed.
      rmSync(parent, { recursive: true, force: true });
      return { ok: false, cleanupFailed: false };
    } catch {
      return { ok: false, cleanupFailed: true };
    }
  }
}

export default function pilotMod(cmd: ModApi): void {
  cmd.addCommand({
    name: 'naildown-pilot',
    description: 'Workspace pilot against a disposable synthetic project (test mod)',
    handler: async ({ ui }) => {
      const fixture = createFixture();
      if (!fixture.ok) {
        const lines = [
          'Workspace pilot — not started',
          '',
          'The disposable synthetic workspace could not be created, so nothing was read.',
          'This is the fail-closed path: no workspace is touched without a fixture this harness owns.',
        ];
        if (fixture.cleanupFailed) {
          lines.push('A partially created temporary directory may remain under the system temp directory.');
        }
        return { message: lines.join('\n') };
      }
      try {
        const result = await runWorkspacePilot({
          ui,
          // The authorization is minted here and names only the directory just
          // created. Nothing else can authorize a read.
          authorization: { root: fixture.root, issuedBy: 'test/pilotMod.ts synthetic fixture' },
        });
        return { message: renderWorkspacePilot(result) };
      } finally {
        // Deterministic cleanup: the fixture never outlives the invocation.
        try {
          rmSync(fixture.parent, { recursive: true, force: true });
        } catch {
          // Best effort; it is a disposable directory under the temp root.
        }
      }
    },
  });
}
