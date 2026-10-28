import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_SCHEMA_VERSION,
  canonicalDecisionSnapshot,
  readStoredSession,
} from '../src/core/session.ts';
import type { Decision, DecisionOption, Session } from '../src/core/session.ts';
import { frontier, decisionEligibility, isSettledDecision } from '../src/core/graph.ts';
import {
  answerDecision,
  approvalReadiness,
  approveSession,
  deferDecision,
  pauseSession,
  reconsiderDeferred,
  resumeSession,
} from '../src/core/transitions.ts';

const AT = '2026-10-28T12:00:00.000Z';
const LATER = '2026-10-28T13:30:00.000Z';

const OPTIONS: DecisionOption[] = [
  { id: 'yes', label: 'Just me', consequence: 'Solo.' },
  { id: 'undecided', label: 'I have not decided', consequence: 'Nothing settled.', unresolved: true },
];

function decision(id: string, overrides: Partial<Decision> = {}): Decision {
  return {
    id,
    question: `Question ${id}?`,
    whyItMatters: 'It matters.',
    priority: 'critical',
    prerequisites: [],
    status: 'open',
    options: OPTIONS.map((option) => ({ ...option })),
    updatedAt: AT,
    ...overrides,
  };
}

function answered(id: string, prerequisites: string[] = [], text = 'Just me', overrides: Partial<Decision> = {}): Decision {
  return decision(id, {
    prerequisites,
    status: 'answered',
    answer: { text, chosenOptionId: 'yes', actor: 'user' },
    ...overrides,
  });
}

