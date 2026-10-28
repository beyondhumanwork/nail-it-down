/**
 * M1 Slice 3: deterministic session transitions.
 *
 * Pure domain code, like `session.ts` and `graph.ts`: no host API, no
 * filesystem, no clock reads (every function takes `now`), no model or network
 * access. Each transition returns a new `Session` or a typed failure and never
 * mutates its input, which is what makes "no invalid transition partially
 * mutates the session" a property the type system and the tests can hold.
 *
 * Two rules shape the whole module:
 *
 * 1. **Readiness is not approval.** `approvalReadiness` is a pure calculation.
 *    `approveSession` is a separate, explicit transition that additionally
 *    requires a confirmation it cannot manufacture.
 * 2. **Trust nothing on the way in or out.** Every input is passed through the
 *    existing `readStoredSession` validator and so is every result. A
 *    transition that would produce state the schema rejects fails closed rather
 *    than handing back a session that corrupts storage.
 *
 * Eligibility, traversal and ordering are not re-implemented here. This module
 * composes `isSettledDecision`, `decisionEligibility`, `descendants` and
 * `topologicalOrder` from the Slice 2 graph engine, so there is exactly one
 * definition of each rule in the codebase.
 *
 * Import direction stays acyclic: `transitions -> session -> graph`,
 * `transitions -> graph`.
 */

import { canonicalDecisionSnapshot, readStoredSession, settledWithUnmetPrerequisites } from './session.ts';
import type { Decision, Session } from './session.ts';
import {
  decisionEligibility,
  descendants,
  isSettledDecision,
  isUnresolvedAnswer,
  topologicalOrder,
} from './graph.ts';

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/**
 * Every way a transition can decline to produce a session. A failure always
 * leaves the caller's session untouched, so the caller can report the message
 * and keep going with the state it already had.
 */
export type TransitionErrorCode =
  | 'invalid-session'
  | 'invalid-result'
  | 'unknown-decision'
  | 'not-eligible'
  | 'deferred-decision'
  | 'invalid-option'
  | 'invalid-answer'
  | 'unresolved-answer'
  | 'critical-deferral'
  | 'already-settled'
  | 'retains-answer'
  | 'not-deferred'
  | 'approved-session'
  | 'not-confirmed'
  | 'not-ready';

export type TransitionError = {
  code: TransitionErrorCode;
  message: string;
  decisionId?: string;
  /** Prerequisites still outstanding, when `code` is `not-eligible`. */
  pending?: string[];
  /** Why an approval was refused, when `code` is `not-ready`. */
  blockers?: ApprovalBlocker[];
};

export type TransitionResult =
  | { ok: true; session: Session }
  | { ok: false; error: TransitionError };

function fail(code: TransitionErrorCode, message: string, extra: Partial<TransitionError> = {}): TransitionResult {
  return { ok: false, error: { code, message, ...extra } };
}

// ---------------------------------------------------------------------------
// Guards: fail closed on untrustworthy input and on untrustworthy output
// ---------------------------------------------------------------------------

/**
 * Validates the session a caller handed us. A caller that passes anything the
 * schema would not read back gets a failure instead of a transition built on
 * inconsistent state — including a broken dependency graph, because
 * `readStoredSession` validates that too.
 */
function guardSession(value: unknown): { ok: true; session: Session } | { ok: false; error: TransitionError } {
  const read = readStoredSession(value);
  if (read.kind === 'ok') return { ok: true, session: read.session };
  const message = read.kind === 'empty'
    ? 'no session was supplied'
    : `the session cannot be trusted: ${read.reason}`;
  return { ok: false, error: { code: 'invalid-session', message } };
}

/**
 * Narrow runtime guard for payloads that arrive from outside the type system.
 *
 * Slice 4 will feed these functions from a host adapter, where a malformed
 * call is a real possibility and an uncaught property access would take down
 * the command instead of reporting a refusal.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a transition result before it leaves the module. If a transition
 * ever constructed state the schema rejects, the caller gets a failure rather
 * than a corrupt session. This is a backstop, not a substitute for the tests
 * that assert each transition produces valid state.
 */
