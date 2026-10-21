import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readRecord, storeKeyFor, writeRecord } from '../src/core/persistence.ts';
import type { KeyValueStore } from '../src/core/persistence.ts';
import { startRecord } from '../src/core/record.ts';
import { workspaceKeyFrom } from '../src/core/workspace.ts';

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