function session(decisions: Decision[], overrides: Partial<Session> = {}): Session {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: 's1',
    workspace: '/work/one',
    goal: 'Add subscriptions',
    status: 'interviewing',
    decisions,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

const ids = (decisions: readonly Decision[]): string[] => decisions.map((d) => d.id);
const statusOf = (s: Session, id: string): string | undefined =>
  s.decisions.find((d) => d.id === id)?.status;
const byId = (s: Session, id: string): Decision => {
  const found = s.decisions.find((d) => d.id === id);
  assert.ok(found, `expected decision ${id}`);
  return found;
};

/** Every successful transition must hand back state the schema accepts. */
function expectValid(value: unknown): Session {
  const read = readStoredSession(value);
  assert.equal(read.kind, 'ok', `expected a valid v2 session, got ${read.kind}`);
  if (read.kind !== 'ok') throw new Error('unreachable');
  return read.session;
}

function expectOk(result: ReturnType<typeof answerDecision>): Session {
  assert.equal(result.ok, true, result.ok ? '' : `${result.error.code}: ${result.error.message}`);
  if (!result.ok) throw new Error('unreachable');
  return expectValid(result.session);
}

function expectFail(result: ReturnType<typeof answerDecision>, code: string): void {
  assert.equal(result.ok, false, `expected failure ${code}`);
  if (result.ok) return;
  assert.equal(result.error.code, code, `expected ${code}, got ${result.error.code}: ${result.error.message}`);
}

// ---------------------------------------------------------------------------

describe('answer and revise', () => {
  it('1. answers an eligible root decision', () => {
    const before = session([decision('d1')]);
    const after = expectOk(answerDecision(before, 'd1', { text: 'Just me', chosenOptionId: 'yes' }, LATER));

    const d1 = byId(after, 'd1');
    assert.equal(d1.status, 'answered');
    assert.deepEqual(d1.answer, { text: 'Just me', chosenOptionId: 'yes', actor: 'user' });
    assert.equal(d1.updatedAt, LATER);
    assert.equal(after.updatedAt, LATER);
    assert.equal(isSettledDecision(d1), true);
    // The input is untouched.
    assert.equal(before.decisions[0].status, 'open');
    assert.equal(before.updatedAt, AT);
  });

  it('2. rejects an answer while prerequisites remain unresolved', () => {
    const before = session([decision('d1'), decision('d2', { prerequisites: ['d1'] })]);
    const result = answerDecision(before, 'd2', { text: 'Just me', chosenOptionId: 'yes' }, LATER);
    expectFail(result, 'not-eligible');
    if (result.ok) return;
    assert.deepEqual(result.error.pending, ['d1']);
    assert.match(result.error.message, /waiting on d1/);
  });

  it('2b. rejects an answer while the prerequisite is only assumed', () => {
    const before = session([
      decision('d1', { status: 'assumed', answer: { text: 'Probably one team', actor: 'assumption' } }),
      decision('d2', { prerequisites: ['d1'] }),
    ]);
    expectFail(answerDecision(before, 'd2', { text: 'Just me', chosenOptionId: 'yes' }, LATER), 'not-eligible');
  });

  it('3. rejects invalid and undecided answers', () => {
    const before = session([decision('d1')]);
    expectFail(answerDecision(before, 'd1', { text: 'Just me', chosenOptionId: 'nope' }, LATER), 'invalid-option');
    expectFail(answerDecision(before, 'd1', { text: 'I have not decided', chosenOptionId: 'undecided' }, LATER), 'unresolved-answer');
    // The undecided wording by free text is also refused.
    expectFail(answerDecision(before, 'd1', { text: '  i have NOT decided ' }, LATER), 'unresolved-answer');
    expectFail(answerDecision(before, 'd1', { text: '   ' }, LATER), 'unresolved-answer');
  });

  it('3b. rejects the undecided option by identity even when the wording does not match', () => {
    const before = session([decision('d1')]);
    // The text looks like a real decision; the selected option is the one flagged
    // `unresolved`, and option identity is what decides.
    expectFail(
      answerDecision(before, 'd1', { text: 'Deferring this for now', chosenOptionId: 'undecided' }, LATER),
      'unresolved-answer',
    );
  });

  it('3c. accepts a custom answer that merely mentions uncertainty', () => {
    const before = session([decision('d1')]);
    const after = expectOk(answerDecision(before, 'd1', { text: 'Not sure yet - maybe one team' }, LATER));
    assert.equal(byId(after, 'd1').status, 'answered');
  });

  it('3d. rejects an unknown decision id', () => {
    expectFail(answerDecision(session([decision('d1')]), 'nope', { text: 'x' }, LATER), 'unknown-decision');
  });

  it('4. answers an independent decision without changing another', () => {
    const before = session([answered('d1'), decision('d2'), decision('d3', { prerequisites: ['d1'] })]);
    const after = expectOk(answerDecision(before, 'd2', { text: 'Just me', chosenOptionId: 'yes' }, LATER));

    assert.equal(statusOf(after, 'd2'), 'answered');
    // d1 untouched, including its original timestamp.
    assert.deepEqual(byId(after, 'd1'), byId(before, 'd1'));
    // d3 was never answerable and stays as it was.
    assert.deepEqual(byId(after, 'd3'), byId(before, 'd3'));
  });

  it('10. an unchanged answer causes no material invalidation and no timestamp churn', () => {
    const before = session([answered('d1'), answered('d2', ['d1'])]);
    const after = expectOk(answerDecision(before, 'd1', { text: 'Just me', chosenOptionId: 'yes' }, LATER));

    // A no-op returns the session unchanged; this is what stops a harmless
    // re-confirmation from invalidating d2 or revoking an approval.
    assert.deepEqual(after, before);
    assert.equal(statusOf(after, 'd1'), 'answered');
    assert.equal(statusOf(after, 'd2'), 'answered');
    assert.equal(byId(after, 'd1').updatedAt, AT);
  });

  it('10b. re-wording the same option is treated as material', () => {
    const before = session([answered('d1'), answered('d2', ['d1'])]);
    const after = expectOk(answerDecision(before, 'd1', { text: 'Only me', chosenOptionId: 'yes' }, LATER));
    // The snapshot covers the text, so a wording change invalidates dependents.
    assert.equal(statusOf(after, 'd2'), 'needs_review');
  });

  it('10c. reconfirming a stale answer restores it, and readiness with it', () => {
    // Change the root, which makes the dependent stale.
    const revised = expectOk(answerDecision(
      session([answered('d1'), answered('d2', ['d1'], 'One team')]),
      'd1',
      { text: 'Many teams' },
      LATER,
    ));
    assert.equal(statusOf(revised, 'd2'), 'needs_review');
    assert.equal(approvalReadiness(revised).ready, false);

    // The person confirms the dependent's exact previous text and option id.
    const reconfirmed = expectOk(answerDecision(
      revised,
      'd2',
      { text: 'One team', chosenOptionId: 'yes' },
      '2026-10-28T14:00:00.000Z',
    ));

    const d2 = byId(reconfirmed, 'd2');
    assert.equal(d2.status, 'answered', 'an explicit reconfirmation must settle the decision');
    assert.deepEqual(d2.answer, { text: 'One team', chosenOptionId: 'yes', actor: 'user' });
    assert.equal(d2.updatedAt, '2026-10-28T14:00:00.000Z');
    // Readiness is restored by confirming, not by any automatic repair.
    assert.equal(approvalReadiness(reconfirmed).ready, true);
  });

  it('10d. reconfirmation on a deeper chain restores one level at a time', () => {
    const revised = expectOk(answerDecision(
      session([answered('d1'), answered('d2', ['d1']), answered('d3', ['d2'])]),
      'd1',
      { text: 'Many teams' },
      LATER,
    ));
    assert.equal(statusOf(revised, 'd2'), 'needs_review');
    assert.equal(statusOf(revised, 'd3'), 'needs_review');

    // d3 cannot be confirmed while d2 is still stale: prerequisites must hold.
    expectFail(answerDecision(revised, 'd3', { text: 'Just me', chosenOptionId: 'yes' }, LATER), 'not-eligible');

    const afterD2 = expectOk(answerDecision(revised, 'd2', { text: 'Just me', chosenOptionId: 'yes' }, LATER));
    assert.equal(statusOf(afterD2, 'd2'), 'answered');
    // d3 stays stale until it is reconsidered on its own.
    assert.equal(statusOf(afterD2, 'd3'), 'needs_review');
    assert.equal(approvalReadiness(afterD2).ready, false);

    const afterD3 = expectOk(answerDecision(afterD2, 'd3', { text: 'Just me', chosenOptionId: 'yes' }, LATER));
    assert.equal(statusOf(afterD3, 'd3'), 'answered');
    assert.equal(approvalReadiness(afterD3).ready, true);
  });

  it('10e. a genuinely unchanged settled answer stays a true no-op', () => {
    const before = session([answered('d1'), answered('d2', ['d1'])]);
    const after = expectOk(answerDecision(before, 'd1', { text: 'Just me', chosenOptionId: 'yes' }, LATER));
    // Byte-for-byte identical: no timestamp bump, no invalidation.
    assert.deepEqual(after, before);
  });

  it('10f. reconfirmation never approves or restores approval on its own', () => {
    const revised = expectOk(answerDecision(
      session([answered('d1'), answered('d2', ['d1'])]),
      'd1',
      { text: 'Many teams' },
      LATER,
    ));
    const reconfirmed = expectOk(answerDecision(revised, 'd2', { text: 'Just me', chosenOptionId: 'yes' }, LATER));

    assert.equal(approvalReadiness(reconfirmed).ready, true);
    // Ready, but not approved: readiness is still a calculation.
    assert.equal(reconfirmed.status, 'interviewing');
    assert.equal(reconfirmed.approvedAt, undefined);
    assert.equal(reconfirmed.approvedSnapshot, undefined);
  });
});

describe('transitive invalidation', () => {
  it('5. revising a parent invalidates its immediate dependents', () => {
    const before = session([answered('d1'), answered('d2', ['d1']), answered('d3')]);
    const after = expectOk(answerDecision(before, 'd1', { text: 'One team', chosenOptionId: 'yes' }, LATER));

    assert.equal(statusOf(after, 'd1'), 'answered');
    assert.equal(byId(after, 'd1').answer?.text, 'One team');
    assert.equal(statusOf(after, 'd2'), 'needs_review');
    // d3 does not depend on d1.
    assert.equal(statusOf(after, 'd3'), 'answered');
    assert.deepEqual(byId(after, 'd3'), byId(before, 'd3'));
  });

  it('6. invalidates across multiple graph levels', () => {
    const before = session([
      answered('d1'),
      answered('d2', ['d1']),
      answered('d3', ['d2']),
      answered('d4', ['d3']),
    ]);
    const after = expectOk(answerDecision(before, 'd1', { text: 'One team' }, LATER));

    for (const id of ['d2', 'd3', 'd4']) {
      assert.equal(statusOf(after, id), 'needs_review', `${id} should be stale`);
    }
  });

  it('7. a shared descendant is invalidated exactly once', () => {
    // d4 is reachable from d1 through both d2 and d3.
    const before = session([
      answered('d1'),
      answered('d2', ['d1']),
      answered('d3', ['d1']),
      answered('d4', ['d2', 'd3'], 'Just me'),
    ]);
    const after = expectOk(answerDecision(before, 'd1', { text: 'One team' }, LATER));

    assert.deepEqual(ids(after.decisions), ['d1', 'd2', 'd3', 'd4']);
    const d4 = after.decisions.filter((d) => d.id === 'd4');
    assert.equal(d4.length, 1, 'a decision must appear once');
    assert.equal(d4[0].status, 'needs_review');
    assert.equal(d4[0].updatedAt, LATER);
  });

  it('8. previous dependent answers are retained, marked stale', () => {
    const before = session([answered('d1'), answered('d2', ['d1'], 'One team')]);
    const after = expectOk(answerDecision(before, 'd1', { text: 'Many teams' }, LATER));

    const d2 = byId(after, 'd2');
    assert.equal(d2.status, 'needs_review');
    assert.deepEqual(d2.answer, { text: 'One team', chosenOptionId: 'yes', actor: 'user' });
    // Retained but never settled: this is the whole point of the status.
    assert.equal(isSettledDecision(d2), false);
  });

  it('8b. an unanswered dependent keeps its status; eligibility stays derived', () => {
    const before = session([
      answered('d1'),
      decision('d2', { prerequisites: ['d1'], status: 'blocked' }),
      decision('d3', { prerequisites: ['d2'], status: 'blocked' }),
    ]);
    const after = expectOk(answerDecision(before, 'd1', { text: 'One team' }, LATER));

    // Neither held an answer, so there is nothing stale to review. Stored status
    // is history and invalidation does not rewrite it.
    assert.equal(statusOf(after, 'd2'), 'blocked');
    assert.equal(statusOf(after, 'd3'), 'blocked');

    // d1 is still settled, so d2 is derivably answerable despite the stored status.
    assert.deepEqual(decisionEligibility(after.decisions, byId(after, 'd2')), { kind: 'eligible' });
    // d3 stays blocked because d2 still holds no answer -- derived, not asserted.
    assert.deepEqual(decisionEligibility(after.decisions, byId(after, 'd3')), { kind: 'blocked', pending: ['d2'] });
  });

  it('8c. a deferred dependent is not reopened by invalidation', () => {
    const before = session([
      answered('d1'),
      decision('d2', { prerequisites: ['d1'], status: 'deferred', priority: 'minor' }),
    ]);
    const after = expectOk(answerDecision(before, 'd1', { text: 'One team' }, LATER));
    assert.equal(statusOf(after, 'd2'), 'deferred');
  });

  it('9. unrelated and sibling settled answers are preserved exactly', () => {
    const before = session([
      answered('root'),
      answered('a', ['root']),
      answered('b', ['root']),
      answered('unrelated', [], 'Just me'),
    ]);
    const after = expectOk(answerDecision(before, 'a', { text: 'One team' }, LATER));

    assert.equal(statusOf(after, 'a'), 'answered');
    // 'b' is a sibling under 'root', not a dependent of 'a': untouched.
    assert.deepEqual(byId(after, 'b'), byId(before, 'b'));
    assert.equal(statusOf(after, 'b'), 'answered');
    // 'unrelated' shares no path with 'a' at all.
    assert.deepEqual(byId(after, 'unrelated'), byId(before, 'unrelated'));
  });

  it('revising an already-stale decision is idempotent for its descendants', () => {
    const once = expectOk(answerDecision(
      session([answered('d1'), answered('d2', ['d1'])]),
      'd1',
      { text: 'One team' },
      LATER,
    ));
    const twice = expectOk(answerDecision(once, 'd1', { text: 'Many teams' }, LATER));

    assert.equal(statusOf(twice, 'd2'), 'needs_review');
    // Already stale, so no second timestamp churn.
    assert.equal(byId(twice, 'd2').updatedAt, LATER);
  });
});

describe('deferral', () => {
  it('11. accepts deferral of a non-critical decision', () => {
    const before = session([decision('d1', { priority: 'minor' })]);
    const result = deferDecision(before, 'd1', LATER);
    if (!result.ok) throw new Error(result.error.message);
    const after = expectValid(result.session);

    assert.equal(statusOf(after, 'd1'), 'deferred');
    assert.equal(byId(after, 'd1').answer, undefined);
    assert.deepEqual(decisionEligibility(after.decisions, byId(after, 'd1')), { kind: 'deferred' });
  });

  it('12. rejects deferral of a critical decision', () => {
    const result = deferDecision(session([decision('d1', { priority: 'critical' })]), 'd1', LATER);
    expectFail(result, 'critical-deferral');
  });

  it('12b. rejects deferring a decision that carries an answer', () => {
    const settled = deferDecision(session([answered('d1')]), 'd1', LATER);
    expectFail(settled, 'critical-deferral'); // critical is refused first, as policy

    const nonCritical = deferDecision(
      session([answered('d2', [], 'Just me', { priority: 'minor' })]),
      'd2',
      LATER,
    );
    expectFail(nonCritical, 'already-settled');

    // needs_review retains an answer; deferring it would discard history.
    const stale = deferDecision(
      session([decision('d3', {
        priority: 'minor',
        status: 'needs_review',
        answer: { text: 'Just me', chosenOptionId: 'yes', actor: 'user' },
      })]),
      'd3',
      LATER,
    );
    expectFail(stale, 'retains-answer');
  });

  it('13. a deferred prerequisite keeps dependents ineligible', () => {
    const before = session([
      decision('d1', { priority: 'minor' }),
      decision('d2', { prerequisites: ['d1'] }),
      decision('d3', { prerequisites: ['d2'] }),
    ]);
    const deferred = deferDecision(before, 'd1', LATER);
    if (!deferred.ok) throw new Error(deferred.error.message);
    const after = expectValid(deferred.session);

    assert.deepEqual(ids(frontier(after.decisions)), []);
    assert.deepEqual(decisionEligibility(after.decisions, byId(after, 'd2')), { kind: 'blocked', pending: ['d1'] });
    // A deferred prerequisite can never let a downstream critical decision settle.
    expectFail(answerDecision(after, 'd3', { text: 'Just me' }, LATER), 'not-eligible');
  });

  it('14. deferral is not reopened automatically, only reconsidered explicitly', () => {
    const before = session([decision('d1', { priority: 'minor' })]);
    const deferred = deferDecision(before, 'd1', LATER);
    if (!deferred.ok) throw new Error(deferred.error.message);
    const after = deferred.session;

    // Answering a deferred decision is refused until it is reconsidered.
    expectFail(answerDecision(after, 'd1', { text: 'Just me' }, LATER), 'deferred-decision');

    const reopened = reconsiderDeferred(after, 'd1', LATER);
    if (!reopened.ok) throw new Error(reopened.error.message);
    const reconsidered = expectValid(reopened.session);
    assert.equal(statusOf(reconsidered, 'd1'), 'open');
    assert.deepEqual(ids(frontier(reconsidered.decisions)), ['d1']);
  });

  it('14b. reconsidering a decision that is not deferred is refused', () => {
    expectFail(reconsiderDeferred(session([decision('d1')]), 'd1', LATER), 'not-deferred');
  });

  it('14c. repeated deferral is a stable no-op', () => {
    const before = session([decision('d1', { priority: 'minor' })]);
    const once = deferDecision(before, 'd1', LATER);
    if (!once.ok) throw new Error(once.error.message);
    const twice = deferDecision(once.session, 'd1', '2026-10-28T15:00:00.000Z');
    if (!twice.ok) throw new Error(twice.error.message);
    assert.deepEqual(twice.session, once.session);
  });
});

describe('pause and resume', () => {
  it('15. pauses and resumes without losing any decision', () => {
    const before = session([answered('d1'), decision('d2', { prerequisites: ['d1'] })]);

    const paused = pauseSession(before, LATER);
    if (!paused.ok) throw new Error(paused.error.message);
    const pausedSession = expectValid(paused.session);
    assert.equal(pausedSession.status, 'paused');
    assert.deepEqual(pausedSession.decisions, before.decisions);
    assert.equal(pausedSession.updatedAt, LATER);

    const resumed = resumeSession(pausedSession, '2026-10-28T14:00:00.000Z');
    if (!resumed.ok) throw new Error(resumed.error.message);
    const resumedSession = expectValid(resumed.session);

    // No decisions lost, and resume lands in interviewing rather than inventing
    // a review state the session never recorded.
    assert.equal(resumedSession.status, 'interviewing');
    assert.deepEqual(resumedSession.decisions, before.decisions);
    assert.equal(isSettledDecision(byId(resumedSession, 'd1')), true);
    assert.deepEqual(ids(frontier(resumedSession.decisions)), ids(frontier(before.decisions)));
  });

  it('15b. repeated pause and resume requests are safe', () => {
    const before = session([decision('d1')]);
    const once = pauseSession(before, LATER);
    if (!once.ok) throw new Error(once.error.message);
    const twice = pauseSession(once.session, '2026-10-28T14:00:00.000Z');
    if (!twice.ok) throw new Error(twice.error.message);
    assert.deepEqual(twice.session, once.session);

    const resumed = resumeSession(before, LATER);
    if (!resumed.ok) throw new Error(resumed.error.message);
    assert.deepEqual(resumed.session, before);
  });

  it('15c. refuses to pause an approved session', () => {
    const approved = approveSession(
      session([answered('d1')]),
      { confirmed: true },
      LATER,
    );
    if (!approved.ok) throw new Error(approved.error.message);
    expectFail(pauseSession(approved.session, LATER), 'approved-session');
  });
});

describe('approval readiness', () => {
  it('16. is blocked by open critical decisions', () => {
    const readiness = approvalReadiness(session([decision('d1'), answered('d2')]));
    assert.equal(readiness.ready, false);
    assert.equal(readiness.blockers.length, 1);
    assert.equal(readiness.blockers[0].kind, 'unsettled-critical');
    assert.equal(readiness.blockers[0].decisionId, 'd1');
  });

  it('16b. is not blocked by open non-critical decisions', () => {
    const readiness = approvalReadiness(session([
      answered('d1'),
      decision('d2', { priority: 'minor' }),
    ]));
    assert.equal(readiness.ready, true);
    assert.deepEqual(readiness.blockers, []);
  });

  it('16c. is blocked when there is nothing to approve', () => {
    const readiness = approvalReadiness(session([]));
    assert.equal(readiness.ready, false);
    assert.equal(readiness.blockers[0].kind, 'no-decisions');
  });

  it('16d. is blocked by a deferred critical decision', () => {
    const readiness = approvalReadiness(session([
      decision('d1', { priority: 'critical', status: 'deferred' }),
    ]));
    assert.equal(readiness.ready, false);
    assert.equal(readiness.blockers[0].kind, 'deferred-critical');
  });

  it('17. is blocked by stale dependent decisions', () => {
    const revised = expectOk(answerDecision(
      session([answered('d1'), answered('d2', ['d1']), answered('d3', ['d2'])]),
      'd1',
      { text: 'One team' },
      LATER,
    ));
    const readiness = approvalReadiness(revised);
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.blockers.map((b) => b.decisionId), ['d2', 'd3']);
    assert.ok(readiness.blockers.every((b) => b.kind === 'needs-review'));
  });

  it('17b. re-confirming stale decisions restores readiness', () => {
    const revised = expectOk(answerDecision(
      session([answered('d1'), answered('d2', ['d1'])]),
      'd1',
      { text: 'One team' },
      LATER,
    ));
    assert.equal(approvalReadiness(revised).ready, false);

    const reconfirmed = expectOk(answerDecision(revised, 'd2', { text: 'One team' }, LATER));
    assert.equal(statusOf(reconfirmed, 'd2'), 'answered');
    assert.equal(approvalReadiness(reconfirmed).ready, true);
  });

  it('18. rejects unconfirmed assumptions', () => {
    const readiness = approvalReadiness(session([
      decision('d1', { status: 'assumed', answer: { text: 'Probably one team', actor: 'assumption' } }),
    ]));
    assert.equal(readiness.ready, false);
    assert.equal(readiness.blockers[0].kind, 'assumption-not-confirmed');
  });

  it('19. readiness is a pure calculation that does not approve or mutate', () => {
    const before = session([answered('d1')]);
    const snapshot = structuredClone(before);
    const readiness = approvalReadiness(before);

    assert.equal(readiness.ready, true);
    // Ready is not approved.
    assert.deepEqual(before, snapshot);
    assert.equal(before.status, 'interviewing');
    assert.equal(before.approvedAt, undefined);
    assert.equal(before.approvedSnapshot, undefined);
  });
});

