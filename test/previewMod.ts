/**
 * A disposable, test-only Command Code mod for M2 Slice 3A.
 *
 * Loaded with `cmd --mod test/previewMod.ts` and never installed, never imported
 * by `src/index.ts`, and never registered by the real `/naildown` mod.
 *
 * The synthetic project is minted here, in this process, inside its own
 * `mkdtemp` parent. That is the whole point: the read root is *not* `cmd.cwd`,
 * not a slash argument, not an environment variable and not anything stored, so
 * there is no input by which a caller could point the preview at a real
 * repository.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModApi } from '../src/host/modApi.ts';
import { renderPreview, runRepositoryPreview } from '../src/host/repositoryPreview.ts';

const README = [
  '# Tenant reminder API (synthetic)',
  '',
  'This file exists only to be read by the M2 Slice 3A preview fixture.',
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

/**
 * Mints the synthetic project and returns both paths.
 *
 * Created per invocation so the fixture exists for exactly as long as the read
 * that uses it, and so cleanup is a `finally` rather than an exit hook that may
 * never run.
 *
 * It lives under `os.tmpdir()`, which is the correct place for a disposable
 * fixture — but it does mean the host process needs a usable temp directory. A
 * probe run under an ephemeral `TMPDIR` that is deleted between calls fails
 * here with ENOENT, which is why this returns a result instead of throwing.
 */
function createFixture(): { ok: true; parent: string; root: string } | { ok: false } {
  try {
    const parent = mkdtempSync(join(tmpdir(), 'nid-preview-mod-'));
    const root = join(parent, 'project');
    mkdirSync(root);
    writeFileSync(join(root, 'README.md'), README);
    writeFileSync(join(root, 'package.json'), PACKAGE_JSON);
    return { ok: true, parent, root };
  } catch {
    // No path or OS text is surfaced: this is a test mod, and the failure is
    // simply "the fixture could not be created".
    return { ok: false };
  }
}

export default function previewMod(cmd: ModApi): void {
  cmd.addCommand({
    name: 'naildown-preview',
    description: 'Preview repository evidence from a disposable synthetic project (test mod)',
    handler: async ({ ui }) => {
      const fixture = createFixture();
      if (!fixture.ok) {
        return {
          message: [
            'Repository preview — not started',
            '',
            'The disposable preview project could not be created, so nothing was read.',
            'This is the fail-closed path: no repository content is touched without an owned fixture.',
          ].join('\n'),
        };
      }
      try {
        const result = await runRepositoryPreview({
          ui,
          root: fixture.root,
          permittedParent: fixture.parent,
        });
        return { message: renderPreview(result) };
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