function finish(session: Session): TransitionResult {
  const read = readStoredSession(session);
  if (read.kind !== 'ok') {
    const detail = read.kind === 'unreadable' ? read.reason : 'the session is empty';
    return fail('invalid-result', `the transition produced an invalid session (${detail})`);
  }
  return { ok: true, session: read.session };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function cloneDecision(decision: Decision, overrides: Partial<Decision> = {}): Decision {
  const next: Decision = {
    id: decision.id,
    question: decision.question,
    whyItMatters: decision.whyItMatters,
    priority: decision.priority,
    prerequisites: [...decision.prerequisites],
    status: decision.status,
    options: decision.options.map((option) => (
      option.unresolved === true
        ? { id: option.id, label: option.label, consequence: option.consequence, unresolved: true }
        : { id: option.id, label: option.label, consequence: option.consequence }
    )),
    updatedAt: decision.updatedAt,
  };
  if (decision.answer !== undefined) {
    next.answer = { ...decision.answer };
  }
  return { ...next, ...overrides };
}

/** Replaces one decision by id, preserving source array order. */
function replaceDecision(decisions: readonly Decision[], replacement: Decision): Decision[] {
  return decisions.map((decision) => (decision.id === replacement.id ? replacement : decision));
}

/**
 * True when two answers record the same decision.
 *
 * Comparison is exact on both the chosen option and the text. Text is the part
 * a person reads back in the approval snapshot, so a wording change is treated
 * as material even when the option is the same — the conservative direction,
 * because the cost of a false "nothing changed" is an approval that no longer
 * matches what was reviewed.
 */
function sameAnswer(a: Decision['answer'], b: Decision['answer']): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.text === b.text && a.chosenOptionId === b.chosenOptionId && a.actor === b.actor;
}

/**
 * Revokes approval when an edit changed the reviewed snapshot.
 *
 * The whole lifecycle, because it is easy to assume more than happens:
 *
 * 1. The first material change drops `approvedAt` and `approvedSnapshot` and
 *    returns the session to `interviewing`.
 * 2. That metadata is gone. Reverting the change afterwards finds no approval to
 *    compare against, so it does **not** restore the previous approval — a fresh,
 *    explicit `approveSession` is required.
 *
 * `canonicalDecisionSnapshot` is used rather than a "something changed" flag so
 * that an edit which is a genuine no-op (the identical answer, see
 * `answerDecision`) never revokes anything. It is *not* a promise that editing
 * and then reverting keeps approval: once revoked, approval stays revoked.
 */
function revokeApprovalIfStale(session: Session, decisions: readonly Decision[], now: string): Session {
  if (session.approvedAt === undefined && session.approvedSnapshot === undefined) {
    return { ...session, decisions: [...decisions], updatedAt: now };
  }
  if (session.approvedSnapshot === canonicalDecisionSnapshot(decisions)) {
    return { ...session, decisions: [...decisions], updatedAt: now };
  }
  const revoked: Session = {
    schemaVersion: session.schemaVersion,
    id: session.id,
    workspace: session.workspace,
    goal: session.goal,
    status: 'interviewing',
    decisions: [...decisions],
    createdAt: session.createdAt,
    updatedAt: now,
  };
  return revoked;
}

/**
 * Marks every transitive dependent of `rootId` as needing review, in
 * deterministic topological order.
 *
 * Only decisions that are currently *settled* change: an answer that was
 * treated as decided becomes stale. Decisions that already needed review are
 * left exactly as they were, which makes repeated invalidation idempotent and
 * stops a second revision from churning timestamps and the snapshot.
 *
 * Two deliberate non-actions:
 * - `deferred` dependents keep their status. Deferral is an explicit user act
 *   and invalidating a parent does not reopen it.
 * - Unanswered dependents (`open`, `blocked`) keep their status. There is no
 *   answer to mark stale, and their ineligibility is already derived from their
 *   prerequisites. This is what keeps "blocked and unanswered" distinguishable
 *   from "previously answered and invalidated".
 */
