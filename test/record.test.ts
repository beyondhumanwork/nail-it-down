import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SCHEMA_VERSION, readStoredRecord, startRecord, withAnswer, withApproval } from '../src/core/record.ts';
import { workspaceKeyFrom } from '../src/core/workspace.ts';

const validRecord = {
  schemaVersion: SCHEMA_VERSION,
  workspace: '/work/one',
  goal: 'Add subscriptions to my app',
  status: 'awaiting_answer' as const,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
};

describe('readStoredRecord', () => {
  it('reports empty when nothing is saved', () => {
    assert.deepEqual(readStoredRecord(undefined), { kind: 'empty' });
    assert.deepEqual(readStoredRecord(null), { kind: 'empty' });
  });

  it('rejects values that are not objects', () => {
    for (const value of ['a string', 42, true, [1, 2, 3]]) {
      const result = readStoredRecord(value);
      assert.equal(result.kind, 'unreadable');
    }
  });

  it('rejects an unknown schema version instead of guessing', () => {
    const result = readStoredRecord({ ...validRecord, schemaVersion: 99 });
    assert.equal(result.kind, 'unreadable');
    assert.match(result.kind === 'unreadable' ? result.reason : '', /schema version 99/);
  });

  it('rejects a record with a missing schema version', () => {
    const withoutVersion: Record<string, unknown> = { ...validRecord };
    delete withoutVersion.schemaVersion;
    assert.equal(readStoredRecord(withoutVersion).kind, 'unreadable');
  });

  it('rejects a record that claims to be answered without an answer', () => {
    const result = readStoredRecord({ ...validRecord, status: 'answered' });
    assert.equal(result.kind, 'unreadable');
  });

  it('rejects an incomplete answer', () => {
    const result = readStoredRecord({
      ...validRecord,
      status: 'answered',
      answer: { questionId: 'q', question: 'Who?', answer: '', answeredAt: '2026-10-20T10:00:00.000Z' },
    });
    assert.equal(result.kind, 'unreadable');
  });

  it('rejects an unknown status', () => {
    assert.equal(readStoredRecord({ ...validRecord, status: 'approved' }).kind, 'unreadable');
  });

  it('accepts a valid record and keeps only known fields', () => {
    const result = readStoredRecord({ ...validRecord, secretExtra: 'drop me' });
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.deepEqual(Object.keys(result.record).sort(), [
      'createdAt',
      'goal',
      'schemaVersion',
      'status',
      'updatedAt',
      'workspace',
    ]);
  });

  it('accepts a valid answered record', () => {
    const result = readStoredRecord({
      ...validRecord,
      status: 'answered',
      answer: {
        questionId: 'who-uses-this',
        question: 'Who is going to use this?',
        answer: 'One team',
        answeredAt: '2026-10-20T10:01:00.000Z',
      },
    });
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.record.answer?.answer, 'One team');
  });
});

describe('record transitions', () => {
  it('starts unanswered and carries the schema version', () => {
    const record = startRecord({ workspace: '/work/one', goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    assert.equal(record.schemaVersion, SCHEMA_VERSION);
    assert.equal(record.status, 'awaiting_answer');
    assert.equal(record.answer, undefined);
    assert.equal(record.approvedAt, undefined);
  });

  it('records an answer as answered', () => {
    const started = startRecord({ workspace: '/work/one', goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    const answered = withAnswer(
      started,
      {
        questionId: 'who-uses-this',
        question: 'Who is going to use this?',
        answer: 'One team',
        answeredAt: '2026-10-20T10:05:00.000Z',
      },
      '2026-10-20T10:05:00.000Z',
    );

    assert.equal(answered.status, 'answered');
    assert.equal(answered.answer?.answer, 'One team');
    assert.equal(answered.updatedAt, '2026-10-20T10:05:00.000Z');
    assert.equal(answered.createdAt, started.createdAt);
  });

  it('records approval only when asked to', () => {
    const started = startRecord({ workspace: '/work/one', goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    assert.equal(started.approvedAt, undefined);
    assert.equal(withApproval(started, '2026-10-20T10:10:00.000Z').approvedAt, '2026-10-20T10:10:00.000Z');
  });
});

describe('workspaceKeyFrom', () => {
  it('keeps ordinary paths as they are', () => {
    assert.equal(workspaceKeyFrom('/home/ahmed/code/nail-it-down'), '/home/ahmed/code/nail-it-down');
  });

  it('normalizes trailing slashes so one workspace is not two records', () => {
    assert.equal(workspaceKeyFrom('/work/one/'), workspaceKeyFrom('/work/one'));
    assert.equal(workspaceKeyFrom('  /work/one//  '), '/work/one');
  });

  it('keeps the filesystem root distinct', () => {
    assert.equal(workspaceKeyFrom('/'), '/');
  });

  it('separates different workspaces', () => {
    assert.notEqual(workspaceKeyFrom('/work/one'), workspaceKeyFrom('/work/two'));
  });

  it('falls back safely when the host gives no cwd', () => {
    assert.equal(workspaceKeyFrom(undefined), '<unknown-workspace>');
    assert.equal(workspaceKeyFrom('   '), '<unknown-workspace>');
  });
});
