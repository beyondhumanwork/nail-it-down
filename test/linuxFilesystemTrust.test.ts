/**
 * M2-6 Stage 2: Linux local-filesystem trust policy.
 *
 * The property under test: `verifyHumanRootPreconditions` decides localness from
 * a **narrow Linux allowlist** read out of `/proc/self/mountinfo`, and refuses
 * everything it cannot classify. It is not a "not-network" denylist, so an
 * unfamiliar type is refused rather than admitted by omission.
 *
 * Every fixture root here is minted and removed by this file. No real project is
 * inspected, and the injected tables are synthetic.
 *
 * WHAT THIS DOES NOT CLAIM
 *
 * A classification is not containment. A bind mount of an ext4 filesystem
 * presents the same type and passes; so does a local filesystem being mutated
 * concurrently. Those stay documented residuals under Option A.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import {
  LINUX_LOCAL_FILESYSTEMS,
  NETWORK_FILESYSTEMS,
  decodeMountField,
  parseMountInfo,
  verifyHumanRootPreconditions,
} from '../src/host/humanAuthorizedContext.ts';

const created: string[] = [];
after(() => {
  for (const parent of created) {
    try { fs.rmSync(parent, { recursive: true, force: true }); } catch { /* disposable */ }
  }
});

/** A disposable fixture root, canonical so no alias confuses the checks. */
function fixture(): string {
  const parent = fs.mkdtempSync(nodePath.join(fs.realpathSync(os.tmpdir()), 'nid-m26-fs-'));
  created.push(parent);
  const root = nodePath.join(parent, 'project');
  fs.mkdirSync(root);
  return root;
}

/** Builds one mountinfo line. */
function entry(opts: {
  id?: number;
  parent?: number;
  root?: string;
  point: string;
  fstype: string;
  source?: string;
  optional?: string;
}): string {
  const optional = opts.optional === undefined ? '' : ` ${opts.optional}`;
  return `${opts.id ?? 1} ${opts.parent ?? 0} 8:1 ${opts.root ?? '/'} ${opts.point} rw,relatime${optional} - ${opts.fstype} ${opts.source ?? '/dev/sda1'} rw`;
}

/** A table where `root` lives on `fstype`, covered by `/` and its parent. */
function table(root: string, fstype: string): string {
  return [
    entry({ id: 1, point: '/', fstype: 'ext4' }),
    entry({ id: 2, parent: 1, point: nodePath.dirname(root), fstype }),
  ].join('\n') + '\n';
}

const decision = (root: string, mountTable: string | null) =>
  verifyHumanRootPreconditions(root, { mountTable });

describe('filesystem policy: local filesystems are accepted', () => {
  it('accepts each allowlisted local type', () => {
    for (const fstype of LINUX_LOCAL_FILESYSTEMS) {
      const root = fixture();
      const result = decision(root, table(root, fstype));
      assert.equal(result.ok, true, `${fstype} should be accepted, got ${JSON.stringify(result)}`);
    }
  });

  it('the allowlist contains no known network type', () => {
    for (const network of NETWORK_FILESYSTEMS) {
      assert.equal(LINUX_LOCAL_FILESYSTEMS.includes(network), false, `${network} must not be allowlisted`);
    }
  });
});

describe('filesystem policy: network and distributed types are refused', () => {
  it('refuses each known network filesystem as not-acceptable', () => {
    for (const fstype of NETWORK_FILESYSTEMS) {
      const root = fixture();
      const result = decision(root, table(root, fstype));
      assert.equal(result.ok, false, `${fstype} must be refused`);
      if (!result.ok) assert.equal(result.reason, 'mount-not-acceptable', fstype);
    }
  });

  it('refuses FUSE transports including sshfs', () => {
    for (const fstype of ['fuse', 'fuse.sshfs', 'fuse.rclone', 'fuse.s3fs', 'fuseblk']) {
      const root = fixture();
      const result = decision(root, table(root, fstype));
      assert.equal(result.ok, false, `${fstype} must be refused`);
      // fuse is not on the network list, so it refuses as unclassifiable rather
      // than not-acceptable. Both refuse; the distinction is only informative.
      if (!result.ok) assert.match(result.reason, /mount-not-acceptable|mount-unverifiable/);
    }
  });
});