function invalidateDescendants(
  decisions: readonly Decision[],
  rootId: string,
  now: string,
): Decision[] {
  const affected = new Set(descendants(decisions, rootId).map((decision) => decision.id));
  if (affected.size === 0) return [...decisions];

  // Topological order over the whole graph, then filtered, so invalidation
  // happens parents-first regardless of storage order.
  const ordered = topologicalOrder(decisions).filter((decision) => affected.has(decision.id));

  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  for (const decision of ordered) {
    if (!isSettledDecision(decision)) continue;
    const current = byId.get(decision.id);
    if (current === undefined) continue;
    // Keep the previous answer: it is history the person can inspect while
    // deciding. `needs_review` is what marks it stale, and `isSettledDecision`
    // already refuses to treat it as confirmation.
    byId.set(decision.id, cloneDecision(current, { status: 'needs_review', updatedAt: now }));
  }

  return decisions.map((decision) => byId.get(decision.id) ?? decision);
}

// ---------------------------------------------------------------------------
// Answering and revising
// ---------------------------------------------------------------------------

/**
 * A user-confirmed answer. `actor` is deliberately absent: the only thing this
 * module records is what the person chose, so a caller cannot label a
 * user-answer path as an assumption.
 */
export type DecisionAnswerInput = {
  text: string;
  chosenOptionId?: string;
};

/**
 * Records an explicit, user-confirmed answer, or revises one already recorded.
 *
 * Both cases are the same operation because they must share one material-change
 * rule: a new answer fills an empty decision, a changed answer invalidates the
 * dependents that were decided on top of it, and an identical answer does
 * nothing at all.
 *
 * A settled decision stays answerable on purpose — that is how a revision is
 * requested. A decision blocked by unresolved prerequisites, or one the user
 * deferred, is refused; deferral has its own explicit reconsideration path.
 */
export function answerDecision(
  session: Session,
  decisionId: string,
  answer: DecisionAnswerInput,
  now: string,
): TransitionResult {
  const guarded = guardSession(session);
  if (!guarded.ok) return guarded;
  const current = guarded.session;

  const target = current.decisions.find((decision) => decision.id === decisionId);
  if (target === undefined) {
    return fail('unknown-decision', `there is no decision ${decisionId} in this session`, { decisionId });
  }

  const eligibility = decisionEligibility(current.decisions, target);
  if (eligibility.kind === 'blocked') {
    return fail(
      'not-eligible',
      `${decisionId} cannot be answered yet; waiting on ${eligibility.pending.join(', ')}`,
      { decisionId, pending: [...eligibility.pending] },
    );
  }
  if (eligibility.kind === 'deferred') {
    return fail(
      'deferred-decision',
      `${decisionId} is deferred; reconsider it explicitly before answering`,
      { decisionId },
    );
  }

  if (!isRecord(answer) || typeof answer.text !== 'string') {
    // Malformed runtime payload, not a decision the person could have meant.
    return fail('invalid-answer', 'an answer must be an object with text', { decisionId });
  }
  if (answer.text.trim() === '') {
    return fail('unresolved-answer', 'an answer needs text', { decisionId });
  }

  const chosenOptionId = answer.chosenOptionId;
  if (chosenOptionId !== undefined) {
    const option = target.options.find((candidate) => candidate.id === chosenOptionId);
    if (option === undefined) {
      return fail('invalid-option', `${decisionId} has no option ${chosenOptionId}`, { decisionId });
    }
  }

  const nextAnswer = chosenOptionId === undefined
    ? { text: answer.text, actor: 'user' as const }
    : { text: answer.text, chosenOptionId, actor: 'user' as const };

  // One rule for both representations, shared with the graph engine: selecting
  // an option flagged `unresolved` and typing a designated undecided label are
  // both a recorded non-decision. Selecting the undecided option is a real
  // thing a person can do, but it must never become a settled answer.
  if (isUnresolvedAnswer(nextAnswer, target.options)) {
    return fail(
      'unresolved-answer',
      'that answer records no decision, so it cannot settle this question',
      { decisionId },
    );
  }

  const hadAnswer = target.answer !== undefined;
  const identical = hadAnswer && sameAnswer(target.answer, nextAnswer);
  // Repeating a settled answer changes nothing. Repeating a *retained* answer
  // is different: `needs_review` marks that answer stale, so the person saying
  // it again is an explicit reconfirmation and must restore `answered`.
  const reconfirmation = target.status !== 'answered';

  if (identical && !reconfirmation) {
    // Re-recording the same answer on a settled decision is a no-op, not a
    // write. It must not bump a timestamp (the snapshot covers `updatedAt`) and
    // must not invalidate a single dependent.
    return { ok: true, session: current };
  }

  const answered = cloneDecision(target, {
    status: 'answered',
    answer: nextAnswer,
    updatedAt: now,
  });

  let decisions = replaceDecision(current.decisions, answered);
  if (hadAnswer && !identical) {
    // A genuine revision: everything decided on top of the old answer is stale.
    // A reconfirmation of an identical answer invalidates nothing, so dependents
    // that are already stale stay stale until each is reconsidered on its own.
    decisions = invalidateDescendants(decisions, decisionId, now);
  }

  return finish(revokeApprovalIfStale(current, decisions, now));
}