describe('explicit approval', () => {
  it('20. records a deterministic canonical snapshot', () => {
    const ready = session([answered('d1'), answered('d2', ['d1'])]);
    const first = approveSession(ready, { confirmed: true }, LATER);
    if (!first.ok) throw new Error(first.error.message);

    assert.equal(first.session.status, 'approved');
    assert.equal(first.session.approvedAt, LATER);
    assert.equal(first.session.approvedSnapshot, canonicalDecisionSnapshot(first.session.decisions));

    // Deterministic: the same decisions always produce the same snapshot.
    const second = approveSession(ready, { confirmed: true }, LATER);
    if (!second.ok) throw new Error(second.error.message);
    assert.equal(second.session.approvedSnapshot, first.session.approvedSnapshot);
    expectValid(first.session);
  });

  it('19b. refuses approval without an explicit confirmation', () => {
    const ready = session([answered('d1')]);
    expectFail(approveSession(ready, undefined, LATER), 'not-confirmed');
    expectFail(approveSession(ready, { confirmed: false }, LATER), 'not-confirmed');
    // A truthy non-boolean is not a confirmation.
    expectFail(approveSession(ready, { confirmed: 'yes' as unknown as boolean }, LATER), 'not-confirmed');
  });

  it('19c. refuses approval when readiness fails, reporting the blockers', () => {
    const result = approveSession(session([decision('d1')]), { confirmed: true }, LATER);
    expectFail(result, 'not-ready');
    if (result.ok) return;
    assert.equal(result.error.blockers?.[0].kind, 'unsettled-critical');

    expectFail(approveSession(session([]), { confirmed: true }, LATER), 'not-ready');
  });

  it('19d. an empty frontier alone never approves', () => {
    // Every decision is settled and the frontier is empty, but nothing here approves.
    const ready = session([answered('d1'), answered('d2', ['d1'])]);
    assert.deepEqual(ids(frontier(ready.decisions)), []);
    assert.equal(ready.status, 'interviewing');
    assert.equal(ready.approvedAt, undefined);
  });

  it('21. a material edit after approval revokes it', () => {
    const approved = approveSession(session([answered('d1'), answered('d2', ['d1'])]), { confirmed: true }, LATER);
    if (!approved.ok) throw new Error(approved.error.message);
    assert.equal(approved.session.status, 'approved');

    const edited = expectOk(answerDecision(approved.session, 'd1', { text: 'Many teams' }, '2026-10-28T16:00:00.000Z'));

    assert.equal(edited.status, 'interviewing');
    assert.equal(edited.approvedAt, undefined);
    assert.equal(edited.approvedSnapshot, undefined);
    assert.equal(statusOf(edited, 'd2'), 'needs_review');
    expectValid(edited);
  });

  it('21b. a no-op re-answer does not revoke approval', () => {
    const approved = approveSession(session([answered('d1')]), { confirmed: true }, LATER);
    if (!approved.ok) throw new Error(approved.error.message);

    const same = expectOk(answerDecision(approved.session, 'd1', { text: 'Just me', chosenOptionId: 'yes' }, '2026-10-28T17:00:00.000Z'));
    assert.equal(same.status, 'approved');
    assert.equal(same.approvedAt, LATER);
    assert.equal(same.approvedSnapshot, approved.session.approvedSnapshot);
  });

  it('21c. approval is revoked when an edit changes the snapshot, not merely attempted', () => {
    const approved = approveSession(session([answered('d1')]), { confirmed: true }, LATER);
    if (!approved.ok) throw new Error(approved.error.message);

    // A refused edit must not revoke anything.
    expectFail(answerDecision(approved.session, 'ghost', { text: 'x' }, LATER), 'unknown-decision');
    assert.equal(approved.session.status, 'approved');
    assert.equal(approved.session.approvedAt, LATER);
  });

  it('21d. edit then revert does not restore the previous approval', () => {
    const approved = approveSession(session([answered('d1')]), { confirmed: true }, LATER);
    if (!approved.ok) throw new Error(approved.error.message);
    const originalSnapshot = approved.session.approvedSnapshot;
    assert.equal(approved.session.status, 'approved');

    // A material edit revokes and clears the metadata.
    const edited = expectOk(answerDecision(approved.session, 'd1', { text: 'Many teams' }, LATER));
    assert.equal(edited.status, 'interviewing');
    assert.equal(edited.approvedAt, undefined);
    assert.equal(edited.approvedSnapshot, undefined);

    // Reverting to the original text is still a material edit, and there is no
    // approval left to compare against, so nothing is restored.
    const reverted = expectOk(answerDecision(edited, 'd1', { text: 'Just me', chosenOptionId: 'yes' }, LATER));
    assert.equal(reverted.status, 'interviewing');
    assert.equal(reverted.approvedAt, undefined);
    assert.equal(reverted.approvedSnapshot, undefined);
    assert.notEqual(reverted.approvedSnapshot, originalSnapshot);
    // The decisions are back to what was approved, but approval is not.
    assert.equal(approvalReadiness(reverted).ready, true);

    // Fresh explicit approval is the only way back.
    const reapproved = approveSession(reverted, { confirmed: true }, '2026-10-28T20:00:00.000Z');
    if (!reapproved.ok) throw new Error(reapproved.error.message);
    assert.equal(reapproved.session.status, 'approved');
    assert.equal(reapproved.session.approvedAt, '2026-10-28T20:00:00.000Z');
  });
});

