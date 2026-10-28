import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import nailItDown from '../src/index.ts';
import { ACTIONS, APPROVAL, TITLES } from '../src/core/copy.ts';
import { FakeHost } from './fakeHost.ts';
import type { StoreData } from './fakeHost.ts';
import { readStoredSession } from '../src/core/session.ts';
import type { Session } from '../src/core/session.ts';
import { sessionKeyFor, storeKeyFor } from '../src/core/persistence.ts';
import { startRecord, withAnswer, withApproval } from '../src/core/record.ts';
import { INTERVIEW, createInterviewSession } from '../src/core/interview.ts';
import { answerDecision, approveSession } from '../src/core/transitions.ts';

const WORKSPACE = '/work/example';
const V2 = sessionKeyFor(WORKSPACE);
const V1 = storeKeyFor(WORKSPACE);

/** Question labels, in the order the graph makes them answerable. */
const Q1 = 'Who is going to use this?';
const Q2 = "What is the first version's intended scope?";
const Q3 = 'What outcome would demonstrate that the first version works?';
const A1 = 'Just me';
const A2 = 'One job, end to end';
const A3 = 'I use it for real work';

function hostWith(options: ConstructorParameters<typeof FakeHost>[0] = {}): FakeHost {
  const host = new FakeHost({ cwd: WORKSPACE, ...options });
  nailItDown(host);
  return host;
}

function storedSession(data: StoreData): Session {
  const read = readStoredSession(data.get(V2));
  assert.equal(read.kind, 'ok', 'expected a valid v2 session in the store');
  if (read.kind !== 'ok') throw new Error('unreachable');
  return read.session;
}

/** Starts a goal and answers the three questions, stopping at the action menu. */
function completeInterview(options: ConstructorParameters<typeof FakeHost>[0] = {}): FakeHost {
  return hostWith({ ...options, selectAnswers: [A1, A2, A3] });
}

describe('M1 registration and help', () => {
  it('registers one /naildown command with an M1 argument hint', () => {
    const host = hostWith();
    assert.ok(host.command);
    assert.equal(host.command.name, 'naildown');
    assert.match(host.command.argumentHint ?? '', /resume/);
  });

  it('explains the command without opening a dialog or saving anything', async () => {
    const host = hostWith();
    const message = await host.run('');
    assert.match(message, /naildown resume/);
    assert.equal(host.selectCalls.length, 0);
    assert.equal(host.data.size, 0);
  });
});

describe('AC1/AC2/AC5: three-decision flow and frontier order', () => {
  it('asks the root first, then both dependents in source order', async () => {
    const host = completeInterview();
    await host.run('Add subscriptions');

    assert.deepEqual(host.questionCalls.map((call) => call.title), [Q1, Q2, Q3]);

    const session = storedSession(host.data);
    assert.equal(session.goal, 'Add subscriptions');
    assert.deepEqual(
      session.decisions.map((decision) => [decision.id, decision.status]),
      [['who-uses-this', 'answered'], ['first-scope', 'answered'], ['proof-of-working', 'answered']],
    );
    assert.equal(session.approvedAt, undefined);
  });

  it('does not ask a dependent before the root is confirmed (AC5)', async () => {
    // Dismiss the root question: nothing else may be asked.
    const host = hostWith({ selectAnswers: [undefined] });
    await host.run('Add subscriptions');

    assert.deepEqual(host.questionCalls.map((call) => call.title), [Q1]);
    const session = storedSession(host.data);
    assert.equal(session.decisions[0].status, 'open');
    assert.deepEqual(
      session.decisions.slice(1).map((decision) => decision.status),
      ['open', 'open'],
    );
  });

  it('offers the two dependents together, both ahead of any third question', async () => {
    // Only the root is answered; the next two prompts are the dependents.
    const host = hostWith({ selectAnswers: [A1, A2, A3] });
    await host.run('Add subscriptions');
    assert.deepEqual(host.questionCalls.map((call) => call.title), [Q1, Q2, Q3]);
  });
});

