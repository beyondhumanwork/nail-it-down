import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseIntent } from '../src/core/commands.ts';

describe('parseIntent', () => {
  it('treats an empty argument list as help', () => {
    assert.deepEqual(parseIntent(''), { kind: 'help' });
    assert.deepEqual(parseIntent('   '), { kind: 'help' });
    assert.deepEqual(parseIntent(undefined), { kind: 'help' });
  });

  it('recognizes the documented subcommands', () => {
    assert.deepEqual(parseIntent('status'), { kind: 'status' });
    assert.deepEqual(parseIntent('resume'), { kind: 'resume' });
    assert.deepEqual(parseIntent('help'), { kind: 'help' });
    assert.deepEqual(parseIntent('?'), { kind: 'help' });
  });

  it('accepts subcommands in any case and with surrounding space', () => {
    assert.deepEqual(parseIntent('  STATUS '), { kind: 'status' });
    assert.deepEqual(parseIntent('Resume'), { kind: 'resume' });
  });

  it('keeps a goal that merely starts with a subcommand word', () => {
    assert.deepEqual(parseIntent('Status page for admins'), { kind: 'start', goal: 'Status page for admins' });
    assert.deepEqual(parseIntent('resume billing work'), { kind: 'start', goal: 'resume billing work' });
  });

  it('keeps the goal text intact apart from outer whitespace', () => {
    assert.deepEqual(parseIntent('   Add   subscriptions to my app   '), {
      kind: 'start',
      goal: 'Add   subscriptions to my app',
    });
  });

  it('does not drop punctuation, quotes or symbols', () => {
    const goal = `Rename "billing" -> subscriptions, then ship it (v2)?`;
    assert.deepEqual(parseIntent(goal), { kind: 'start', goal });
  });

  it('treats a non-string argument as missing', () => {
    assert.deepEqual(parseIntent(null), { kind: 'help' });
    assert.deepEqual(parseIntent(42), { kind: 'help' });
  });
});
