import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_SCHEMA_VERSION,
  createDecision,
  createSession,
  readStoredSession,
  canonicalDecisionSnapshot,
  isSettledDecision,
  isUnresolvedAnswer,
  previewLegacyMigration,
  readLegacySession,
} from '../src/core/session.ts';
import type { Decision } from '../src/core/session.ts';
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

/** A decision settled by the user, so it can carry an approval. */
const settledDecision: Decision = {
  ...validDecision,
  status: 'answered',
  answer: { text: 'Just me', chosenOptionId: 'a', actor: 'user' },
};

/** Decisions with the M0 undecided option present, for unresolved-answer tests. */
const undecidedOptionDecision = {
  ...validDecision,
  options: [
    { id: 'a', label: 'Just me', consequence: 'Solo' },
    { id: 'undecided', label: 'I have not decided', consequence: 'Nothing is settled.', unresolved: true as const },
  ],
};

/** An approved session whose snapshot is the canonical text of its decisions. */
function approvedSession(decisions: Decision[]) {
  return {
    ...validSession,
    status: 'approved' as const,
    approvedAt: '2026-10-25T10:05:00.000Z',
    approvedSnapshot: canonicalDecisionSnapshot(decisions),
    decisions,
  };
}

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

describe('approval snapshot integrity', () => {
  it('S1-15: accepts an approval whose snapshot is the canonical decision text', () => {
    const result = readStoredSession(approvedSession([settledDecision]));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.session.status, 'approved');
    assert.equal(result.session.approvedSnapshot, canonicalDecisionSnapshot([settledDecision]));
  });

  it('S1-15b: rejects a snapshot that was edited after approval', () => {
    const session = approvedSession([settledDecision]);
    const tampered = session.approvedSnapshot.replace('Just me', 'Everyone');
    const result = readStoredSession({ ...session, approvedSnapshot: tampered });
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /snapshot does not match/);
  });

  it('S1-15c: rejects a stale snapshot after the stored answer changed', () => {
    const approved = approvedSession([settledDecision]);
    const result = readStoredSession({
      ...approved,
      decisions: [{ ...settledDecision, answer: { text: 'One team', actor: 'user' }, updatedAt: '2026-10-25T11:00:00.000Z' }],
    });
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /snapshot does not match/);
  });

  it('S1-15d: rejects a non-canonical serialization of the same decisions', () => {
    const decisions = [settledDecision];
    // Same content, different serialization: lexicographically sorted keys and
    // indentation. It proves the snapshot must match the canonical text exactly.
    const sortedKeys = JSON.stringify(
      JSON.parse(canonicalDecisionSnapshot(decisions)),
      Object.keys(decisions[0]).sort(),
      2,
    );
    const result = readStoredSession({ ...approvedSession(decisions), approvedSnapshot: sortedKeys });
    assert.equal(result.kind, 'unreadable');
  });

  it('S1-15e: rejects a snapshot of the same decisions in a different order', () => {
    const second: Decision = { ...settledDecision, id: 'q2', question: 'How is it paid for?' };
    const decisions = [settledDecision, second];
    const reordered = canonicalDecisionSnapshot([second, settledDecision]);
    const result = readStoredSession({ ...approvedSession(decisions), approvedSnapshot: reordered });
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /snapshot does not match/);
  });

  it('S1-15f: rejects an approval over an empty decision list', () => {
    const result = readStoredSession({
      ...validSession,
      status: 'approved',
      approvedAt: '2026-10-25T10:05:00.000Z',
      approvedSnapshot: canonicalDecisionSnapshot([]),
      decisions: [],
    });
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /no decisions to approve/);
  });

  it('S1-15g: rejects an approval whose critical answer is the undecided option', () => {
    const decision = {
      ...undecidedOptionDecision,
      status: 'answered' as const,
      answer: { text: 'I have not decided', chosenOptionId: 'undecided', actor: 'user' as const },
    };
    // Such a decision cannot even be stored as answered, so this is caught first.
    const stored = readStoredSession({ ...validSession, decisions: [decision] });
    assert.equal(stored.kind, 'unreadable');
    if (stored.kind !== 'unreadable') return;
    assert.match(stored.reason, /undecided answer cannot be an answered decision/);
  });

  it('S1-15h: the snapshot covers every decision, including non-critical ones left open', () => {
    const minor: Decision = { ...validDecision, id: 'q2', priority: 'minor', status: 'open' };
    const decisions = [settledDecision, minor];
    const result = readStoredSession(approvedSession(decisions));
    assert.equal(result.kind, 'ok');
    // Dropping the open decision from the snapshot is a stale approval.
    const droppedMinor = readStoredSession({
      ...approvedSession(decisions),
      approvedSnapshot: canonicalDecisionSnapshot([settledDecision]),
    });
    assert.equal(droppedMinor.kind, 'unreadable');
  });
});