describe('AC3/AC4: dismissal and restart', () => {
  it('resumes after a dismissed question without losing the answer (AC3)', async () => {
    const data: StoreData = new Map();
    const first = hostWith({ data, selectAnswers: [A1, undefined] });
    const dismissed = await first.run('Add subscriptions');
    assert.match(dismissed, /No answer was recorded/);

    const afterDismiss = storedSession(data);
    assert.equal(afterDismiss.decisions[0].status, 'answered');
    assert.equal(afterDismiss.decisions[1].status, 'open');

    // A later run continues from where it stopped, not from the beginning.
    const second = hostWith({ data, selectAnswers: [A2, A3] });
    await second.run('resume');
    assert.deepEqual(second.questionCalls.map((call) => call.title), [Q2, Q3]);
    assert.equal(storedSession(data).decisions[1].status, 'answered');
  });

  it('resumes across a simulated process restart (AC4)', async () => {
    const data: StoreData = new Map();
    const first = hostWith({ data, selectAnswers: [A1, undefined] });
    await first.run('Add subscriptions');

    // A brand-new host sharing only the store is what a restart looks like.
    const second = hostWith({ data, selectAnswers: [A2, A3] });
    const message = await second.run('resume');

    assert.deepEqual(second.questionCalls.map((call) => call.title), [Q2, Q3]);
    assert.match(message, /Next: \/naildown resume/);
    const session = storedSession(data);
    assert.ok(session.decisions.every((decision) => decision.status === 'answered'));
  });
});

describe('AC6/AC7: revision and reconfirmation', () => {
  it('revising the root marks both answered dependents stale (AC6)', async () => {
    const data: StoreData = new Map();
    const first = completeInterview({ data });
    await first.run('Add subscriptions');
    assert.ok(storedSession(data).decisions.every((decision) => decision.status === 'answered'));

    const second = hostWith({
      data,
      actionAnswers: [ACTIONS.reviseLabel],
      // Which decision, its new answer, then dismiss the stale dependent.
      selectAnswers: [Q1, 'One team', undefined],
    });
    await second.run('resume');

    const session = storedSession(data);
    assert.equal(session.decisions[0].status, 'answered');
    assert.equal(session.decisions[0].answer?.text, 'One team');
    assert.equal(session.decisions[1].status, 'needs_review');
    assert.equal(session.decisions[2].status, 'needs_review');
    // The previous answers are kept, not discarded.
    assert.equal(session.decisions[1].answer?.text, A2);
  });

  it('stale answers are reconfirmed without changing their values (AC7)', async () => {
    const data: StoreData = new Map();
    const first = completeInterview({ data });
    await first.run('Add subscriptions');

    // Revise the root, which leaves both dependents needing review.
    const revise = hostWith({ data, actionAnswers: [ACTIONS.reviseLabel], selectAnswers: [Q1, 'One team', undefined] });
    await revise.run('resume');
    assert.equal(storedSession(data).decisions[1].status, 'needs_review');

    // Confirming the exact same answers settles them again.
    const reconfirm = hostWith({ data, selectAnswers: [A2, A3] });
    await reconfirm.run('resume');
    assert.deepEqual(reconfirm.questionCalls.map((call) => call.title), [Q2, Q3]);

    const session = storedSession(data);
    assert.equal(session.decisions[1].status, 'answered');
    assert.equal(session.decisions[2].status, 'answered');
    assert.equal(session.decisions[1].answer?.text, A2);
    assert.equal(session.decisions[2].answer?.text, A3);
  });
});

describe('AC8: unresolved responses never settle', () => {
  it('refuses the undecided choice and leaves the decision open (AC8)', async () => {
    const data: StoreData = new Map();
    const host = hostWith({ data, selectAnswers: ['I have not decided'] });
    const message = await host.run('Add subscriptions');

    assert.match(message, /records no decision/);
    const session = storedSession(data);
    assert.equal(session.decisions[0].status, 'open');
    assert.equal(session.decisions[0].answer, undefined);
    // Nothing downstream became askable.
    assert.deepEqual(host.questionCalls.map((call) => call.title), [Q1]);
  });
});