describe('filesystem policy: unknown types are refused, not admitted', () => {
  it('refuses a filesystem type nobody enumerated', () => {
    const root = fixture();
    for (const fstype of ['zfs', 'reiserfs', 'bcachefs', 'some-future-type', 'vfat', 'ntfs3', 'exfat']) {
      const result = decision(root, table(root, fstype));
      assert.equal(result.ok, false, `${fstype} must be refused as unclassifiable`);
      if (!result.ok) assert.equal(result.reason, 'mount-unverifiable', fstype);
    }
  });

  it('refuses an entry with no filesystem type at all', () => {
    const root = fixture();
    // No `-` separator: the type field is absent.
    const malformed = `1 0 8:1 / ${nodePath.dirname(root)} rw,relatime\n`;
    const result = decision(root, malformed);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'mount-unverifiable');
  });

  it('refuses tmpfs even though it is "local"', () => {
    // tmpfs is kernel-local but a RAM filesystem: contents vanish, and a
    // workspace there is not a stable thing to have consented to.
    const root = fixture();
    const result = decision(root, table(root, 'tmpfs'));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'mount-unverifiable');
  });

  it('refuses overlay, whose lower layers can be remote', () => {
    const root = fixture();
    const result = decision(root, table(root, 'overlay'));
    assert.equal(result.ok, false);
  });
});

describe('filesystem policy: mount structure is checked', () => {
  it('selects the deepest covering mount, not the outermost', () => {
    const root = fixture();
    // `/` says ext4; a deeper mount over the parent says nfs. The deeper one wins.
    const mixed = [
      entry({ id: 1, point: '/', fstype: 'ext4' }),
      entry({ id: 2, parent: 1, point: nodePath.dirname(root), fstype: 'nfs4' }),
    ].join('\n') + '\n';
    const result = decision(root, mixed);
    assert.equal(result.ok, false, 'the deeper nfs mount must decide, not the ext4 root');
    if (!result.ok) assert.equal(result.reason, 'mount-not-acceptable');
  });

  it('refuses when the root is itself a mount point', () => {
    const root = fixture();
    const over = [
      entry({ id: 1, point: '/', fstype: 'ext4' }),
      entry({ id: 2, parent: 1, point: root, fstype: 'ext4' }),
    ].join('\n') + '\n';
    const result = decision(root, over);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'root-is-a-mount-point');
  });

  it('refuses an empty table', () => {
    const result = decision(fixture(), '');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'mount-unverifiable');
  });

  it('refuses when no table is available at all', () => {
    const result = decision(fixture(), null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'mount-unverifiable');
  });

  it('refuses malformed lines rather than skipping into a false pass', () => {
    const root = fixture();
    // A malformed record could be the deeper mount, so its presence is a refusal
    // even alongside a well-formed shallower entry. Accepting the valid `/` line
    // while discarding the garbage is precisely how a deeper nfs mount would hide.
    const mixed = `garbage\n${entry({ id: 1, point: '/', fstype: 'ext4' })}\n`;
    const result = decision(root, mixed);
    assert.equal(result.ok, false, 'a malformed record must refuse, not be skipped');
    if (!result.ok) assert.equal(result.reason, 'mount-unverifiable');
  });

  it('refuses a table containing only malformed lines', () => {
    const result = decision(fixture(), 'garbage\nmore garbage\n');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'mount-unverifiable');
  });
});

