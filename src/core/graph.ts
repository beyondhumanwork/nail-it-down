/**
 * M1 Slice 2: the deterministic decision graph.
 *
 * Pure domain code, exactly like `session.ts`: no host API, no filesystem, no
 * clock reads, no model or network access. Everything here is a total function
 * over the decisions you hand it, so graph behaviour is verified by ordinary
 * unit tests without Command Code installed.
 *
 * Why eligibility lives here rather than in `session.ts`: what counts as a
 * settled decision *is* the rule that decides whether a dependent question may
 * be asked. Keeping one copy of that rule in the graph layer means a question
 * can never be unlocked by a decision the approval check would still reject.
 *
 * Import direction (deliberate, keeps the modules acyclic):
 *   session.ts -> graph.ts   (runtime: validation, eligibility)
 *   graph.ts   -> session.ts (types only, erased at runtime)
 * So there is no runtime import cycle between the two modules.
 */

import type { Decision, DecisionAnswer, DecisionOption } from './session.ts';

// ---------------------------------------------------------------------------
// Eligibility: what may satisfy a prerequisite, be asked, or support approval.
// ---------------------------------------------------------------------------

/** Labels that explicitly mean "no decision yet". Only the M0 choice ships here. */
export const UNRESOLVED_ANSWER_LABELS: readonly string[] = ['I have not decided'];

function normalizeAnswerText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** True only for an answer that is, by exact designation, not a decision. */
export function isUnresolvedAnswerText(text: string): boolean {
  const normalized = normalizeAnswerText(text);
  return UNRESOLVED_ANSWER_LABELS.some((label) => normalizeAnswerText(label) === normalized);
}

/**
 * One rule for both representations: an explicit unresolved option selection,
 * or free text that exactly reproduces a designated undecided label. A chosen
 * option is judged only by its identity, never by its prose — a custom answer
 * that happens to mention uncertainty is still a real decision.
 */
export function isUnresolvedAnswer(
  answer: DecisionAnswer,
  options: readonly DecisionOption[],
): boolean {
  if (answer.chosenOptionId !== undefined) {
    return options.find((option) => option.id === answer.chosenOptionId)?.unresolved === true;
  }
  return isUnresolvedAnswerText(answer.text);
}

/**
 * The strict M1 settlement rule: only a valid, explicit, user-confirmed
 * `answered` decision is settled.
 *
 * `assumed` is deliberately NOT settled. The schema keeps the status so future
 * milestones can propose assumptions, but in M1 an assumption is never user
 * confirmation, so it may not satisfy a prerequisite or an approval. Likewise
 * `needs_review` keeps its prior answer only as history, and `open`, `deferred`
 * and `blocked` have no settled answer at all.
 */
