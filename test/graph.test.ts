import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_SCHEMA_VERSION,
  canonicalDecisionSnapshot,
  readStoredSession,
} from '../src/core/session.ts';
import type { Decision, DecisionOption } from '../src/core/session.ts';
import {
  decisionEligibility,
  descendants,
  frontier,
  isSettledDecision,
  topologicalOrder,
  unsettledPrerequisites,
  validateGraph,
} from '../src/core/graph.ts';

const AT = '2026-10-25T10:00:00.000Z';

const OPTIONS: DecisionOption[] = [
  { id: 'yes', label: 'Just me', consequence: 'Solo.' },
  { id: 'undecided', label: 'I have not decided', consequence: 'Nothing settled.', unresolved: true },
];

/** Builds a decision in any state, defaulting to an open root question. */
function decision(id: string, overrides: Partial<Decision> = {}): Decision {
  return {
    id,
    question: `Question ${id}?`,
    whyItMatters: 'It matters.',
    priority: 'critical',
    prerequisites: [],
    status: 'open',
    options: [...OPTIONS],
    updatedAt: AT,
    ...overrides,
  };
}

/** A decision settled by an explicit, user-confirmed answer. */
function answered(id: string, prerequisites: string[] = [], overrides: Partial<Decision> = {}): Decision {
  return decision(id, {
    prerequisites,
    status: 'answered',
    answer: { text: 'Just me', chosenOptionId: 'yes', actor: 'user' },
    ...overrides,
  });
}

/** A decision answered by an assumption instead of by the user. */
function assumed(id: string, prerequisites: string[] = []): Decision {
  return decision(id, {
    prerequisites,
    status: 'assumed',
    answer: { text: 'Probably one team', actor: 'assumption' },
  });
}

/** A previously answered decision invalidated by an upstream edit. */
function needsReview(id: string, prerequisites: string[] = []): Decision {
  return decision(id, {
    prerequisites,
    status: 'needs_review',
    answer: { text: 'Just me', chosenOptionId: 'yes', actor: 'user' },
  });
}

const ids = (decisions: readonly Decision[]): string[] => decisions.map((d) => d.id);

