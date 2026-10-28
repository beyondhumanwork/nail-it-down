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

    assert.match(message, /what is saved is now uncertain/);
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