// ---------------------------------------------------------------------------
// Deferral
// ---------------------------------------------------------------------------

/**
 * Postpones a non-critical decision.
 *
 * Critical decisions cannot be deferred: a critical question is the reason the
 * interview exists, and allowing it to be set aside would let a session look
 * finished while its most important question is unanswered.
 *
 * Deferral never discards a recorded answer. A decision that already carries
 * one is refused rather than silently downgraded, because the schema does not
 * let `deferred` carry an answer and losing a person's stated decision to a
 * reformatting operation would be unacceptable.
 */
export function deferDecision(session: Session, decisionId: string, now: string): TransitionResult {
  const guarded = guardSession(session);
  if (!guarded.ok) return guarded;
  const current = guarded.session;

  const target = current.decisions.find((decision) => decision.id === decisionId);
  if (target === undefined) {
    return fail('unknown-decision', `there is no decision ${decisionId} in this session`, { decisionId });
  }

  if (target.status === 'deferred') {
    return { ok: true, session: current };
  }
  if (target.priority === 'critical') {
    return fail(
      'critical-deferral',
      `${decisionId} is critical and cannot be deferred`,
      { decisionId },
    );
  }
  if (isSettledDecision(target)) {
    return fail(
      'already-settled',
      `${decisionId} is already answered; revise it instead of deferring it`,
      { decisionId },
    );
  }
  if (target.answer !== undefined) {
    return fail(
      'retains-answer',
      `${decisionId} keeps an earlier answer; deferring it would discard that answer`,
      { decisionId },
    );
  }

  const deferred = cloneDecision(target, { status: 'deferred', updatedAt: now });
  const decisions = replaceDecision(current.decisions, deferred);
  return finish(revokeApprovalIfStale(current, decisions, now));
}

/**
 * The explicit path back from deferral.
 *
 * Deferral is only undoable here, on purpose: nothing reopens a deferred
 * decision implicitly. Reconsidering returns it to `open`, and whether it is
 * actually answerable again is derived from its prerequisites, not asserted by
 * this transition.
 */