describe('M1 graph validation', () => {
  it('M1-01: rejects a dependency cycle', () => {
    const result = validateGraph([decision('d1', { prerequisites: ['d2'] }), decision('d2', { prerequisites: ['d1'] })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const cycle = result.problems.find((problem) => problem.kind === 'cycle');
    assert.ok(cycle, 'expected a cycle problem');
    assert.match(cycle.detail, /cycle/);
  });

  it('M1-01d: a two-decision cycle is reported once, not with a repeated start', () => {
    const result = validateGraph([
      decision('a', { prerequisites: ['b'] }),
      decision('b', { prerequisites: ['a'] }),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const cycle = result.problems.find((problem) => problem.kind === 'cycle');
    assert.ok(cycle && cycle.kind === 'cycle');
    // The stored path lists each decision exactly once; the closing edge is implicit.
    assert.deepEqual(cycle.path, ['a', 'b']);
    assert.equal(cycle.decisionId, cycle.path[0]);
    // The human-readable diagnostic closes the loop exactly once.
    assert.equal(cycle.detail, 'dependency cycle (a -> b -> a)');
  });

  it('M1-01e: a three-decision cycle stores each edge once and closes once', () => {
    const result = validateGraph([
      decision('a', { prerequisites: ['c'] }),
      decision('b', { prerequisites: ['a'] }),
      decision('c', { prerequisites: ['b'] }),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const cycle = result.problems.find((problem) => problem.kind === 'cycle');
    assert.ok(cycle && cycle.kind === 'cycle');
    assert.deepEqual(cycle.path, ['a', 'c', 'b']);
    assert.equal(cycle.decisionId, 'a');
    assert.equal(cycle.detail, 'dependency cycle (a -> c -> b -> a)');
  });

  it('M1-01f: cycle detection is deterministic across repeated calls', () => {
    const graph = [
      decision('a', { prerequisites: ['b'] }),
      decision('b', { prerequisites: ['a'] }),
    ];
    assert.deepEqual(validateGraph(graph), validateGraph(graph));
  });

  it('M1-01b: rejects a longer cycle and a self-dependency', () => {
    const long = validateGraph([
      decision('a', { prerequisites: ['c'] }),
      decision('b', { prerequisites: ['a'] }),
      decision('c', { prerequisites: ['b'] }),
    ]);
    assert.equal(long.ok, false);
    if (!long.ok) assert.ok(long.problems.some((p) => p.kind === 'cycle'));

    const self = validateGraph([decision('a', { prerequisites: ['a'] })]);
    assert.equal(self.ok, false);
    if (!self.ok) assert.ok(self.problems.some((p) => p.kind === 'self-dependency'));
  });

  it('M1-02: rejects a missing prerequisite', () => {
    const result = validateGraph([decision('d1', { prerequisites: ['nope'] })]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const missing = result.problems.find((problem) => problem.kind === 'missing-prerequisite');
    assert.ok(missing);
    assert.match(missing.detail, /not in the session/);
  });

  it('M1-02b: rejects duplicate ids and duplicate prerequisite references', () => {
    const dupIds = validateGraph([decision('d1'), decision('d1', { question: 'Other?' })]);
    assert.equal(dupIds.ok, false);
    if (!dupIds.ok) assert.ok(dupIds.problems.some((p) => p.kind === 'duplicate-id'));

    const dupRefs = validateGraph([decision('d1'), decision('d2', { prerequisites: ['d1', 'd1'] })]);
    assert.equal(dupRefs.ok, false);
    if (!dupRefs.ok) assert.ok(dupRefs.problems.some((p) => p.kind === 'duplicate-prerequisite'));
  });

  it('M1-01c: rejects invalid graph input instead of repairing it', () => {
    for (const value of [undefined, null, 'graph', 42, {}]) {
      const result = validateGraph(value);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.problems[0].kind, 'invalid-input');
    }
    const noId = validateGraph([{ question: 'no id' }]);
    assert.equal(noId.ok, false);
    if (!noId.ok) assert.equal(noId.problems[0].kind, 'invalid-input');

    const badPrereqs = validateGraph([{ id: 'd1', prerequisites: 'd2' }]);
    assert.equal(badPrereqs.ok, false);
  });

  it('accepts an empty graph and a long dependency chain', () => {
    assert.deepEqual(validateGraph([]), { ok: true });

    const chain: Decision[] = [decision('n0')];
    for (let index = 1; index < 40; index += 1) {
      chain.push(decision(`n${index}`, { prerequisites: [`n${index - 1}`] }));
    }
    assert.deepEqual(validateGraph(chain), { ok: true });
    // A 40-deep chain has exactly one question askable at a time.
    assert.deepEqual(ids(frontier(chain)), ['n0']);
    assert.equal(descendants(chain, 'n0').length, 39);
    assert.equal(topologicalOrder(chain).length, 40);
  });

  it('accepts a valid branching graph', () => {
    assert.deepEqual(
      validateGraph([decision('d1'), decision('d2', { prerequisites: ['d1'] }), decision('d3', { prerequisites: ['d1'] })]),
      { ok: true },
    );
  });
});

describe('M1 question frontier', () => {
  it('M1-03: withholds a dependent question until its prerequisite is settled', () => {
    const graph = [decision('d1'), decision('d2', { prerequisites: ['d1'] })];
    assert.deepEqual(ids(frontier(graph)), ['d1']);
    assert.deepEqual(decisionEligibility(graph, graph[1]), { kind: 'blocked', pending: ['d1'] });
  });

  it('M1-04: offers independent eligible questions together', () => {
    const graph = [decision('d1'), decision('d2', { prerequisites: ['root'] }), decision('root')];
    // d1 and root have no unsettled prerequisites; d2 waits on root.
    assert.deepEqual(ids(frontier(graph)), ['d1', 'root']);
  });

  it('M1-04b: offers both branches together once the shared root is settled', () => {
    const graph = [
      answered('root'),
      decision('d2', { prerequisites: ['root'] }),
      decision('d3', { prerequisites: ['root'] }),
    ];
    assert.deepEqual(ids(frontier(graph)), ['d2', 'd3']);
  });

  it('M1-05: a user-confirmed answer unlocks the dependent', () => {
    const blocked = [decision('d1'), decision('d2', { prerequisites: ['d1'] })];
    assert.deepEqual(ids(frontier(blocked)), ['d1']);

    const unlocked = [answered('d1'), decision('d2', { prerequisites: ['d1'] })];
    assert.deepEqual(ids(frontier(unlocked)), ['d2']);
  });

  it('M1-06: an assumed prerequisite does not unlock the dependent', () => {
    const graph = [assumed('d1'), decision('d2', { prerequisites: ['d1'] })];
    // d1 itself is not settled, so it stays askable; d2 stays withheld.
    assert.deepEqual(ids(frontier(graph)), ['d1']);
    assert.equal(isSettledDecision(graph[0]), false);
  });

  it('M1-07: an unresolved answer does not unlock the dependent', () => {
    const undecided = decision('d1', {
      status: 'answered',
      answer: { text: 'I have not decided', chosenOptionId: 'undecided', actor: 'user' },
    });
    // Such a state cannot be persisted as `answered`, so it is unreadable too.
    const stored = readStoredSession({
      schemaVersion: SESSION_SCHEMA_VERSION,
      id: 's1',
      workspace: '/w',
      goal: 'g',
      status: 'interviewing',
      decisions: [undecided],
      createdAt: AT,
      updatedAt: AT,
    });
    assert.equal(stored.kind, 'unreadable');

    // At the graph layer the same decision is simply not settled.
    assert.equal(isSettledDecision(undecided), false);
    const graph = [undecided, decision('d2', { prerequisites: ['d1'] })];
    assert.deepEqual(ids(frontier(graph)), ['d1']);
  });

  it('M1-07b: an unresolved answer by free text is also not settled', () => {
    const undecided = decision('d1', {
      status: 'answered',
      answer: { text: '  i have NOT decided ', actor: 'user' },
    });
    assert.equal(isSettledDecision(undecided), false);
  });

  it('M1-08: needs_review with a retained stale answer does not unlock the dependent', () => {
    const graph = [needsReview('d1'), decision('d2', { prerequisites: ['d1'] })];
    assert.deepEqual(ids(frontier(graph)), ['d1']);
    assert.equal(isSettledDecision(graph[0]), false);
  });

  it('M1-08b: a needs_review decision becomes eligible for reconsideration', () => {
    // Its own prerequisites are satisfied, so it is asked again rather than stuck.
    const graph = [answered('root'), needsReview('d1', ['root'])];
    assert.deepEqual(ids(frontier(graph)), ['d1']);
  });

  it('M1-09: a deferred prerequisite keeps descendants ineligible and is not reopened', () => {
    const graph = [decision('d1', { status: 'deferred' }), decision('d2', { prerequisites: ['d1'] })];
    // Deferred means deliberately postponed: not silently askable again.
    assert.deepEqual(ids(frontier(graph)), []);
    assert.deepEqual(decisionEligibility(graph, graph[0]), { kind: 'deferred' });
    assert.deepEqual(decisionEligibility(graph, graph[1]), { kind: 'blocked', pending: ['d1'] });
  });

  it('M1-10: a stored blocked decision becomes eligible once prerequisites are settled', () => {
    const graph = [answered('d1'), decision('d2', { prerequisites: ['d1'], status: 'blocked' })];
    // Eligibility is derived; the stored `blocked` status is not rewritten.
    assert.deepEqual(decisionEligibility(graph, graph[1]), { kind: 'eligible' });
    assert.deepEqual(ids(frontier(graph)), ['d2']);
    assert.equal(graph[1].status, 'blocked', 'the stored status must not be mutated');
  });

  it('M1-10b: unsettledPrerequisites reports pending ids in declared order', () => {
    const target = decision('d3', { prerequisites: ['d1', 'd2'] });
    const graph = [answered('d1'), decision('d2'), target];
    assert.deepEqual(unsettledPrerequisites(graph, target), ['d2']);
  });

  it('never asks a settled decision again', () => {
    const graph = [answered('d1'), answered('d2', ['d1'])];
    assert.deepEqual(ids(frontier(graph)), []);
  });

  it('returns an empty frontier for an empty graph', () => {
    assert.deepEqual(frontier([]), []);
  });
});

describe('M1 dependency traversal', () => {
  it('M1-11: returns transitive descendants deterministically', () => {
    const graph = [
      decision('d1'),
      decision('d2', { prerequisites: ['d1'] }),
      decision('d3', { prerequisites: ['d2'] }),
      decision('d4', { prerequisites: ['d3'] }),
    ];
    assert.deepEqual(ids(descendants(graph, 'd1')), ['d2', 'd3', 'd4']);
    assert.deepEqual(ids(descendants(graph, 'd2')), ['d3', 'd4']);
    assert.deepEqual(ids(descendants(graph, 'd4')), []);
  });

  it('M1-12: shared descendants appear exactly once', () => {
    // d4 is reachable from d1 via both d2 and d3.
    const graph = [
      decision('d1'),
      decision('d2', { prerequisites: ['d1'] }),
      decision('d3', { prerequisites: ['d1'] }),
      decision('d4', { prerequisites: ['d2', 'd3'] }),
    ];
    assert.deepEqual(ids(descendants(graph, 'd1')), ['d2', 'd3', 'd4']);
    assert.deepEqual(ids(descendants(graph, 'd2')), ['d4']);
  });

  it('handles branching, independent decisions, no edges and unknown ids', () => {
    const independent = [decision('a'), decision('b'), decision('c')];
    for (const id of ['a', 'b', 'c']) assert.deepEqual(descendants(independent, id), []);

    const branching = [
      decision('root'),
      decision('l1', { prerequisites: ['root'] }),
      decision('l2', { prerequisites: ['l1'] }),
      decision('r1', { prerequisites: ['root'] }),
    ];
    assert.deepEqual(ids(descendants(branching, 'root')), ['l1', 'l2', 'r1']);
    assert.deepEqual(ids(descendants(branching, 'nope')), []);
  });

  it('M1-14: does not mutate the decisions or their prerequisites', () => {
    const graph = [decision('d1'), decision('d2', { prerequisites: ['d1'] })];
    const before = structuredClone(graph);
    validateGraph(graph);
    frontier(graph);
    descendants(graph, 'd1');
    topologicalOrder(graph);
    unsettledPrerequisites(graph, graph[1]);
    decisionEligibility(graph, graph[1]);
    assert.deepEqual(graph, before);
  });
});

describe('M1 topological ordering', () => {
  it('M1-13: respects every edge', () => {
    const graph = [
      decision('d4', { prerequisites: ['d2', 'd3'] }),
      decision('d3', { prerequisites: ['d1'] }),
      decision('d2', { prerequisites: ['d1'] }),
      decision('d1'),
    ];
    const order = ids(topologicalOrder(graph));
    assert.equal(order.length, 4);
    for (const current of graph) {
      for (const prerequisite of current.prerequisites) {
        assert.ok(
          order.indexOf(prerequisite) < order.indexOf(current.id),
          `${prerequisite} must precede ${current.id}`,
        );
      }
    }
  });

  it('M1-13b: is deterministic and keeps source order among independent decisions', () => {
    const independent = [decision('c'), decision('a'), decision('b')];
    assert.deepEqual(ids(topologicalOrder(independent)), ['c', 'a', 'b']);
    // Repeated calls agree: no reliance on object iteration order.
    assert.deepEqual(ids(topologicalOrder(independent)), ids(topologicalOrder(independent)));
  });

  it('M1-13c: ordering is stable for a graph with a shared root', () => {
    const graph = [answered('root'), decision('d2', { prerequisites: ['root'] }), decision('d3', { prerequisites: ['root'] })];
    assert.deepEqual(ids(topologicalOrder(graph)), ['root', 'd2', 'd3']);
  });

  it('M1-13d: throws on an unorderable graph instead of returning a partial order', () => {
    assert.throws(
      () => topologicalOrder([decision('a', { prerequisites: ['b'] }), decision('b', { prerequisites: ['a'] })]),
      /cannot be ordered/,
    );
  });

  it('M1-13e: rejects a missing prerequisite reference directly', () => {
    // Called on its own: no caller-side validation, no prior validateGraph().
    assert.throws(
      () => topologicalOrder([decision('a', { prerequisites: ['ghost'] })]),
      /cannot be ordered[\s\S]*not in the session/,
    );
  });

  it('M1-13f: never silently drops a duplicate identifier', () => {
    // The old implementation collapsed duplicate ids and returned a shorter
    // order than its input, which looked like a valid result.
    assert.throws(
      () => topologicalOrder([decision('a'), decision('a', { question: 'Other?' })]),
      /cannot be ordered[\s\S]*duplicate decision id/,
    );
  });

  it('M1-13g: rejects a self-dependency directly', () => {
    assert.throws(
      () => topologicalOrder([decision('a', { prerequisites: ['a'] })]),
      /cannot be ordered[\s\S]*lists itself/,
    );
  });

  it('M1-13h: reports every structural fault in the ordering error', () => {
    let message = '';
    try {
      topologicalOrder([
        decision('a', { prerequisites: ['ghost'] }),
        decision('b', { prerequisites: ['b'] }),
      ]);
    } catch (error) {
      message = (error as Error).message;
    }
    assert.match(message, /not in the session/);
    assert.match(message, /lists itself/);
  });

  it('M1-13i: rejects non-graph input and still orders valid graphs', () => {
    assert.throws(() => topologicalOrder({} as unknown as Decision[]), /cannot be ordered/);
    // A valid graph is unaffected by the added validation step.
    assert.deepEqual(
      ids(topologicalOrder([answered('root'), decision('d2', { prerequisites: ['root'] })])),
      ['root', 'd2'],
    );
  });

  it('returns an empty order for an empty graph', () => {
    assert.deepEqual(topologicalOrder([]), []);
  });
});

describe('M1-15 strict user-confirmation rule', () => {
  it('M1-15: a critical unconfirmed assumption cannot satisfy approval validation', () => {
    const decisions = [assumed('d1')];
    const session = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      id: 's1',
      workspace: '/w',
      goal: 'g',
      status: 'approved' as const,
      decisions,
      createdAt: AT,
      updatedAt: AT,
      approvedAt: AT,
      approvedSnapshot: canonicalDecisionSnapshot(decisions),
    };
    const result = readStoredSession(session);
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /unresolved critical decision/);
  });

  it('M1-15b: only an explicit user-confirmed answer is settled', () => {
    const cases: Array<[string, Decision, boolean]> = [
      ['answered by user', answered('x'), true],
      ['assumed', assumed('x'), false],
      ['needs_review retaining an answer', needsReview('x'), false],
      ['open', decision('x'), false],
      ['deferred', decision('x', { status: 'deferred' }), false],
      ['blocked', decision('x', { status: 'blocked' }), false],
      ['answered but unresolved', decision('x', { status: 'answered', answer: { text: 'I have not decided', actor: 'user' } }), false],
    ];
    for (const [label, candidate, expected] of cases) {
      assert.equal(isSettledDecision(candidate), expected, label);
    }
  });

  it('M1-15c: a dependent is not unlocked by any non-confirmed answer', () => {
    const others: Decision[] = [
      assumed('d1'),
      needsReview('d1'),
      decision('d1', { status: 'deferred' }),
      decision('d1', { status: 'blocked' }),
      decision('d1'),
    ];
    for (const prerequisite of others) {
      const graph = [prerequisite, decision('d2', { prerequisites: ['d1'] })];
      // Whether d1 itself is askable depends on its own status (a deferred
      // question is deliberately not reopened), but d2 must never be offered.
      assert.ok(
        !ids(frontier(graph)).includes('d2'),
        `d2 must stay withheld when d1 is ${prerequisite.status}`,
      );
    }
  });
});

describe('M1 graph integrity in session reads', () => {
  it('rejects a persisted session whose dependencies are broken', () => {
    const session = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      id: 's1',
      workspace: '/w',
      goal: 'g',
      status: 'interviewing' as const,
      decisions: [decision('d1', { prerequisites: ['missing'] })],
      createdAt: AT,
      updatedAt: AT,
    };
    const result = readStoredSession(session);
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /decision graph is invalid/);
  });

  it('rejects a persisted session with a dependency cycle', () => {
    const session = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      id: 's1',
      workspace: '/w',
      goal: 'g',
      status: 'interviewing' as const,
      decisions: [decision('d1', { prerequisites: ['d2'] }), decision('d2', { prerequisites: ['d1'] })],
      createdAt: AT,
      updatedAt: AT,
    };
    const result = readStoredSession(session);
    assert.equal(result.kind, 'unreadable');
    if (result.kind !== 'unreadable') return;
    assert.match(result.reason, /decision graph is invalid/);
  });

  it('accepts a valid dependency graph and keeps it intact', () => {
    const decisions = [answered('d1'), decision('d2', { prerequisites: ['d1'] })];
    const session = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      id: 's1',
      workspace: '/w',
      goal: 'g',
      status: 'interviewing' as const,
      decisions,
      createdAt: AT,
      updatedAt: AT,
    };
    const result = readStoredSession(session);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.deepEqual(ids(result.session.decisions), ['d1', 'd2']);
    assert.deepEqual(ids(frontier(result.session.decisions)), ['d2']);
  });
});