describe('filesystem policy: stacked mounts at one path are ambiguous', () => {
  /**
   * Two mounts at the same point, as Linux produces when one filesystem is
   * mounted over another. Per proc(5) the top-most is the one that is not the
   * parent of any other at that location - so "last line wins" is wrong, and this
   * gate refuses rather than resolving topology.
   */
  const stacked = (root: string, order: 'ext4-first' | 'nfs-first'): string => {
    const parent = nodePath.dirname(root);
    const ext4 = entry({ id: 10, parent: 1, point: parent, fstype: 'ext4', source: '/dev/sda4' });
    const nfs = entry({ id: 11, parent: 10, point: parent, fstype: 'nfs4', source: 'server:/export' });
    const rootEntry = entry({ id: 1, point: '/', fstype: 'ext4' });
    const stackedLines = order === 'ext4-first' ? [ext4, nfs] : [nfs, ext4];
    return [rootEntry, ...stackedLines].join('\n') + '\n';
  };

  it('refuses an ext4/nfs4 stack when ext4 is listed first', () => {
    const root = fixture();
    const result = decision(root, stacked(root, 'ext4-first'));
    assert.equal(result.ok, false, 'a stacked mount must not be admitted');
    if (!result.ok) assert.equal(result.reason, 'mount-unverifiable');
  });

  it('refuses the same stack when nfs4 is listed first', () => {
    const root = fixture();
    const result = decision(root, stacked(root, 'nfs-first'));
    assert.equal(result.ok, false, 'textual order must not change the verdict');
    if (!result.ok) assert.equal(result.reason, 'mount-unverifiable');
  });

  it('refuses a stack of two allowlisted filesystems too', () => {
    // Ambiguity is refused regardless of what is stacked: the gate cannot tell
    // which one is visible, so it cannot tell which one it would be reading.
    const root = fixture();
    const parent = nodePath.dirname(root);
    const outer = entry({ id: 10, parent: 1, point: parent, fstype: 'ext4', source: '/dev/sda4' });
    const inner = entry({ id: 11, parent: 10, point: parent, fstype: 'xfs', source: '/dev/sdb1' });
    const result = decision(root, [entry({ id: 1, point: '/', fstype: 'ext4' }), outer, inner].join('\n') + '\n');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'mount-unverifiable');
  });

  it('refuses a stack of two records with the same filesystem type', () => {
    // The case that distinguishes "ambiguous" from "conflicting types": two ext4
    // records at one path are still ambiguous, because the gate cannot tell which
    // one it would be reading. Requiring differing types would let this pass.
    const root = fixture();
    const parent = nodePath.dirname(root);
    const outer = entry({ id: 10, parent: 1, point: parent, fstype: 'ext4', source: '/dev/sda4' });
    const inner = entry({ id: 11, parent: 10, point: parent, fstype: 'ext4', source: '/dev/sdc1' });
    const result = decision(root, [entry({ id: 1, point: '/', fstype: 'ext4' }), outer, inner].join('\n') + '\n');
    assert.equal(result.ok, false, 'same-type stacking is still ambiguous');
    if (!result.ok) assert.equal(result.reason, 'mount-unverifiable');
  });

  it('still accepts a single well-formed deepest mount', () => {
    // The regression guard: refusing ambiguity must not refuse the ordinary case.
    const root = fixture();
    const result = decision(root, table(root, 'ext4'));
    assert.equal(result.ok, true);
  });

  it('still prefers a deeper single mount over a shallower one', () => {
    const root = fixture();
    const deeper = [
      entry({ id: 1, point: '/', fstype: 'ext4' }),
      entry({ id: 2, parent: 1, point: nodePath.dirname(root), fstype: 'nfs4' }),
    ].join('\n') + '\n';
    const result = decision(root, deeper);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'mount-not-acceptable');
  });
});

describe('filesystem policy: a malformed record cannot hide a deeper mount', () => {
  it('refuses when a garbage line accompanies a shallow allowlisted entry', () => {
    // The dangerous shape: a valid `/` on ext4 plus a truncated record that might
    // have been the deeper network mount. Skipping it would accept the root.
    const root = fixture();
    const mixed = `garbage line that cannot parse\n${entry({ id: 1, point: '/', fstype: 'ext4' })}\n`;
    const result = decision(root, mixed);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'mount-unverifiable');
  });

  it('refuses a truncated deeper record next to a valid covering one', () => {
    const root = fixture();
    const parent = nodePath.dirname(root);
    const text = [
      entry({ id: 1, point: '/', fstype: 'ext4' }),
      entry({ id: 2, parent: 1, point: parent, fstype: 'ext4' }),
      // A plausible deeper mount whose type field is missing entirely.
      `3 2 0:99 / ${parent}/sub rw,relatime`,
    ].join('\n') + '\n';
    const result = decision(root, text);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'mount-unverifiable');
  });

  it('accepts a fully well-formed table', () => {
    const root = fixture();
    assert.equal(decision(root, table(root, 'ext4')).ok, true);
  });
});