describe('paused interviews refuse changes', () => {
  function paused(): Session {
    const result = pauseSession(session([answered('d1'), decision('d2'), decision('d3', { priority: 'minor' })]), LATER);
    if (!result.ok) throw new Error(result.error.message);
    return result.session;
  }

  it('a paused interview accepts no answer, deferral or reconsideration', () => {
    const current = paused();
    expectFail(answerDecision(current, 'd2', { text: 'Just me' }, LATER), 'paused-session');
    expectFail(deferDecision(current, 'd3', LATER), 'paused-session');
    // d1 is not deferred, so reconsideration would normally be refused as
    // `not-deferred`; the paused barrier is what answers first.
    expectFail(reconsiderDeferred(current, 'd1', LATER), 'paused-session');
  });

  it('a paused interview cannot be approved', () => {
    const current = paused();
    // Ready as far as readiness is concerned, and still refused.
    expectFail(approveSession(current, { confirmed: true }, LATER), 'paused-session');
  });

  it('the paused session is left exactly as it was', () => {
    const current = paused();
    const snapshot = structuredClone(current);
    answerDecision(current, 'd2', { text: 'Just me' }, LATER);
    approveSession(current, { confirmed: true }, LATER);
    assert.deepEqual(current, snapshot);
  });
});

describe('safety', () => {
  it('22. invalid operations leave the input session unchanged', () => {
    const before = session([
      decision('d1', { priority: 'minor' }),
      decision('d2', { prerequisites: ['d1'] }),
      decision('d3', { priority: 'critical' }),
    ]);
    const snapshot = structuredClone(before);

    answerDecision(before, 'missing', { text: 'x' }, LATER);
    answerDecision(before, 'd2', { text: 'x' }, LATER);
    answerDecision(before, 'd1', { text: 'x', chosenOptionId: 'ghost' }, LATER);
    answerDecision(before, 'd1', { text: 'I have not decided' }, LATER);
    deferDecision(before, 'd3', LATER);
    reconsiderDeferred(before, 'd1', LATER);
    approveSession(before, undefined, LATER);
    approveSession(before, { confirmed: true }, LATER);

    assert.deepEqual(before, snapshot);
  });

  it('22b. a successful transition never mutates the input', () => {
    const before = session([answered('d1'), answered('d2', ['d1'])]);
    const snapshot = structuredClone(before);
    answerDecision(before, 'd1', { text: 'One team' }, LATER);
    deferDecision(session([decision('m', { priority: 'minor' })]), 'm', LATER);
    pauseSession(before, LATER);
    approveSession(session([answered('x')]), { confirmed: true }, LATER);
    assert.deepEqual(before, snapshot);
  });

  it('23. repeated identical operations are deterministic', () => {
    const before = session([answered('d1'), answered('d2', ['d1'])]);
    const a = expectOk(answerDecision(before, 'd1', { text: 'One team' }, LATER));
    const b = expectOk(answerDecision(before, 'd1', { text: 'One team' }, LATER));
    assert.deepEqual(a, b);

    const p1 = pauseSession(before, LATER);
    const p2 = pauseSession(before, LATER);
    assert.deepEqual(p1, p2);
  });

  it('24. empty, malformed and inconsistent sessions fail safely', () => {
    const junk: unknown[] = [undefined, null, 42, 'session', [], {}];
    for (const value of junk) {
      expectFail(answerDecision(value as Session, 'd1', { text: 'x' }, LATER), 'invalid-session');
      expectFail(deferDecision(value as Session, 'd1', LATER), 'invalid-session');
      expectFail(pauseSession(value as Session, LATER), 'invalid-session');
      expectFail(approveSession(value as Session, { confirmed: true }, LATER), 'invalid-session');
      assert.equal(approvalReadiness(value as Session).ready, false);
    }
  });

  it('24b. a session with a broken dependency graph is refused', () => {
    const broken = session([decision('d1', { prerequisites: ['ghost'] })]);
    expectFail(answerDecision(broken, 'd1', { text: 'x' }, LATER), 'invalid-session');
    expectFail(pauseSession(broken, LATER), 'invalid-session');
    assert.equal(approvalReadiness(broken).ready, false);
  });

  it('24c. a malformed decision inside the session is refused', () => {
    const malformed = session([{ id: 'd1' } as unknown as Decision]);
    expectFail(pauseSession(malformed, LATER), 'invalid-session');
    assert.equal(approvalReadiness(malformed).ready, false);
  });

  it('24d. malformed answer payloads return a typed failure instead of throwing', () => {
    const before = session([decision('d1')]);
    const snapshot = structuredClone(before);
    const payloads: unknown[] = [null, undefined, 42, 'Just me', [], { text: 42 }, {}];

    for (const payload of payloads) {
      const result = answerDecision(before, 'd1', payload as never, LATER);
      assert.equal(result.ok, false, `expected a refusal for ${JSON.stringify(payload)}`);
      if (result.ok) continue;
      assert.equal(result.error.code, 'invalid-answer');
    }
    // The session is untouched by every malformed call.
    assert.deepEqual(before, snapshot);
  });

  it('24e. malformed confirmations return a typed failure instead of throwing', () => {
    const ready = session([answered('d1')]);
    const snapshot = structuredClone(ready);
    const payloads: unknown[] = [null, undefined, 42, 'yes', [], {}, { confirmed: 'yes' }, { confirmed: 1 }];

    for (const payload of payloads) {
      const result = approveSession(ready, payload as never, LATER);
      assert.equal(result.ok, false, `expected a refusal for ${JSON.stringify(payload)}`);
      if (result.ok) continue;
      assert.equal(result.error.code, 'not-confirmed');
    }
    assert.deepEqual(ready, snapshot);
  });

  it('24f. malformed ids and timestamps do not throw', () => {
    const before = session([decision('d1')]);
    for (const id of [null, undefined, 42, {}, []] as unknown[]) {
      assert.equal(answerDecision(before, id as never, { text: 'x' }, LATER).ok, false);
      assert.equal(deferDecision(before, id as never, LATER).ok, false);
      assert.equal(reconsiderDeferred(before, id as never, LATER).ok, false);
    }
    // A junk timestamp must not silently produce invalid state.
    const junkTime = answerDecision(before, 'd1', { text: 'Just me' }, undefined as never);
    assert.equal(junkTime.ok, false, 'a missing timestamp must not produce an invalid session');
  });
});