export function isSettledDecision(decision: Decision): boolean {
  if (decision.status !== 'answered') return false;
  if (decision.answer === undefined) return false;
  if (decision.answer.actor !== 'user') return false;
  return !isUnresolvedAnswer(decision.answer, decision.options);
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

export type GraphProblem =
  | { kind: 'invalid-input'; decisionId?: string; detail: string }
  | { kind: 'duplicate-id'; decisionId: string; detail: string }
  | { kind: 'missing-prerequisite'; decisionId: string; prerequisiteId: string; detail: string }
  | { kind: 'self-dependency'; decisionId: string; detail: string }
  | { kind: 'duplicate-prerequisite'; decisionId: string; prerequisiteId: string; detail: string }
  /**
   * `path` lists each decision in the cycle exactly once, in traversal order,
   * starting at the entry point where the cycle was detected. The cycle is
   * closed by an implicit edge from the last element back to the first, so it
   * is never repeated at the end: a two-decision cycle stores `[A, B]`, not
   * `[A, B, A]`. `decisionId` always equals `path[0]`, and `path.length` is the
   * number of decisions in the cycle. `detail` closes the loop for display.
   */
  | { kind: 'cycle'; decisionId: string; path: string[]; detail: string };

export type GraphValidation = { ok: true } | { ok: false; problems: GraphProblem[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFilledString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** A short, readable summary of one problem, used in unreadable-state reasons. */
export function describeGraphProblem(problem: GraphProblem): string {
  return problem.detail;
}

/**
 * Validates the dependency structure of a decision list.
 *
 * Returns every problem found rather than the first, so a caller can report all
 * of them at once — with one deliberate exception: only the **first** cycle
 * detected is reported, not every cycle in the graph. Finding all cycles is
 * exponential in the worst case and buys nothing here, since one cycle is
 * already enough to reject the graph. Do not read the absence of further cycle
 * entries as evidence that none exist.
 *
 * Never repairs or reorders anything: an invalid graph stays invalid and the
 * caller decides what to do about it. Problems are reported in source array
 * order (and, within a decision, in prerequisite order), so the output is
 * deterministic.
 *
 * An empty list is valid — a session may legitimately have no decisions.
 */
export function validateGraph(decisions: unknown): GraphValidation {
  if (!Array.isArray(decisions)) {
    return {
      ok: false,
      problems: [{ kind: 'invalid-input', detail: 'the decision graph is not a list' }],
    };
  }

  const problems: GraphProblem[] = [];

  // Pass 1 — each entry must be identifiable before its edges mean anything.
  const ids: string[] = [];
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();
  let allIdentified = true;
  for (const [index, raw] of decisions.entries()) {
    if (!isPlainObject(raw) || !isFilledString(raw.id)) {
      allIdentified = false;
      problems.push({
        kind: 'invalid-input',
        detail: `decision at position ${index} has no usable id`,
      });
      continue;
    }
    const id = raw.id;
    ids.push(id);
    if (seen.has(id)) duplicateIds.add(id);
    seen.add(id);
  }
  for (const id of duplicateIds) {
    problems.push({
      kind: 'duplicate-id',
      decisionId: id,
      detail: `duplicate decision id (${id})`,
    });
  }

  // Pass 2 — edges. Skipped for entries we could not identify above.
  let edgesUsable = allIdentified && duplicateIds.size === 0;
  for (const raw of decisions) {
    if (!isPlainObject(raw) || !isFilledString(raw.id)) continue;
    const selfId = raw.id;
    const prerequisites = raw.prerequisites;
    if (prerequisites === undefined) continue;
    if (!Array.isArray(prerequisites)) {
      edgesUsable = false;
      problems.push({
        kind: 'invalid-input',
        decisionId: selfId,
        detail: `prerequisites of ${selfId} are not a list`,
      });
      continue;
    }

    const localSeen = new Set<string>();
    for (const prerequisite of prerequisites) {
      if (!isFilledString(prerequisite)) {
        edgesUsable = false;
        problems.push({
          kind: 'invalid-input',
          decisionId: selfId,
          detail: `a prerequisite of ${selfId} is not a decision id`,
        });
        continue;
      }
      if (prerequisite === selfId) {
        edgesUsable = false;
        problems.push({
          kind: 'self-dependency',
          decisionId: selfId,
          detail: `${selfId} lists itself as a prerequisite`,
        });
        continue;
      }
      if (localSeen.has(prerequisite)) {
        edgesUsable = false;
        problems.push({
          kind: 'duplicate-prerequisite',
          decisionId: selfId,
          prerequisiteId: prerequisite,
          detail: `${selfId} lists prerequisite ${prerequisite} more than once`,
        });
        continue;
      }
      localSeen.add(prerequisite);
      if (!seen.has(prerequisite)) {
        edgesUsable = false;
        problems.push({
          kind: 'missing-prerequisite',
          decisionId: selfId,
          prerequisiteId: prerequisite,
          detail: `${selfId} depends on ${prerequisite}, which is not in the session`,
        });
      }
    }
  }

  // Pass 3 — cycles of any length, only once the edges are trustworthy. A cycle
  // path is only meaningful when every reference resolves.
  if (edgesUsable) {
    const cycle = findCycle(decisions);
    if (cycle !== undefined) {
      problems.push({
        kind: 'cycle',
        decisionId: cycle[0],
        path: cycle,
        detail: `dependency cycle (${[...cycle, cycle[0]].join(' -> ')})`,
      });
    }
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/**
 * Depth-first cycle detection over prerequisite edges.
 * Determinates: roots and edges are visited in source array order, so the
 * reported path is stable for a given input.
 */
function findCycle(decisions: readonly unknown[]): string[] | undefined {
  const prerequisitesById = new Map<string, string[]>();
  const order: string[] = [];
  for (const raw of decisions) {
    if (!isPlainObject(raw) || !isFilledString(raw.id)) continue;
    const prerequisites = Array.isArray(raw.prerequisites)
      ? raw.prerequisites.filter(isFilledString)
      : [];
    prerequisitesById.set(raw.id, prerequisites.filter((id) => id !== raw.id));
    order.push(raw.id);
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): string[] | undefined => {
    const current = state.get(id);
    if (current === 'done') return undefined;
    if (current === 'visiting') {
      const start = stack.indexOf(id);
      // Each decision once: the closing edge back to `id` is implicit, so the
      // entry point is not repeated at the end (that repeat was the bug that
      // rendered `A -> B -> A -> A` downstream).
      return stack.slice(start);
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const prerequisite of prerequisitesById.get(id) ?? []) {
      const found = visit(prerequisite);
      if (found !== undefined) return found;
    }
    stack.pop();
    state.set(id, 'done');
    return undefined;
  };

  for (const id of order) {
    const found = visit(id);
    if (found !== undefined) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Blocked-state semantics
// ---------------------------------------------------------------------------

/**
 * Why a decision may or may not be asked right now.
 *
 * Answerability is always *derived* from the current graph. Stored `status` is
 * never rewritten to make a question askable, so there is no second
 * authoritative copy of dependency state to drift out of sync:
 *
 * - `eligible`   — askable now; every prerequisite is settled.
 * - `settled`    — already answered by the user; never asked again.
 * - `deferred`   — deliberately postponed; not reopened automatically.
 * - `blocked`    — unanswered or stale, waiting on the listed prerequisites.
 *
 * A stored `blocked` decision whose prerequisites have since been settled is
 * therefore reported `eligible` with no state change. That is the documented,
 * deterministic way this engine recognises it: the stored status is history,
 * the derived verdict is the answer.
 */
export type DecisionEligibility =
  | { kind: 'eligible' }
  | { kind: 'settled' }
  | { kind: 'deferred' }
  | { kind: 'blocked'; pending: string[] };

/** Prerequisites of a decision that are not settled yet, in declared order. */
export function unsettledPrerequisites(
  decisions: readonly Decision[],
  decision: Decision,
): string[] {
  const settled = new Set(
    decisions.filter(isSettledDecision).map((candidate) => candidate.id),
  );
  return decision.prerequisites.filter((prerequisite) => !settled.has(prerequisite));
}

/** The derived verdict for one decision. */
export function decisionEligibility(
  decisions: readonly Decision[],
  decision: Decision,
): DecisionEligibility {
  if (isSettledDecision(decision)) return { kind: 'settled' };
  if (decision.status === 'deferred') return { kind: 'deferred' };
  const pending = unsettledPrerequisites(decisions, decision);
  if (pending.length > 0) return { kind: 'blocked', pending };
  return { kind: 'eligible' };
}

/**
 * The questions the user can answer next, in source array order.
 *
 * Every prerequisite must be settled by an explicit, user-confirmed answer. An
 * assumption, an unresolved choice, a deferred decision or a `needs_review`
 * decision with a retained stale answer all leave dependents blocked.
 * `needs_review` decisions become eligible again once their own prerequisites
 * are settled, which is how a reconsideration is offered without discarding the
 * previous answer.
 */
export function frontier(decisions: readonly Decision[]): Decision[] {
  return decisions.filter((decision) => decisionEligibility(decisions, decision).kind === 'eligible');
}

// ---------------------------------------------------------------------------
// Dependency traversal
// ---------------------------------------------------------------------------

/**
 * Every decision that depends on `decisionId`, directly or transitively.
 *
 * Deterministic: the result is filtered into source array order and each
 * decision appears exactly once, including when several paths reach it.
 * Shared descendants therefore collapse to a single entry, and `decisionId`
 * itself is never included. An unknown id yields an empty list.
 */
export function descendants(
  decisions: readonly Decision[],
  decisionId: string,
): Decision[] {
  if (!decisions.some((decision) => decision.id === decisionId)) return [];

  // Reverse adjacency, built once, so traversal cost does not depend on order.
  const dependents = new Map<string, string[]>();
  for (const decision of decisions) {
    for (const prerequisite of decision.prerequisites) {
      const existing = dependents.get(prerequisite);
      if (existing === undefined) dependents.set(prerequisite, [decision.id]);
      else existing.push(decision.id);
    }
  }

  const reached = new Set<string>();
  const queue = [decisionId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependent of dependents.get(current) ?? []) {
      if (reached.has(dependent)) continue;
      reached.add(dependent);
      queue.push(dependent);
    }
  }
  reached.delete(decisionId);

  return decisions.filter((decision) => reached.has(decision.id));
}

/**
 * A deterministic topological order: every decision appears after all of its
 * prerequisites.
 *
 * Ties are broken by source array order, never by object iteration order, so
 * independent decisions keep their authored sequence. Throws on a graph that
 * cannot be ordered rather than returning a silently partial result.
 */
export function topologicalOrder(decisions: readonly Decision[]): Decision[] {
  // Ordering is only meaningful for a structurally sound graph. A missing
  // prerequisite used to be treated as already satisfied, which let a broken
  // graph produce a plausible-looking order; duplicate ids silently dropped a
  // decision from the result. Validate first and reject instead.
  const validation = validateGraph(decisions);
  if (!validation.ok) {
    throw new Error(
      `the decision graph cannot be ordered (${validation.problems.map(describeGraphProblem).join('; ')})`,
    );
  }

  const remaining = new Set(decisions.map((decision) => decision.id));
  const ordered: Decision[] = [];

  while (remaining.size > 0) {
    // First decision in source order whose prerequisites are all placed.
    const next = decisions.find(
      (decision) =>
        remaining.has(decision.id) &&
        decision.prerequisites.every((prerequisite) => !remaining.has(prerequisite)),
    );
    if (next === undefined) {
      // Unreachable once the graph validates: acyclic, unique ids and complete
      // references always admit an order. Kept as a backstop so this can never
      // return a partial order.
      const stuck = decisions.filter((decision) => remaining.has(decision.id)).map((d) => d.id);
      throw new Error(`the decision graph cannot be ordered (stuck among ${stuck.join(', ')})`);
    }
    remaining.delete(next.id);
    ordered.push(next);
  }

  return ordered;
}