describe('filesystem policy: escaped paths are decoded', () => {
  it('decodes octal escapes', () => {
    assert.equal(decodeMountField('/mnt/my\\040project'), '/mnt/my project');
    assert.equal(decodeMountField('/a\\011b'), '/a\tb');
    assert.equal(decodeMountField('/a\\134b'), '/a\\b');
    assert.equal(decodeMountField('/plain'), '/plain');
  });

  it('matches a mount point containing a space', () => {
    const parent = fs.mkdtempSync(nodePath.join(fs.realpathSync(os.tmpdir()), 'nid m26 sp '));
    created.push(parent);
    const root = nodePath.join(parent, 'project');
    fs.mkdirSync(root);

    // Encode the space the way mountinfo does.
    const encoded = parent.replace(/ /g, '\\040');
    const tableText = [
      entry({ id: 1, point: '/', fstype: 'ext4' }),
      entry({ id: 2, parent: 1, point: encoded, fstype: 'nfs4' }),
    ].join('\n') + '\n';

    assert.ok(root.includes(' '), 'the fixture must actually contain a space');
    const result = decision(root, tableText);
    assert.equal(result.ok, false, 'the escaped nfs entry must be found and refuse');
    if (!result.ok) assert.equal(result.reason, 'mount-not-acceptable');
  });

  it('does not treat a sibling with a shared prefix as covered', () => {
    const root = fixture();
    // `/mnt/data` must not cover `/mnt/database`.
    const sibling = [
      entry({ id: 1, point: '/', fstype: 'ext4' }),
      entry({ id: 2, parent: 1, point: `${nodePath.dirname(root)}extra`, fstype: 'nfs4' }),
    ].join('\n') + '\n';
    const result = decision(root, sibling);
    // The nfs entry is a sibling, not an ancestor, so `/` (ext4) covers the root.
    assert.equal(result.ok, true, 'a sibling prefix must not be treated as a covering mount');
  });
});

describe('filesystem policy: parsing', () => {
  it('parses fields and locates the separator rather than indexing blindly', () => {
    const text = [
      '36 35 98:0 /mnt1 /mnt2 rw,noatime master:1 - ext3 /dev/root rw,errors=continue',
      '37 36 0:2 / /mnt3 rw - tmpfs tmpfs rw,size=1024k',
    ].join('\n');
    const parsed = parseMountInfo(text);
    assert.equal(parsed.malformed, false);
    assert.equal(parsed.mounts.length, 2);
    assert.deepEqual(parsed.mounts[0], { root: '/mnt1', point: '/mnt2', fstype: 'ext3', source: '/dev/root' });
    assert.deepEqual(parsed.mounts[1], { root: '/', point: '/mnt3', fstype: 'tmpfs', source: 'tmpfs' });
  });

  it('flags a record with no type separator as malformed rather than guessing', () => {
    // Missing `-`: unclassifiable, and it might be the deeper mount, so the gate
    // must refuse rather than discard it.
    const parsed = parseMountInfo('1 0 8:1 / /mnt rw,relatime\n');
    assert.equal(parsed.malformed, true);
  });

  it('ignores blank lines without flagging them', () => {
    const parsed = parseMountInfo('\n\n1 0 8:1 / /mnt rw - ext4 /dev/sda1 rw\n\n');
    assert.equal(parsed.malformed, false);
    assert.equal(parsed.mounts.length, 1);
  });
});

describe('filesystem policy: other structural checks still run', () => {
  it('still refuses a symlinked root', () => {
    const parent = fs.mkdtempSync(nodePath.join(fs.realpathSync(os.tmpdir()), 'nid-m26-link-'));
    created.push(parent);
    const real = nodePath.join(parent, 'real');
    fs.mkdirSync(real);
    const link = nodePath.join(parent, 'link');
    fs.symlinkSync(real, link);
    const result = decision(link, table(real, 'ext4'));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'root-symlinked');
  });

  it('still refuses a root owned by someone else', () => {
    const root = fixture();
    const result = verifyHumanRootPreconditions(root, { uid: -1, mountTable: table(root, 'ext4') });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'root-owner-mismatch');
  });

  it('still refuses a missing root', () => {
    const root = fixture();
    const absent = nodePath.join(nodePath.dirname(root), 'absent');
    const result = decision(absent, table(absent, 'ext4'));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'root-not-directory');
  });
});
