/**
 * Drives the real mod entry point through a fake host.
 *
 * These tests cover the parts of the M0 matrix that are decided by the mod's own logic: what gets
 * written, what merely looks like it got written, and what happens when a dialog is dismissed, the
 * host is headless, or a store write fails. Real TUI behaviour is evidence collected separately in
 * docs/M0_EVIDENCE.md — these tests are not a substitute for it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import nailItDown from '../src/index.ts';
import { APPROVAL, QUESTION } from '../src/core/copy.ts';
import { storeKeyFor } from '../src/core/persistence.ts';
import { readStoredRecord } from '../src/core/record.ts';
import { workspaceKeyFrom } from '../src/core/workspace.ts';
import { FakeHost } from './fakeHost.ts';
import type { FakeHostOptions, StoreData } from './fakeHost.ts';

const ONE_TEAM = QUESTION.options[1].label;

function newHost(options: FakeHostOptions = {}): FakeHost {
  const host = new FakeHost(options);
  nailItDown(host);
  return host;
}

function storedFor(data: StoreData, cwd: string) {
  return readStoredRecord(data.get(storeKeyFor(workspaceKeyFrom(cwd))));
}

describe('registration', () => {
  it('registers one /naildown command with a description and argument hint', () => {
    const host = newHost();
    assert.equal(host.command?.name, 'naildown');
    assert.ok(host.command?.description);
    assert.ok(host.command?.argumentHint);
  });
});

describe('/naildown with no arguments', () => {
  it('explains the command without opening a dialog or saving anything', async () => {
    const host = newHost();
    const message = await host.run('');

    assert.match(message, /\/naildown <your idea>/);
    assert.equal(host.selectCalls.length, 0);
    assert.equal(host.data.size, 0);
  });
});

describe('starting a goal', () => {
  it('saves the goal, asks one question, and saves the confirmed answer', async () => {
    const host = newHost({ selectAnswers: [ONE_TEAM], approvalAnswers: [APPROVAL.approveLabel] });
    const message = await host.run('Add   subscriptions to my app');

    assert.equal(host.questionCalls.length, 1);
    assert.equal(host.questionCalls[0].title, QUESTION.title);
    assert.equal(host.questionCalls[0].options.length, QUESTION.options.length);
    assert.equal(host.approvalCalls.length, 1);

    assert.match(message, /Add {3}subscriptions to my app/);
    assert.match(message, new RegExp(`Answer recorded: ${ONE_TEAM}`));

    const stored = storedFor(host.data, host.cwd);
    assert.equal(stored.kind, 'ok');
    if (stored.kind !== 'ok') return;
    assert.equal(stored.record.schemaVersion, 1);
    assert.equal(stored.record.status, 'answered');
    assert.equal(stored.record.answer?.answer, ONE_TEAM);
    assert.equal(stored.record.answer?.questionId, QUESTION.id);
    assert.ok(stored.record.approvedAt);
  });

  it('keeps the full goal text, including punctuation', async () => {
    const goal = `Rename "billing" -> subscriptions, then ship it (v2)?`;
    const host = newHost({ selectAnswers: [ONE_TEAM], approvalAnswers: [APPROVAL.denyLabel] });
    await host.run(goal);

    const stored = storedFor(host.data, host.cwd);
    assert.equal(stored.kind === 'ok' ? stored.record.goal : 'missing', goal);
  });
});

describe('dismissed question', () => {
  it('records no answer and no approval, but keeps the goal', async () => {
    const host = newHost({ selectAnswers: [undefined] });
    const message = await host.run('Add subscriptions');

    assert.match(message, /No answer was recorded/);
    assert.match(message, /nothing is approved/i);
    assert.equal(host.approvalCalls.length, 0);

    const stored = storedFor(host.data, host.cwd);
    assert.equal(stored.kind, 'ok');
    if (stored.kind !== 'ok') return;
    assert.equal(stored.record.status, 'awaiting_answer');
    assert.equal(stored.record.answer, undefined);
    assert.equal(stored.record.approvedAt, undefined);
  });
});

describe('headless host', () => {
  it('never invents an answer or an approval', async () => {
    const host = newHost({ headless: true });
    const message = await host.run('Add subscriptions');

    assert.match(message, /cannot show questions/);
    assert.match(message, /nothing is approved/i);
    assert.equal(host.approvalCalls.length, 0);

    const stored = storedFor(host.data, host.cwd);
    assert.equal(stored.kind, 'ok');
    if (stored.kind !== 'ok') return;
    assert.equal(stored.record.status, 'awaiting_answer');
    assert.equal(stored.record.answer, undefined);
    assert.equal(stored.record.approvedAt, undefined);
  });

  it('reports status without claiming anything is approved', async () => {
    const host = newHost({ headless: true });
    await host.run('Add subscriptions');
    const status = await host.run('status');

    assert.match(status, /Answer: none yet/);
    assert.match(status, /Approval: not approved/);
  });
});

describe('dummy approval', () => {
  it('lists the refusal first, because the host pre-highlights the first option', async () => {
    const host = newHost({ selectAnswers: [ONE_TEAM], approvalAnswers: [APPROVAL.denyLabel] });
    await host.run('Add subscriptions');

    const options = host.approvalCalls[0].options;
    assert.equal(options[0].label, APPROVAL.denyLabel);
    assert.notEqual(options[0].label, APPROVAL.approveLabel);
    assert.equal(options[1].label, APPROVAL.approveLabel);
  });

  it('does not persist approval when the person chooses no', async () => {
    const host = newHost({ selectAnswers: [ONE_TEAM], approvalAnswers: [APPROVAL.denyLabel] });
    const message = await host.run('Add subscriptions');

    assert.match(message, /you chose not to approve/);
    const stored = storedFor(host.data, host.cwd);
    assert.equal(stored.kind === 'ok' ? stored.record.approvedAt : 'missing', undefined);
    assert.equal(stored.kind === 'ok' ? stored.record.status : 'missing', 'answered');
  });

  it('does not persist approval when the dialog is dismissed', async () => {
    const host = newHost({ selectAnswers: [ONE_TEAM], approvalAnswers: [undefined] });
    const message = await host.run('Add subscriptions');

    assert.match(message, /was dismissed/);
    const stored = storedFor(host.data, host.cwd);
    assert.equal(stored.kind === 'ok' ? stored.record.approvedAt : 'missing', undefined);
  });

  it('treats any answer that is not the approval label as no approval', async () => {
    const host = newHost({ selectAnswers: [ONE_TEAM], approvalAnswers: ['Maybe later'] });
    await host.run('Add subscriptions');

    const stored = storedFor(host.data, host.cwd);
    assert.equal(stored.kind === 'ok' ? stored.record.approvedAt : 'missing', undefined);
  });
});

describe('store write failures', () => {
  it('reports a failed goal write instead of claiming it was saved', async () => {
    const host = newHost({ selectAnswers: [ONE_TEAM], failWritesAt: [1] });
    const message = await host.run('Add subscriptions');

    assert.match(message, /could not save your goal to disk/);
    assert.doesNotMatch(message, /Goal saved/);
    assert.equal(host.questionCalls.length, 0, 'the question must not be asked when the goal was not saved');
  });

  it('reports a failed answer write and does not ask for approval', async () => {
    const host = newHost({ selectAnswers: [ONE_TEAM], failWritesAt: [2] });
    const message = await host.run('Add subscriptions');

    assert.match(message, /could not save your answer to disk/);
    assert.doesNotMatch(message, /Answer recorded/);
    assert.equal(host.approvalCalls.length, 0);
  });

  it('reports a failed approval write as not approved', async () => {
    const host = newHost({
      selectAnswers: [ONE_TEAM],
      approvalAnswers: [APPROVAL.approveLabel],
      failWritesAt: [3],
    });
    const message = await host.run('Add subscriptions');

    assert.match(message, /approval could not be written to disk/);
    assert.match(message, /nothing is approved/i);
    assert.doesNotMatch(message, /Marked approved/);
  });
});

describe('write-failure rollback', () => {
  const previous = {
    schemaVersion: 1,
    workspace: '/work/one',
    goal: 'Previous goal',
    status: 'awaiting_answer',
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
  };

  it('restores the last good record when a new goal cannot be written', async () => {
    const data: StoreData = new Map([[storeKeyFor(workspaceKeyFrom('/work/one')), previous]]);
    const host = newHost({ data, cwd: '/work/one', failWritesAt: [1] });

    const message = await host.run('New goal that cannot be saved');
    assert.match(message, /could not save your goal to disk/);

    // The host keeps a rejected write in memory; status must not report it as saved.
    assert.match(await host.run('status'), /Goal: Previous goal/);
    const stored = storedFor(data, '/work/one');
    assert.equal(stored.kind === 'ok' ? stored.record.goal : 'missing', 'Previous goal');
  });

  it('leaves nothing behind when the very first goal cannot be written', async () => {
    const host = newHost({ cwd: '/work/fresh', failWritesAt: [1] });

    await host.run('Doomed goal');
    assert.match(await host.run('status'), /Nothing is saved for this workspace yet/);
    assert.equal(storedFor(host.data, '/work/fresh').kind, 'empty');
  });

  it('keeps an unanswered goal when the answer cannot be written', async () => {
    const host = newHost({ selectAnswers: [ONE_TEAM], failWritesAt: [2] });

    await host.run('Add subscriptions');
    const status = await host.run('status');

    assert.match(status, /Goal: Add subscriptions/);
    assert.match(status, /Answer: none yet/);

    const stored = storedFor(host.data, host.cwd);
    assert.equal(stored.kind === 'ok' ? stored.record.status : 'missing', 'awaiting_answer');
  });
});

describe('restart', () => {
  it('finds the saved answer in a new process', async () => {
    const data: StoreData = new Map();
    const first = newHost({
      data,
      cwd: '/work/one',
      selectAnswers: [ONE_TEAM],
      approvalAnswers: [APPROVAL.approveLabel],
    });
    await first.run('Add subscriptions');

    const second = newHost({ data, cwd: '/work/one' });
    const status = await second.run('status');

    assert.equal(second.selectCalls.length, 0);
    assert.match(status, /Goal: Add subscriptions/);
    assert.match(status, new RegExp(`Answer: ${ONE_TEAM}`));
    assert.match(status, /Approval: approved/);

    const resumed = await second.run('resume');
    assert.match(resumed, /already has an answer/);
    assert.equal(second.selectCalls.length, 0);
  });
});

describe('workspace isolation', () => {
  it('keeps two workspace paths apart in one mod store', async () => {
    const data: StoreData = new Map();
    const hostA = newHost({ data, cwd: '/work/one', selectAnswers: [ONE_TEAM] });
    await hostA.run('Add subscriptions in one');

    const hostB = newHost({ data, cwd: '/work/two' });
    const statusB = await hostB.run('status');

    assert.match(statusB, /Nothing is saved for this workspace yet/);
    assert.doesNotMatch(statusB, /Add subscriptions in one/);

    const storedA = storedFor(data, '/work/one');
    assert.equal(storedA.kind === 'ok' ? storedA.record.goal : 'missing', 'Add subscriptions in one');
    assert.equal(storedFor(data, '/work/two').kind, 'empty');
  });

  it('treats a trailing slash as the same workspace', async () => {
    const data: StoreData = new Map();
    const hostA = newHost({ data, cwd: '/work/one', selectAnswers: [ONE_TEAM] });
    await hostA.run('Add subscriptions');

    const hostB = newHost({ data, cwd: '/work/one/' });
    assert.match(await hostB.run('status'), /Add subscriptions/);
  });
});

describe('resume', () => {
  it('asks the question again when the goal is still unanswered', async () => {
    const data: StoreData = new Map();
    const first = newHost({ data, cwd: '/work/one', selectAnswers: [undefined] });
    await first.run('Add subscriptions');

    const second = newHost({ data, cwd: '/work/one', selectAnswers: [ONE_TEAM] });
    const message = await second.run('resume');

    assert.equal(second.questionCalls.length, 1);
    assert.match(message, new RegExp(`Answer recorded: ${ONE_TEAM}`));
  });

  it('says there is nothing to resume in a fresh workspace', async () => {
    const host = newHost({ cwd: '/work/empty' });
    const message = await host.run('resume');

    assert.match(message, /Nothing is saved for this workspace yet/);
    assert.equal(host.selectCalls.length, 0);
  });
});

describe('unreadable saved data', () => {
  const corrupt = { schemaVersion: 9, goal: 42 };

  it('reports it instead of crashing or overwriting', async () => {
    const data: StoreData = new Map([[storeKeyFor(workspaceKeyFrom('/work/one')), corrupt]]);
    const host = newHost({ data, cwd: '/work/one' });

    const status = await host.run('status');
    assert.match(status, /cannot be read by this version/);
    assert.match(status, /schema version 9/);

    const resumed = await host.run('resume');
    assert.match(resumed, /cannot be read by this version/);
    assert.equal(host.selectCalls.length, 0);
    assert.deepEqual(data.get(storeKeyFor(workspaceKeyFrom('/work/one'))), corrupt);
  });

  it('can be replaced by starting a new goal', async () => {
    const data: StoreData = new Map([[storeKeyFor(workspaceKeyFrom('/work/one')), corrupt]]);
    const host = newHost({ data, cwd: '/work/one', selectAnswers: [ONE_TEAM] });

    await host.run('Start over');
    const stored = storedFor(data, '/work/one');
    assert.equal(stored.kind === 'ok' ? stored.record.goal : 'missing', 'Start over');
  });
});

describe('status', () => {
  it('describes an unanswered goal without opening a dialog', async () => {
    const data: StoreData = new Map();
    const first = newHost({ data, cwd: '/work/one', selectAnswers: [undefined] });
    await first.run('Add subscriptions');

    const second = newHost({ data, cwd: '/work/one' });
    const status = await second.run('status');

    assert.equal(second.selectCalls.length, 0);
    assert.match(status, /Goal: Add subscriptions/);
    assert.match(status, /Answer: none yet/);
    assert.match(status, /Next: \/naildown resume/);
  });
});