export function reconsiderDeferred(session: Session, decisionId: string, now: string): TransitionResult {
  const guarded = guardSession(session);
  if (!guarded.ok) return guarded;
  const current = guarded.session;

  const target = current.decisions.find((decision) => decision.id === decisionId);
  if (target === undefined) {
    return fail('unknown-decision', `there is no decision ${decisionId} in this session`, { decisionId });
  }
  if (target.status !== 'deferred') {
    return fail('not-deferred', `${decisionId} is not deferred`, { decisionId });
  }

  const reopened = cloneDecision(target, { status: 'open', updatedAt: now });
  const decisions = replaceDecision(current.decisions, reopened);
  return finish(revokeApprovalIfStale(current, decisions, now));
}

// ---------------------------------------------------------------------------
// Pause and resume
// ---------------------------------------------------------------------------

/**
 * Pauses an interview without touching a single decision.
 *
 * An approved session cannot be paused: `paused` and `approved` are different
 * session statuses, so pausing would have to throw approval metadata away.
 * Approval is revoked by editing a decision, not by setting the session aside.
 */
export function pauseSession(session: Session, now: string): TransitionResult {
  const guarded = guardSession(session);
  if (!guarded.ok) return guarded;
  const current = guarded.session;

  if (current.status === 'paused') {
    return { ok: true, session: current };
  }
  if (current.status === 'approved') {
    return fail(
      'approved-session',
      'an approved session cannot be paused; a material edit revokes approval instead',
    );
  }

  return finish({ ...current, decisions: current.decisions.map((decision) => cloneDecision(decision)), status: 'paused', updatedAt: now });
}

/**
 * Resumes a paused interview.
 *
 * Resuming always lands in `interviewing` and never guesses `review`. `review`
 * is a transient surface the adapter shows when `approvalReadiness` says the
 * decisions are complete; restoring it here would mean inventing a state the
 * session never recorded. Nothing is lost by this: every answer is intact, and
 * readiness is recomputed from the decisions whenever it is asked for.
 */
export function resumeSession(session: Session, now: string): TransitionResult {
  const guarded = guardSession(session);
  if (!guarded.ok) return guarded;
  const current = guarded.session;

  if (current.status !== 'paused') {
    // Repeated resumes are harmless no-ops rather than errors.
    return { ok: true, session: current };
  }

  return finish({ ...current, decisions: current.decisions.map((decision) => cloneDecision(decision)), status: 'interviewing', updatedAt: now });
}

// ---------------------------------------------------------------------------
// Approval readiness — a calculation, not a state change
// ---------------------------------------------------------------------------

export type ApprovalBlockerKind =
  | 'no-decisions'
  | 'needs-review'
  | 'assumption-not-confirmed'
  | 'deferred-critical'
  | 'unsettled-critical'
  | 'unmet-prerequisite';

export type ApprovalBlocker = {
  kind: ApprovalBlockerKind;
  decisionId?: string;
  /** Prerequisites still outstanding, when `kind` is `unmet-prerequisite`. */
  pending?: string[];
  message: string;
};

export type ApprovalReadiness = {
  ready: boolean;
  blockers: ApprovalBlocker[];
};

/**
 * What still stands between this session and an approval.
 *
 * Pure: it reads the decisions and returns a verdict. It does not mutate the
 * session, move it to `review`, or approve anything — being ready is not
 * approval, and an empty frontier is not approval either.
 *
 * The checks mirror exactly what `readStoredSession` demands of an approved
 * session, so "ready" and "the schema will accept the approval" cannot drift
 * apart. Any `needs_review` decision blocks, at every priority, because the
 * schema refuses an approved session that contains one.
 *
 * Blockers are reported in source decision order, which makes the output stable
 * and lets an adapter show them in the order the person wrote them.
 */
