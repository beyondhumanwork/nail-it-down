/**
 * Workspace identity.
 *
 * `cmd.store` is one JSON file per mod (`~/.commandcode/mods/.store/<mod>.json`), shared by every
 * workspace, so isolation has to come from the key. The key is the host-provided `cwd`, normalized
 * only enough to make obvious spellings agree. No filesystem access: the path is taken as given,
 * which means a symlinked path and its target are separate workspaces. That is documented in
 * docs/M0_EVIDENCE.md rather than guessed at.
 */

export const UNKNOWN_WORKSPACE = '<unknown-workspace>';

export function workspaceKeyFrom(cwd: unknown): string {
  if (typeof cwd !== 'string') return UNKNOWN_WORKSPACE;

  const collapsed = cwd.trim().replace(/\\/g, '/');
  if (collapsed === '') return UNKNOWN_WORKSPACE;

  // Keep a single leading slash for the filesystem root; strip every other trailing slash.
  const withoutTrailing = collapsed.replace(/\/+$/, '');
  return withoutTrailing === '' ? '/' : withoutTrailing;
}