describe('AC9/AC10/AC11/AC12/AC13: approval', () => {
  it('never opens the approval dialog while a critical decision is open (AC9)', async () => {
    const host = hostWith({ selectAnswers: [A1, A2, undefined] });
    await host.run('Add subscriptions');

    // D3 was dismissed, so the run stopped with a critical question unanswered
    // and no approval question was ever asked.
    assert.equal(host.approvalCalls.length, 0);
  });

  it('the action menu omits approval entirely when readiness fails (AC9)', async () => {
    const data: StoreData = new Map();
    // Seeded rather than driven: a deferred *critical* decision is the one state
    // where nothing is answerable and readiness still fails.
    const seeded = createInterviewSession({ id: 'seeded', workspace: WORKSPACE, goal: 'Seed', now: '2026-10-28T10:00:00.000Z' });
    seeded.decisions[0] = { ...seeded.decisions[0], status: 'deferred' };
    data.set(V2, seeded);

    const host = hostWith({ data });
    await host.run('resume');

    assert.equal(host.actionCalls.length, 1);
    const labels = host.actionCalls[0].options.map((option) => option.label);
    assert.ok(!labels.includes(ACTIONS.approveLabel));
    // A deferred critical decision is still offered for reconsideration.
    assert.ok(labels.includes(ACTIONS.reconsiderLabel));
    assert.equal(storedSession(data).approvedAt, undefined);
  });

  it('lists the refusal first so the host pre-highlight lands on no (AC10)', async () => {
    const host = completeInterview({ actionAnswers: [ACTIONS.approveLabel] });
    await host.run('Add subscriptions');

    assert.equal(host.approvalCalls.length, 1);
    const options = host.approvalCalls[0].options;
    assert.equal(options[0].label, APPROVAL.denyLabel);
    assert.equal(options[1].label, APPROVAL.approveLabel);
  });

  it('approves only on the explicit approval label (AC10/AC12)', async () => {
    const data: StoreData = new Map();
    const host = hostWith({
      data,
      selectAnswers: [A1, A2, A3],
      actionAnswers: [ACTIONS.approveLabel],
      approvalAnswers: [APPROVAL.approveLabel],
    });
    const message = await host.run('Add subscriptions');

    assert.match(message, /Approved/);
    const session = storedSession(data);
    assert.equal(session.status, 'approved');
    assert.ok(session.approvedAt);
    assert.ok(session.approvedSnapshot);

    // The snapshot survives a reload and still validates.
    const reopened = hostWith({ data });
    assert.match(await reopened.run('status'), /Approval: approved/);
  });

  it('a dismissed approval dialog never approves (AC11)', async () => {
    const data: StoreData = new Map();
    const host = hostWith({
      data,
      selectAnswers: [A1, A2, A3],
      actionAnswers: [ACTIONS.approveLabel],
      approvalAnswers: [undefined],
    });
    const message = await host.run('Add subscriptions');

    assert.match(message, /Not approved/);
    assert.equal(storedSession(data).approvedAt, undefined);
  });

  it('a refusal never approves (AC11)', async () => {
    const data: StoreData = new Map();
    const host = hostWith({
      data,
      selectAnswers: [A1, A2, A3],
      actionAnswers: [ACTIONS.approveLabel],
      approvalAnswers: [APPROVAL.denyLabel],
    });
    await host.run('Add subscriptions');
    assert.equal(storedSession(data).approvedAt, undefined);
  });

  it('a headless host never approves and never invents an answer (AC11)', async () => {
    const data: StoreData = new Map();
    const host = hostWith({ data, headless: true, selectAnswers: [] });
    const message = await host.run('Add subscriptions');

    assert.match(message, /cannot show questions/);
    const session = storedSession(data);
    assert.equal(session.approvedAt, undefined);
    assert.ok(session.decisions.every((decision) => decision.status === 'open'));
  });

  it('editing after approval revokes it (AC13)', async () => {
    const data: StoreData = new Map();
    const first = hostWith({
      data,
      selectAnswers: [A1, A2, A3],
      actionAnswers: [ACTIONS.approveLabel],
      approvalAnswers: [APPROVAL.approveLabel],
    });
    await first.run('Add subscriptions');
    assert.equal(storedSession(data).status, 'approved');

    const second = hostWith({ data, actionAnswers: [ACTIONS.reviseLabel], selectAnswers: [Q1, 'One team', undefined] });
    await second.run('resume');

    const session = storedSession(data);
    assert.equal(session.status, 'interviewing');
    assert.equal(session.approvedAt, undefined);
    assert.equal(session.approvedSnapshot, undefined);
    assert.match(await hostWith({ data }).run('status'), /Approval: not approved/);
  });
});

