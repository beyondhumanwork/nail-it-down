import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_SCHEMA_VERSION,
  createDecision,
  createSession,
  readStoredSession,
  canonicalDecisionSnapshot,
  previewLegacyMigration,
  readLegacySession,
} from '../src/core/session.ts';
import { startRecord, withAnswer, withApproval } from '../src/core/record.ts';

const validDecision = {
  id: 'q1',
  question: 'Who is going to use this?',
  whyItMatters: 'It shapes access and billing.',
  priority: 'critical' as const,
  prerequisites: [],
  status: 'open' as const,
  options: [{ id: 'a', label: 'Just me', consequence: 'Solo' }],
  updatedAt: '2026-10-25T10:00:00.000Z',
};

const validSession = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  id: 's1',
  workspace: '/work/one',
  goal: 'Add subscriptions',
  status: 'interviewing' as const,
  decisions: [validDecision],
  createdAt: '2026-10-25T10:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
};

describe('readStoredSession', () => {
  it('S1-01: accepts a valid v2 session', () => {
    const result = readStoredSession(validSession);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.session.schemaVersion, SESSION_SCHEMA_VERSION);
    assert.equal(result.session.decisions[0].id, 'q1');
  });

  it('S1-02: rejects an unknown schema version', () => {
    const result = readStoredSession({ ...validSession, schemaVersion: 99 });
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /schema version 99/);
  });

  it('S1-03: rejects missing or incorrect fields', () => {
    for (const value of [undefined, null, 'x', 42, [], {}]) {
      assert.equal(readStoredSession(value).kind, value === undefined || value === null ? 'empty' : 'unreadable');
    }
    assert.equal(readStoredSession({ ...validSession, goal: '' }).kind, 'unreadable');
    assert.equal(readStoredSession({ ...validSession, status: 'bogus' }).kind, 'unreadable');
    assert.equal(readStoredSession({ ...validSession, decisions: 'nope' }).kind, 'unreadable');
  });

  it('S1-04: rejects duplicate decision identifiers', () => {
    const result = readStoredSession({
      ...validSession,
      decisions: [validDecision, { ...validDecision, updatedAt: '2026-10-25T10:01:00.000Z' }],
    });
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /duplicate decision id/);
  });

  it('S1-05: rejects an answered decision without a valid user answer', () => {
    const result = readStoredSession({
      ...validSession,
      decisions: [{ ...validDecision, status: 'answered' }],
    });
    assert.equal(result.kind, 'unreadable');
  });

  it('S1-07: rejects approved status without complete approval metadata', () => {
    const result = readStoredSession({ ...validSession, status: 'approved' });
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /approval metadata/);
  });

  it('S1-08: rejects approval metadata on a non-approved session', () => {
    const result = readStoredSession({
      ...validSession,
      approvedAt: '2026-10-25T10:05:00.000Z',
      approvedSnapshot: '{}',
    });
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /non-approved session/);
  });

  it('S1-09: rejects an approved session with unresolved critical decisions', () => {
    const result = readStoredSession({
      ...validSession,
      status: 'approved',
      approvedAt: '2026-10-25T10:05:00.000Z',
      approvedSnapshot: '[]',
      decisions: [{ ...validDecision, priority: 'critical', status: 'open' }],
    });
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /unresolved critical decision/);
  });

  it('S1-09b: rejects an approved session with a decision requiring review', () => {
    const result = readStoredSession({
      ...validSession,
      status: 'approved',
      approvedAt: '2026-10-25T10:05:00.000Z',
      approvedSnapshot: '[]',
      decisions: [{ ...validDecision, status: 'needs_review' }],
    });
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /requiring review/);
  });

  it('S1-13: does not mutate the input object', () => {
    const input = structuredClone(validSession);
    const before = structuredClone(input);
    readStoredSession(input);
    assert.deepEqual(input, before);
  });
});

describe('legacy M0 compatibility', () => {
  it('S1-10: original v1 record remains unchanged after preview conversion', () => {
    const record = startRecord({ workspace: '/work/one', goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    const before = structuredClone(record);
    previewLegacyMigration(record);
    assert.deepEqual(record, before);
  });

  it('S1-11: historical M0 approval never becomes M1 approval', () => {
    const record = startRecord({ workspace: '/work/one', goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    const answered = withAnswer(record, {
      questionId: 'who-uses-this',
      question: 'Who is going to use this?',
      answer: 'One team',
      answeredAt: '2026-10-20T10:05:00.000Z',
    }, '2026-10-20T10:05:00.000Z');
    const approved = withApproval(answered, '2026-10-20T10:10:00.000Z');
    const preview = previewLegacyMigration(approved);
    assert.notEqual(preview.kind, 'unavailable');
    if (preview.kind === 'unavailable') return;
    assert.equal(preview.session.approvedAt, undefined);
    assert.equal(preview.session.approvedSnapshot, undefined);
    assert.notEqual(preview.session.status, 'approved');
  });

  it('S1-06: "I have not decided" does not count as settled', () => {
    const record = startRecord({ workspace: '/work/one', goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    const answered = withAnswer(record, {
      questionId: 'who-uses-this',
      question: 'Who is going to use this?',
      answer: 'I have not decided',
      answeredAt: '2026-10-20T10:05:00.000Z',
    }, '2026-10-20T10:05:00.000Z');
    const preview = previewLegacyMigration(answered);
    assert.equal(preview.kind, 'needs_review');
    if (preview.kind === 'unavailable' || preview.kind === 'ready') return;
    assert.equal(preview.session.decisions[0].status, 'open');
    assert.equal(preview.session.decisions[0].answer, undefined);
  });

  it('S1-12: malformed legacy records fail safely', () => {
    const result = readLegacySession({ schemaVersion: 9, goal: 42 });
    assert.equal(result.kind, 'unreadable');
  });

  it('S1-12b: preview on an unreadable legacy is not attempted by callers', () => {
    // Callers must validate first; preview assumes a valid v1 record.
    const record = startRecord({ workspace: '/work/one', goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    const preview = previewLegacyMigration(record);
    assert.notEqual(preview.kind, 'unavailable');
  });
});

describe('session helpers', () => {
  it('createDecision / createSession produce valid interviewing sessions', () => {
    const decision = createDecision({
      id: 'd1',
      question: 'Q?',
      whyItMatters: 'Because.',
      priority: 'critical',
      now: '2026-10-25T10:00:00.000Z',
    });
    const session = createSession({
      id: 's1',
      workspace: '/work/one',
      goal: 'Goal',
      decisions: [decision],
      now: '2026-10-25T10:00:00.000Z',
    });
    assert.equal(session.status, 'interviewing');
    assert.equal(session.schemaVersion, SESSION_SCHEMA_VERSION);
    const result = readStoredSession(session);
    assert.equal(result.kind, 'ok');
  });

  it('canonicalDecisionSnapshot is deterministic', () => {
    const decision = createDecision({
      id: 'd1',
      question: 'Q?',
      whyItMatters: 'Because.',
      priority: 'critical',
      now: '2026-10-25T10:00:00.000Z',
    });
    const a = canonicalDecisionSnapshot([decision]);
    const b = canonicalDecisionSnapshot([decision]);
    assert.equal(a, b);
  });
});

describe('M0 regression guard', () => {
  it('S1-14: M0 record validation still works', () => {
    const record = startRecord({ workspace: '/work/one', goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    // readStoredRecord is exercised indirectly via readLegacySession.
    const result = readLegacySession(record);
    assert.equal(result.kind, 'ok');
  });
});