describe('unresolved answers', () => {
  it('S1-16: an answered decision may not select the undecided option', () => {
    const result = readStoredSession({
      ...validSession,
      decisions: [{
        ...undecidedOptionDecision,
        status: 'answered',
        answer: { text: 'I have not decided', chosenOptionId: 'undecided', actor: 'user' },
      }],
    });
    assert.equal(result.kind, 'unreadable');
  });

  it('S1-16b: a custom answer that merely mentions uncertainty stays a decision', () => {
    const result = readStoredSession({
      ...validSession,
      decisions: [{
        ...validDecision,
        status: 'answered',
        answer: { text: 'Not sure whether it is one team or two; start with one', actor: 'user' },
      }],
    });
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.session.decisions[0].status, 'answered');
  });

  it('S1-16c: the unresolved rule is identity-based, not wording-based', () => {
    const optionDecision: Decision = {
      ...undecidedOptionDecision,
      status: 'answered',
      answer: { text: 'Deferring this for now', chosenOptionId: 'undecided', actor: 'user' },
    };
    // Judged by the option it names, even though its prose says nothing about being undecided.
    assert.equal(isUnresolvedAnswer(optionDecision.answer!, optionDecision.options), true);
    assert.equal(isSettledDecision(optionDecision), false);

    const customOption = { id: 'b', label: 'Maybe later', consequence: 'Nothing settled.' };
    assert.equal(
      isUnresolvedAnswer({ text: 'Maybe later', chosenOptionId: 'b', actor: 'user' }, [customOption]),
      false,
    );
  });

  it('S1-16d: rejects an answer naming an option the decision does not offer', () => {
    const result = readStoredSession({
      ...validSession,
      decisions: [{
        ...validDecision,
        status: 'answered',
        answer: { text: 'Just me', chosenOptionId: 'missing', actor: 'user' },
      }],
    });
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /option that does not exist/);
  });
});