describe('AC14: paused interviews', () => {
  it('pauses and refuses changes until explicitly resumed (AC14)', async () => {
    const data: StoreData = new Map();
    const first = hostWith({ data, selectAnswers: [A1, ACTIONS.pauseLabel] });
    const message = await first.run('Add subscriptions');

    assert.match(message, /Paused/);
    assert.equal(storedSession(data).status, 'paused');
    assert.match(await hostWith({ data }).run('status'), /paused/);

    // Resume is the explicit step; after it the interview continues normally.
    const second = hostWith({ data, selectAnswers: [A2, A3] });
    const resumed = await second.run('resume');
    assert.match(resumed, /Resumed/);
    assert.deepEqual(second.questionCalls.map((call) => call.title), [Q2, Q3]);
    assert.equal(storedSession(data).status, 'interviewing');
  });
});

describe('AC15/AC16/AC17: M0 migration and corrupt data', () => {
  function seedLegacy(data: StoreData, approve = false): void {
    const base = startRecord({ workspace: WORKSPACE, goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    const answeredRecord = withAnswer(base, {
      questionId: 'who-uses-this',
      question: Q1,
      answer: 'One team',
      answeredAt: '2026-10-20T10:05:00.000Z',
    }, '2026-10-20T10:05:00.000Z');
    data.set(V1, approve ? withApproval(answeredRecord, '2026-10-20T10:10:00.000Z') : answeredRecord);
  }

  it('does not touch the v1 record and only migrates through the explicit choice (AC15)', async () => {
    const data: StoreData = new Map();
    seedLegacy(data);
    const before = structuredClone(data.get(V1));

    // Status notices the record and changes nothing.
    const status = await hostWith({ data }).run('status');
    assert.match(status, /M0 record/);
    assert.deepEqual(data.get(V1), before);
    assert.equal(data.get(V2), undefined);

    // Explicit migration keeps the v1 record byte-identical and creates v2.
    const host = hostWith({ data, selectAnswers: [ACTIONS.migrateLabel, A2, A3] });
    await host.run('Add billing');
    assert.deepEqual(data.get(V1), before);

    const session = storedSession(data);
    assert.equal(session.goal, 'Add billing');
    assert.equal(session.decisions[0].status, 'answered');
    assert.equal(session.decisions[0].answer?.text, 'One team');
  });

  it('choosing a fresh interview leaves the v1 record alone (AC15)', async () => {
    const data: StoreData = new Map();
    seedLegacy(data);
    const before = structuredClone(data.get(V1));

    const host = hostWith({ data, selectAnswers: [ACTIONS.freshLabel, A1, A2, A3] });
    await host.run('A different goal');

    assert.deepEqual(data.get(V1), before);
    assert.equal(storedSession(data).goal, 'A different goal');
  });

  it('never promotes the M0 dummy approval (AC16)', async () => {
    const data: StoreData = new Map();
    seedLegacy(data, true);
    assert.ok(data.get(V1));

    const host = hostWith({ data, selectAnswers: [ACTIONS.migrateLabel, A2, A3] });
    const message = await host.run('Add billing');

    assert.match(message, /M0 approval was a test/);
    const session = storedSession(data);
    assert.equal(session.status, 'interviewing');
    assert.equal(session.approvedAt, undefined);
    assert.equal(session.approvedSnapshot, undefined);
  });

  it('reports an unreadable M0 record without touching it', async () => {
    const data: StoreData = new Map();
    data.set(V1, { schemaVersion: 9, goal: 42 });

    const message = await hostWith({ data }).run('status');
    assert.match(message, /cannot be read/);
    assert.deepEqual(data.get(V1), { schemaVersion: 9, goal: 42 });
  });

  it('leaves corrupt v2 data untouched (AC17)', async () => {
    const data: StoreData = new Map();
    data.set(V2, { schemaVersion: 2, id: 'broken' });

    const message = await hostWith({ data }).run('status');
    assert.match(message, /cannot be read/);
    assert.deepEqual(data.get(V2), { schemaVersion: 2, id: 'broken' });

    // Resume does not overwrite it either.
    await hostWith({ data }).run('resume');
    assert.deepEqual(data.get(V2), { schemaVersion: 2, id: 'broken' });
  });
});

describe('AC18: failed writes never report success', () => {
  it('does not claim a goal was saved when the write fails', async () => {
    const host = hostWith({ failWritesAt: [1], selectAnswers: [A1] });
    const message = await host.run('Add subscriptions');

    assert.match(message, /could not save/);
    assert.doesNotMatch(message, /Recorded/);
    assert.equal(host.data.has(V2), false);
  });

  it('does not claim an answer was saved when the write fails', async () => {
    const data: StoreData = new Map();
    // First write (the goal) succeeds, second (the answer) fails.
    const host = hostWith({ data, failWritesAt: [2], selectAnswers: [A1, A2] });
    const message = await host.run('Add subscriptions');

    assert.match(message, /could not save/);
    const session = storedSession(data);
    assert.equal(session.decisions[0].status, 'open');
  });

  it('does not claim approval when the approval write fails', async () => {
    const data: StoreData = new Map();
    // goal, answer 1, answer 2, answer 3 succeed; the approval write fails.
    const host = hostWith({
      data,
      failWritesAt: [5],
      selectAnswers: [A1, A2, A3],
      actionAnswers: [ACTIONS.approveLabel],
      approvalAnswers: [APPROVAL.approveLabel],
    });
    const message = await host.run('Add subscriptions');

    assert.match(message, /could not save/);
    assert.doesNotMatch(message, /Approved/);
    assert.equal(storedSession(data).approvedAt, undefined);
  });

  it('reports uncertainty when the rollback also fails', async () => {
    const data: StoreData = new Map();
    // Write 1 is the goal; write 2 is the answer, which fails, and its rollback
    // (write 3) fails too.
    const host = hostWith({ data, failWritesAt: [2, 3], selectAnswers: [A1] });
    const message = await host.run('Add subscriptions');

    assert.match(message, /stored state is now uncertain/);
  });
});


describe('RC-A: legacy dialog cancellation writes nothing', () => {
  function seed(data: StoreData): void {
    const base = startRecord({ workspace: WORKSPACE, goal: 'Add billing', now: '2026-10-20T10:00:00.000Z' });
    data.set(V1, withAnswer(base, {
      questionId: 'who-uses-this',
      question: Q1,
      answer: 'One team',
      answeredAt: '2026-10-20T10:05:00.000Z',
    }, '2026-10-20T10:05:00.000Z'));
  }

  for (const [name, answer] of [
    ['dismissal', undefined],
    ['an unexpected label', 'Something else entirely'],
  ] as const) {
    it(`${name} cancels without writing a session`, async () => {
      const data: StoreData = new Map();
      seed(data);
      const before = structuredClone(data.get(V1));
      const sizeBefore = data.size;

      const message = await hostWith({ data, selectAnswers: [answer] }).run('Add billing');

      assert.match(message, /Left everything as it was/);
      assert.equal(data.has(V2), false, 'no v2 session may be created');
      assert.deepEqual(data.get(V1), before, 'the M0 record must be untouched');
      assert.equal(data.size, sizeBefore);
    });
  }

  it('a headless host cancels rather than starting fresh', async () => {
    const data: StoreData = new Map();
    seed(data);
    const before = structuredClone(data.get(V1));

    const message = await hostWith({ data, headless: true }).run('Add billing');

    assert.match(message, /Left everything as it was/);
    assert.equal(data.has(V2), false);
    assert.deepEqual(data.get(V1), before);
  });

  it('the exact fresh label does start a new interview', async () => {
    const data: StoreData = new Map();
    seed(data);
    const before = structuredClone(data.get(V1));

    await hostWith({ data, selectAnswers: [ACTIONS.freshLabel, A1, undefined] }).run('A new goal');

    assert.equal(storedSession(data).goal, 'A new goal');
    assert.deepEqual(data.get(V1), before);
  });
});

describe('RC-B: a corrupt record survives a failed replacement', () => {
  const CORRUPT = { schemaVersion: 2, id: 'broken', decisions: 'not a list' };

  function seedCorrupt(): StoreData {
    const data: StoreData = new Map();
    data.set(V2, structuredClone(CORRUPT));
    return data;
  }

  it('restores the exact raw record when the replacement write fails', async () => {
    const data = seedCorrupt();
    const host = hostWith({ data, failWritesAt: [1], selectAnswers: [ACTIONS.replaceLabel] });

    // The replace confirmation is a dialog, not a write, so the goal write is #1.
    const message = await host.run('Add subscriptions');

    assert.match(message, /could not save/);
    assert.deepEqual(data.get(V2), CORRUPT, 'the corrupt record must come back byte-identical');
  });

  it('never replaces an unreadable record without the explicit choice', async () => {
    const data = seedCorrupt();
    const message = await hostWith({ data, selectAnswers: [ACTIONS.keepLabel] }).run('Add subscriptions');

    assert.match(message, /cannot be read/);
    assert.deepEqual(data.get(V2), CORRUPT);

    // Dismissal is not consent either.
    await hostWith({ data, selectAnswers: [undefined] }).run('Add subscriptions');
    assert.deepEqual(data.get(V2), CORRUPT);
  });

  it('replaces it when the person explicitly chooses to', async () => {
    const data = seedCorrupt();
    const host = hostWith({ data, selectAnswers: [ACTIONS.replaceLabel, A1, undefined] });
    await host.run('Add subscriptions');

    assert.equal(storedSession(data).goal, 'Add subscriptions');
  });

  it('reports uncertainty, and leaves the record replaced, when the rollback also fails', async () => {
    const data = seedCorrupt();
    // Write 1 is the failed goal write; write 2 is its rollback, which also fails.
    const host = hostWith({ data, failWritesAt: [1, 2], selectAnswers: [ACTIONS.replaceLabel] });

    const message = await host.run('Add subscriptions');

    assert.match(message, /stored state is now uncertain/);
    assert.doesNotMatch(message, /still there/);
  });

  it('keeps an absent key absent rather than writing an empty record', async () => {
    const data: StoreData = new Map();
    const host = hostWith({ data, failWritesAt: [1] });

    await host.run('Add subscriptions');

    assert.equal(data.has(V2), false, 'a failed first write must not leave a key behind');
  });

  it('restores a valid session rather than dropping it', async () => {
    const data: StoreData = new Map();
    await hostWith({ data, selectAnswers: [A1, undefined] }).run('First goal');
    const saved = structuredClone(data.get(V2));

    // Write 1 is the replacement goal, which fails.
    const message = await hostWith({ data, failWritesAt: [1], selectAnswers: [ACTIONS.replaceLabel] })
      .run('Second goal');

    assert.match(message, /could not save/);
    assert.deepEqual(data.get(V2), saved);
    assert.equal(storedSession(data).goal, 'First goal');
  });
});

describe('RC-C: failure messages describe the recovered state truthfully', () => {
  /** Seeds a ready session and approves it through the core, then stores it. */
  function seedApproved(): StoreData {
    const data: StoreData = new Map();
    let current = createInterviewSession({
      id: 'seeded-approved',
      workspace: WORKSPACE,
      goal: 'Approved goal',
      now: '2026-10-28T10:00:00.000Z',
    });
    for (const [id, label] of [
      ['who-uses-this', A1],
      ['first-scope', A2],
      ['proof-of-working', A3],
    ] as const) {
      const answeredResult = answerDecision(current, id, { text: label }, '2026-10-28T10:00:00.000Z');
      if (!answeredResult.ok) throw new Error(answeredResult.error.message);
      current = answeredResult.session;
    }
    const approved = approveSession(current, { confirmed: true }, '2026-10-28T10:05:00.000Z');
    if (!approved.ok) throw new Error(approved.error.message);
    data.set(V2, approved.session);
    return data;
  }

  it('a failed revision of an approved session does not claim approval disappeared', async () => {
    const data = seedApproved();

    // Revise the root; the answer write fails and rolls back to the approved session.
    const host = hostWith({
      data,
      failWritesAt: [1],
      actionAnswers: [ACTIONS.reviseLabel],
      selectAnswers: [Q1, 'One team'],
    });
    const message = await host.run('resume');

    assert.match(message, /could not save/);
    // The old wording said "nothing is approved", which would be a lie here.
    assert.doesNotMatch(message, /[Nn]othing is approved/);
    assert.match(message, /\/naildown status/);

    const session = storedSession(data);
    assert.equal(session.status, 'approved');
    assert.ok(session.approvedAt);
    assert.match(await hostWith({ data }).run('status'), /Approval: approved/);
  });

  it('a failed new approval is not described as approved', async () => {
    const data: StoreData = new Map();
    const host = hostWith({
      data,
      failWritesAt: [5],
      selectAnswers: [A1, A2, A3],
      actionAnswers: [ACTIONS.approveLabel],
      approvalAnswers: [APPROVAL.approveLabel],
    });
    const message = await host.run('Add subscriptions');

    assert.match(message, /could not save/);
    assert.doesNotMatch(message, /^Approved/m);
    assert.equal(storedSession(data).approvedAt, undefined);
  });
});

describe('RC-D: an unreadable M0 record cannot block starting over', () => {
  function seedUnreadable(): StoreData {
    const data: StoreData = new Map();
    data.set(V1, { schemaVersion: 9, goal: 42 });
    return data;
  }

  it('keeps the data by default and creates nothing', async () => {
    const data = seedUnreadable();
    const before = structuredClone(data.get(V1));

    const message = await hostWith({ data, selectAnswers: [ACTIONS.keepLabel] }).run('A new goal');

    assert.match(message, /Left everything as it was/);
    assert.equal(data.has(V2), false);
    assert.deepEqual(data.get(V1), before);
  });

  it('starts a new interview only on the exact fresh label', async () => {
    const data = seedUnreadable();
    const before = structuredClone(data.get(V1));

    await hostWith({ data, selectAnswers: [ACTIONS.freshLabel, A1, undefined] }).run('A new goal');

    assert.equal(storedSession(data).goal, 'A new goal');
    assert.deepEqual(data.get(V1), before, 'the unreadable v1 record must stay byte-identical');
  });

  for (const [name, answer] of [
    ['dismissal', undefined],
    ['an unexpected label', 'Yes please'],
  ] as const) {
    it(`${name} creates no session`, async () => {
      const data = seedUnreadable();
      const before = structuredClone(data.get(V1));

      const message = await hostWith({ data, selectAnswers: [answer] }).run('A new goal');

      assert.match(message, /Left everything as it was/);
      assert.equal(data.has(V2), false);
      assert.deepEqual(data.get(V1), before);
    });
  }

  it('resume reports the record and points at the command that can start over', async () => {
    const data = seedUnreadable();
    const message = await hostWith({ data }).run('resume');
    assert.match(message, /cannot be made into an interview/);
    assert.match(message, /naildown <your idea>/);
    assert.equal(data.has(V2), false);
  });

  it('an unavailable migration preview offers the same safe choice', async () => {
    const data: StoreData = new Map();
    // A readable v1 record whose conversion cannot satisfy v2.
    data.set(V1, {
      schemaVersion: 1,
      workspace: WORKSPACE,
      goal: 'Odd goal',
      status: 'awaiting_answer',
      createdAt: 'x',
      updatedAt: 'y',
      answer: { questionId: 'q', question: 'Q?', answer: 'One team', answeredAt: 'z' },
      approvedAt: 'w',
    });

    const kept = await hostWith({ data, selectAnswers: [ACTIONS.keepLabel] }).run('A new goal');
    assert.match(kept, /Left everything as it was/);
    assert.equal(data.has(V2), false);
  });
});

describe('AC19/AC20: isolation and prohibited operations', () => {
  it('keeps two workspaces apart in one store (AC19)', async () => {
    const data: StoreData = new Map();
    const a = hostWith({ data, cwd: '/work/a', selectAnswers: [A1, A2, A3] });
    const b = hostWith({ data, cwd: '/work/b', selectAnswers: [A1, undefined] });
    await a.run('Goal A');
    await b.run('Goal B');

    const readA = readStoredSession(data.get(sessionKeyFor('/work/a')));
    const readB = readStoredSession(data.get(sessionKeyFor('/work/b')));
    assert.equal(readA.kind, 'ok');
    assert.equal(readB.kind, 'ok');
    if (readA.kind !== 'ok' || readB.kind !== 'ok') return;
    // Each workspace kept its own goal and its own session id.
    assert.equal(readA.session.goal, 'Goal A');
    assert.equal(readB.session.goal, 'Goal B');
    assert.notEqual(readA.session.id, readB.session.id);
    assert.equal(data.has(sessionKeyFor(WORKSPACE)), false);
  });

  it('treats a trailing slash as the same workspace (AC19)', async () => {
    const data: StoreData = new Map();
    await hostWith({ data, cwd: '/work/a', selectAnswers: [A1, undefined] }).run('Goal A');
    const message = await hostWith({ data, cwd: '/work/a/' }).run('status');
    assert.match(message, /Goal: Goal A/);
  });

  it('the mod source performs no model, process, network or file operations (AC20)', () => {
    const files = ['src/index.ts', ...readdirSync('src/core').map((name) => `src/core/${name}`)];
    const forbidden = [
      /cmd\.model/,
      /cmd\.process/,
      /cmd\.prompt/,
      /cmd\.exec/,
      /\bfetch\s*\(/,
      /node:child_process/,
      /axios/,
      /http\.request/,
      /writeFileSync/,
      /readFileSync/,
      /node:fs/,
      /spawnSync/,
      /execSync/,
    ];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        assert.doesNotMatch(source, pattern, `${file} must not use ${pattern}`);
      }
    }
  });

  it('the built-in interview is three decisions with the documented dependencies', () => {
    assert.deepEqual(
      INTERVIEW.map((spec) => [spec.id, spec.priority, spec.prerequisites]),
      [
        ['who-uses-this', 'critical', []],
        ['first-scope', 'critical', ['who-uses-this']],
        ['proof-of-working', 'important', ['who-uses-this']],
      ],
    );
    // Every question offers at least one unresolved choice.
    for (const spec of INTERVIEW) {
      assert.ok(spec.options.some((option) => option.unresolved === true), `${spec.id} needs an undecided option`);
    }
  });
});
