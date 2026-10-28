import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  readRecord,
  readSession,
  removeSession,
  sessionKeyFor,
  storeKeyFor,
  writeRecord,
  writeSession,
} from '../src/core/persistence.ts';
import type { KeyValueStore } from '../src/core/persistence.ts';
import { startRecord } from '../src/core/record.ts';
import { workspaceKeyFrom } from '../src/core/workspace.ts';
import { createInterviewSession } from '../src/core/interview.ts';

function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: (key) => data.get(key),
    set: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
  };
}

const recordFor = (workspace: string) =>
  startRecord({ workspace, goal: 'Add subscriptions', now: '2026-10-20T10:00:00.000Z' });

describe('store keys', () => {
  it('keys every workspace separately', () => {
    assert.notEqual(storeKeyFor('/work/one'), storeKeyFor('/work/two'));
  });

  it('namespaces the key so other data in the mod store is left alone', () => {
    assert.match(storeKeyFor('/work/one'), /^session\.v1:/);
  });
});

describe('readRecord', () => {
  it('returns empty for a workspace with nothing saved', () => {
    assert.deepEqual(readRecord(memoryStore(), '/work/one'), { kind: 'empty' });
  });

  it('returns unreadable rather than throwing on corrupt data', () => {
    const store = memoryStore({ [storeKeyFor('/work/one')]: { schemaVersion: 1, goal: 5 } });
    const result = readRecord(store, '/work/one');
    assert.equal(result.kind, 'unreadable');
  });

  it('does not read another workspace record', () => {
    const store = memoryStore({ [storeKeyFor('/work/two')]: recordFor('/work/two') });
    assert.deepEqual(readRecord(store, '/work/one'), { kind: 'empty' });
    assert.equal(readRecord(store, '/work/two').kind, 'ok');
  });
});

describe('writeRecord', () => {
  it('resolves only after the store confirms the write', async () => {
    const store = memoryStore();
    await writeRecord(store, recordFor('/work/one'));
    assert.equal(readRecord(store, '/work/one').kind, 'ok');
  });

  it('rejects when the store cannot write, so callers cannot claim success', async () => {
    const failing: KeyValueStore = {
      get: () => undefined,
      set: async () => {
        throw new Error('EACCES: permission denied');
      },
      delete: async () => {
        throw new Error('EACCES: permission denied');
      },
    };

    await assert.rejects(() => writeRecord(failing, recordFor('/work/one')), /EACCES/);
  });
});

describe('workspace isolation through the store', () => {
  it('keeps two workspaces independent inside one mod store', async () => {
    const store = memoryStore();

    await writeRecord(store, startRecord({ workspace: workspaceKeyFrom('/work/one'), goal: 'One', now: 'now' }));
    await writeRecord(store, startRecord({ workspace: workspaceKeyFrom('/work/two'), goal: 'Two', now: 'now' }));

    const one = readRecord(store, workspaceKeyFrom('/work/one'));
    const two = readRecord(store, workspaceKeyFrom('/work/two'));

    assert.equal(one.kind === 'ok' ? one.record.goal : 'missing', 'One');
    assert.equal(two.kind === 'ok' ? two.record.goal : 'missing', 'Two');
  });
});

describe('v2 session storage', () => {
  it('keeps v1 and v2 under separate keys so neither overwrites the other', async () => {
    const store = memoryStore();
    const workspace = workspaceKeyFrom('/work/one');

    await writeRecord(store, startRecord({ workspace, goal: 'Legacy goal', now: 'now' }));
    const session = createInterviewSession({ id: 's1', workspace, goal: 'New goal', now: 'now' });
    await writeSession(store, session);

    assert.notEqual(storeKeyFor(workspace), sessionKeyFor(workspace));
    assert.equal(readRecord(store, workspace).kind, 'ok');
    const read = readSession(store, workspace);
    assert.equal(read.kind, 'ok');
    if (read.kind === 'ok') assert.equal(read.session.goal, 'New goal');
  });

  it('round-trips a session and validates it on read', async () => {
    const store = memoryStore();
    const workspace = workspaceKeyFrom('/work/one');
    const session = createInterviewSession({ id: 's1', workspace, goal: 'Goal', now: 'now' });

    await writeSession(store, session);
    const read = readSession(store, workspace);
    assert.equal(read.kind, 'ok');
    if (read.kind !== 'ok') return;
    assert.equal(read.session.id, 's1');
    assert.equal(read.session.decisions.length, 3);
  });

  it('reports corrupt v2 data as unreadable rather than throwing', () => {
    const store = memoryStore({ [sessionKeyFor('/work/one')]: { schemaVersion: 2, id: 'broken' } });
    const read = readSession(store, '/work/one');
    assert.equal(read.kind, 'unreadable');
  });

  it('returns empty when nothing is saved for the workspace', () => {
    assert.equal(readSession(memoryStore(), '/work/none').kind, 'empty');
  });

  it('removes only the v2 key', async () => {
    const store = memoryStore();
    const workspace = workspaceKeyFrom('/work/one');
    await writeRecord(store, startRecord({ workspace, goal: 'Legacy', now: 'now' }));
    await writeSession(store, createInterviewSession({ id: 's1', workspace, goal: 'G', now: 'now' }));

    await removeSession(store, workspace);
    assert.equal(readSession(store, workspace).kind, 'empty');
    assert.equal(readRecord(store, workspace).kind, 'ok');
  });
});