describe('needs_review retention', () => {
  it('S1-17: a decision needing review keeps its previous answer', () => {
    const result = readStoredSession({
      ...validSession,
      decisions: [{
        ...settledDecision,
        status: 'needs_review',
        answer: { text: 'Just me', chosenOptionId: 'a', actor: 'user' },
      }],
    });
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    const decision = result.session.decisions[0];
    assert.equal(decision.status, 'needs_review');
    assert.equal(decision.answer?.text, 'Just me');
  });

  it('S1-17b: an unanswered decision needing review is also valid', () => {
    const result = readStoredSession({
      ...validSession,
      decisions: [{ ...validDecision, status: 'needs_review' }],
    });
    assert.equal(result.kind, 'ok');
  });

  it('S1-17c: a retained answer may not be the undecided option', () => {
    const result = readStoredSession({
      ...validSession,
      decisions: [{
        ...undecidedOptionDecision,
        status: 'needs_review',
        answer: { text: 'I have not decided', chosenOptionId: 'undecided', actor: 'user' },
      }],
    });
    assert.equal(result.kind, 'unreadable');
  });

  it('S1-17d: open, deferred and blocked decisions may not carry an answer', () => {
    for (const status of ['open', 'deferred', 'blocked'] as const) {
      const result = readStoredSession({
        ...validSession,
        decisions: [{
          ...validDecision,
          status,
          answer: { text: 'Just me', chosenOptionId: 'a', actor: 'user' },
        }],
      });
      assert.equal(result.kind, 'unreadable', `status ${status} must not carry an answer`);
    }
  });

  it('S1-17e: a retained or answered-stale decision never counts as settled', () => {
    assert.equal(isSettledDecision({ ...settledDecision, status: 'needs_review' }), false);
    assert.equal(isSettledDecision({ ...settledDecision, status: 'open' }), false);
    assert.equal(isSettledDecision(settledDecision), true);
  });

  it('S1-19: an assumption is not user confirmation', () => {
    // The schema still accepts `assumed` so later milestones can propose an
    // assumption, but M1 gives it no settlement authority.
    const assumed = { ...settledDecision, status: 'assumed' as const, answer: { text: 'Probably one team', actor: 'assumption' as const } };
    assert.equal(isSettledDecision(assumed), false);
    // It remains storable, so the decision is representable without being trusted.
    assert.equal(readStoredSession({ ...validSession, decisions: [assumed] }).kind, 'ok');
  });

  it('S1-19b: an unconfirmed critical assumption cannot satisfy approval', () => {
    const assumed = { ...settledDecision, status: 'assumed' as const, answer: { text: 'Probably one team', actor: 'assumption' as const } };
    const result = readStoredSession(approvedSession([assumed]));
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /unresolved critical decision/);
  });

  it('S1-20: an approved session cannot rest a settled answer on an unsettled prerequisite', () => {
    // The graph is structurally valid; the contradiction is semantic. A settled
    // decision depends on one the user deferred.
    const deferred = { ...validDecision, id: 'd1', priority: 'minor' as const, status: 'deferred' as const };
    const settled = {
      ...settledDecision,
      id: 'd2',
      prerequisites: ['d1'],
      answer: { text: 'Just me', chosenOptionId: 'a', actor: 'user' as const },
    };
    const result = readStoredSession(approvedSession([deferred, settled]));

    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /prerequisites are unresolved/);
    assert.match(result.reason, /d2 waits on d1/);
  });

  it('S1-20b: a legitimate non-critical deferral with no settled dependent is allowed', () => {
    const deferred = { ...validDecision, id: 'd1', priority: 'minor' as const, status: 'deferred' as const };
    const result = readStoredSession(approvedSession([settledDecision, deferred]));
    assert.equal(result.kind, 'ok');
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
    if (preview.kind !== 'needs_review') return;
    assert.equal(preview.session.decisions[0].status, 'open');
    assert.equal(preview.session.decisions[0].answer, undefined);
  });

  it('S1-16e: an uncertain-sounding custom M0 answer still migrates as answered', () => {
    const record = startRecord({ workspace: '/work/one', goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    const answered = withAnswer(record, {
      questionId: 'who-uses-this',
      question: 'Who is going to use this?',
      answer: 'Not sure yet - maybe one team',
      answeredAt: '2026-10-20T10:05:00.000Z',
    }, '2026-10-20T10:05:00.000Z');
    const preview = previewLegacyMigration(answered);
    assert.equal(preview.kind, 'ready');
    if (preview.kind !== 'ready') return;
    assert.equal(preview.session.decisions[0].status, 'answered');
  });

  it('S1-12: malformed legacy records fail safely', () => {
    const result = readLegacySession({ schemaVersion: 9, goal: 42 });
    assert.equal(result.kind, 'unreadable');
  });

  it('S1-18: preview rejects unreadable input at its own boundary', () => {
    const inputs: unknown[] = [
      undefined,
      null,
      'not a record',
      42,
      [],
      {},
      { schemaVersion: 9, goal: 42 },
      { schemaVersion: 1, workspace: '/work/one', goal: '', status: 'answered', createdAt: 'x', updatedAt: 'y' },
      { schemaVersion: 1, workspace: '/work/one', goal: 'g', status: 'nonsense', createdAt: 'x', updatedAt: 'y' },
      { schemaVersion: 1, workspace: '/work/one', goal: 'g', status: 'answered', createdAt: 'x', updatedAt: 'y' },
    ];
    for (const input of inputs) {
      const preview = previewLegacyMigration(input);
      assert.equal(preview.kind, 'unavailable', `expected unavailable for ${JSON.stringify(input)}`);
    }
  });

  it('S1-18b: contradictory legacy state needs review and promotes no approval', () => {
    const record = startRecord({ workspace: '/work/one', goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    const contradictory = {
      ...record,
      status: 'awaiting_answer' as const,
      answer: { questionId: 'who-uses-this', question: 'Who?', answer: 'One team', answeredAt: '2026-10-20T10:05:00.000Z' },
    };
    const preview = previewLegacyMigration(contradictory);
    assert.equal(preview.kind, 'needs_review');
    if (preview.kind !== 'needs_review') return;
    assert.match(preview.reason, /contradicts itself/);
    assert.equal(preview.session.approvedAt, undefined);
    assert.equal(preview.session.status, 'interviewing');
  });

  it('S1-18c: preview output always satisfies the v2 contract', () => {
    const base = startRecord({ workspace: '/work/one', goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    const cases = [
      base,
      withAnswer(base, { questionId: 'q', question: 'Q?', answer: 'One team', answeredAt: '2026-10-20T10:05:00.000Z' }, '2026-10-20T10:05:00.000Z'),
      withApproval(withAnswer(base, { questionId: 'q', question: 'Q?', answer: 'One team', answeredAt: '2026-10-20T10:05:00.000Z' }, '2026-10-20T10:05:00.000Z'), '2026-10-20T10:10:00.000Z'),
    ];
    for (const legacy of cases) {
      const preview = previewLegacyMigration(legacy);
      assert.notEqual(preview.kind, 'unavailable');
      if (preview.kind === 'unavailable') return;
      const check = readStoredSession(preview.session);
      assert.equal(check.kind, 'ok');
    }
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

  it('canonicalDecisionSnapshot is deterministic and preserves decision order', () => {
    const decision = createDecision({
      id: 'd1',
      question: 'Q?',
      whyItMatters: 'Because.',
      priority: 'critical',
      now: '2026-10-25T10:00:00.000Z',
    });
    const second = createDecision({
      id: 'd2',
      question: 'Q2?',
      whyItMatters: 'Because.',
      priority: 'minor',
      now: '2026-10-25T10:00:00.000Z',
    });
    assert.equal(canonicalDecisionSnapshot([decision]), canonicalDecisionSnapshot([decision]));
    // Not sorted by id: the stored order is the snapshot order.
    assert.notEqual(
      canonicalDecisionSnapshot([decision, second]),
      canonicalDecisionSnapshot([second, decision]),
    );
    assert.equal(canonicalDecisionSnapshot([]), '[]');
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