describe('approval and prerequisite consistency', () => {
  /** D1 non-critical and deferred; D2 critical and answered on top of it. */
  function contradictorySession(): Session {
    return session([
      decision('d1', { priority: 'minor', status: 'deferred' }),
      // Structurally valid, semantically impossible: answered on unsettled ground.
      answered('d2', ['d1']),
    ]);
  }

  it('25. readiness rejects a settled decision resting on an unsettled prerequisite', () => {
    const readiness = approvalReadiness(contradictorySession());
    assert.equal(readiness.ready, false);
    const blocker = readiness.blockers.find((b) => b.kind === 'unmet-prerequisite');
    assert.ok(blocker, `expected an unmet-prerequisite blocker, got ${JSON.stringify(readiness.blockers)}`);
    assert.equal(blocker.decisionId, 'd2');
    assert.deepEqual(blocker.pending, ['d1']);
  });

  it('26. direct approval of that session is refused', () => {
    const result = approveSession(contradictorySession(), { confirmed: true }, LATER);
    expectFail(result, 'not-ready');
    if (result.ok) return;
    assert.ok(result.error.blockers?.some((b) => b.kind === 'unmet-prerequisite'));
  });

  it('27. a fabricated matching snapshot does not make it loadable', () => {
    const decisions = contradictorySession().decisions;
    const forged = {
      ...contradictorySession(),
      status: 'approved' as const,
      approvedAt: LATER,
      // A perfectly valid-looking snapshot of these very decisions.
      approvedSnapshot: canonicalDecisionSnapshot(decisions),
    };
    const read = readStoredSession(forged);
    assert.equal(read.kind, 'unreadable');
    if (read.kind !== 'unreadable') return;
    assert.match(read.reason, /prerequisites are unresolved/);
  });

  it('28. non-critical deferrals that undermine nothing are still allowed', () => {
    // A deferred minor decision with no settled dependent blocks nothing.
    const fine = session([
      answered('d1'),
      decision('d2', { priority: 'minor', status: 'deferred' }),
      answered('d3', ['d1']),
    ]);
    assert.equal(approvalReadiness(fine).ready, true);

    const approved = approveSession(fine, { confirmed: true }, LATER);
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.equal(readStoredSession(approved.session).kind, 'ok');
  });

  it('29. deferral cannot create the contradiction through the transitions', () => {
    // d1 is non-critical and unanswered, so it is deferrable; d2 was never
    // answerable while d1 was open, so it cannot end up settled on top of it.
    const before = session([decision('d1', { priority: 'minor' }), decision('d2', { prerequisites: ['d1'] })]);
    expectFail(answerDecision(before, 'd2', { text: 'Just me' }, LATER), 'not-eligible');

    const deferred = deferDecision(before, 'd1', LATER);
    if (!deferred.ok) throw new Error(deferred.error.message);
    expectFail(answerDecision(deferred.session, 'd2', { text: 'Just me' }, LATER), 'not-eligible');
    // Readiness stays consistent with what validation would accept.
    assert.equal(approvalReadiness(deferred.session).ready, false);
  });
});