export function approvalReadiness(session: Session): ApprovalReadiness {
  const read = readStoredSession(session);
  if (read.kind !== 'ok') {
    return {
      ready: false,
      blockers: [{
        kind: 'no-decisions',
        message: read.kind === 'empty'
          ? 'no session was supplied'
          : `the session cannot be trusted: ${read.reason}`,
      }],
    };
  }

  const decisions = read.session.decisions;
  const blockers: ApprovalBlocker[] = [];

  if (decisions.length === 0) {
    // An approval over nothing approves nothing.
    blockers.push({
      kind: 'no-decisions',
      message: 'there are no decisions to approve',
    });
    return { ready: false, blockers };
  }

  // One definition of the contradiction, shared with the approved-session
  // validator, so readiness and validation cannot disagree.
  const unmetById = new Map(
    settledWithUnmetPrerequisites(decisions).map((conflict) => [conflict.decisionId, conflict.pending]),
  );

  for (const decision of decisions) {
    if (decision.status === 'needs_review') {
      blockers.push({
        kind: 'needs-review',
        decisionId: decision.id,
        message: `${decision.id} needs review before this can be approved`,
      });
      continue;
    }

    if (isSettledDecision(decision)) {
      // A settled decision resting on an unsettled prerequisite is a
      // contradiction: the answer would be approval over ground the person
      // never settled.
      const pending = unmetById.get(decision.id);
      if (pending !== undefined) {
        blockers.push({
          kind: 'unmet-prerequisite',
          decisionId: decision.id,
          pending: [...pending],
          message: `${decision.id} is answered but waits on unsettled ${pending.join(', ')}`,
        });
      }
      continue;
    }

    if (decision.priority !== 'critical') continue;

    if (decision.status === 'assumed') {
      blockers.push({
        kind: 'assumption-not-confirmed',
        decisionId: decision.id,
        message: `${decision.id} is only assumed, not confirmed by the user`,
      });
      continue;
    }
    if (decision.status === 'deferred') {
      blockers.push({
        kind: 'deferred-critical',
        decisionId: decision.id,
        message: `${decision.id} is critical and deferred`,
      });
      continue;
    }
    blockers.push({
      kind: 'unsettled-critical',
      decisionId: decision.id,
      message: `${decision.id} is a critical decision with no confirmed answer`,
    });
  }

  return { ready: blockers.length === 0, blockers };
}

// ---------------------------------------------------------------------------
// Explicit approval
// ---------------------------------------------------------------------------

/**
 * The result of a user confirmation prompt, as produced by a future host
 * adapter. The core cannot create one of these: it is a parameter, never
 * derived, and anything other than a literal `true` is refused. That is the
 * default-deny contract in code — a missing, dismissed, headless or malformed
 * dialog result all land on "not approved".
 */
export type ApprovalConfirmation = {
  confirmed: boolean;
};

/**
 * Records an explicit approval.
 *
 * Refuses unless the caller supplies a confirmation, and unless
 * `approvalReadiness` passes on the current decisions. The stored snapshot is
 * the canonical text of exactly those decisions, so the existing schema
 * validation can re-derive it later and detect staleness.
 *
 * This never happens automatically. An empty frontier, a filled-in decision
 * list, or a session that merely looks complete all leave approval to a separate
 * explicit call.
 */
export function approveSession(
  session: Session,
  confirmation: ApprovalConfirmation | undefined,
  now: string,
): TransitionResult {
  const guarded = guardSession(session);
  if (!guarded.ok) return guarded;
  const current = guarded.session;

  if (!isRecord(confirmation) || confirmation.confirmed !== true) {
    return fail('not-confirmed', 'approval needs an explicit confirmation from the user');
  }

  const readiness = approvalReadiness(current);
  if (!readiness.ready) {
    return fail(
      'not-ready',
      `this session is not ready to approve: ${readiness.blockers.map((blocker) => blocker.message).join('; ')}`,
      { blockers: readiness.blockers },
    );
  }

  const decisions = current.decisions.map((decision) => cloneDecision(decision));
  const approved: Session = {
    schemaVersion: current.schemaVersion,
    id: current.id,
    workspace: current.workspace,
    goal: current.goal,
    status: 'approved',
    decisions,
    createdAt: current.createdAt,
    updatedAt: now,
    approvedAt: now,
    approvedSnapshot: canonicalDecisionSnapshot(decisions),
  };

  return finish(approved);
}