describe('full interview walkthrough', () => {
  it('drives a three-decision graph from open to approved, then reopens on edit', () => {
    // M1 decision package example: D1 root, D2 and D3 depend on D1.
    let current = session([
      decision('d1'),
      decision('d2', { prerequisites: ['d1'] }),
      decision('d3', { prerequisites: ['d1'] }),
    ]);

    assert.deepEqual(ids(frontier(current.decisions)), ['d1']);
    assert.equal(approvalReadiness(current).ready, false);

    current = expectOk(answerDecision(current, 'd1', { text: 'One team' }, LATER));
    assert.deepEqual(ids(frontier(current.decisions)), ['d2', 'd3']);

    current = expectOk(answerDecision(current, 'd2', { text: 'Just me' }, LATER));
    current = expectOk(answerDecision(current, 'd3', { text: 'Just me' }, LATER));
    assert.deepEqual(ids(frontier(current.decisions)), []);
    assert.equal(approvalReadiness(current).ready, true);
    // Ready, but still not approved.
    assert.equal(current.status, 'interviewing');

    const approved = approveSession(current, { confirmed: true }, LATER);
    if (!approved.ok) throw new Error(approved.error.message);
    current = expectValid(approved.session);
    assert.equal(current.status, 'approved');

    // Revise the root: both dependents go stale and approval is revoked.
    current = expectOk(answerDecision(current, 'd1', { text: 'Many teams' }, '2026-10-28T18:00:00.000Z'));
    assert.equal(current.status, 'interviewing');
    assert.equal(statusOf(current, 'd2'), 'needs_review');
    assert.equal(statusOf(current, 'd3'), 'needs_review');
    assert.equal(approvalReadiness(current).ready, false);

    // Reconfirming both dependents makes it approvable again, with a new snapshot.
    current = expectOk(answerDecision(current, 'd2', { text: 'Many teams' }, LATER));
    current = expectOk(answerDecision(current, 'd3', { text: 'Many teams' }, LATER));
    assert.equal(approvalReadiness(current).ready, true);

    const reapproved = approveSession(current, { confirmed: true }, '2026-10-28T19:00:00.000Z');
    if (!reapproved.ok) throw new Error(reapproved.error.message);
    assert.equal(reapproved.session.status, 'approved');
    expectValid(reapproved.session);
  });
});
