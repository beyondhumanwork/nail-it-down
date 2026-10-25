/**
 * M1 schema v2: a deterministic, dependency-aware interview session.
 *
 * Pure domain code. No host API, no filesystem, no clock reads (callers pass
 * `now`), no model or network access. That is what lets the schema and
 * migration invariants run as ordinary unit tests without Command Code.
 *
 * M0 records (schema v1) remain readable through `readStoredSession`'s
 * legacy path and `previewLegacyMigration`; they are never mutated or
 * overwritten by this module.
 */

import { readStoredRecord } from './record.ts';
import type { ReadResult as V1ReadResult, SessionRecord as LegacySessionRecord } from './record.ts';

export const SESSION_SCHEMA_VERSION = 2 as const;

export type SessionStatus = 'interviewing' | 'review' | 'approved' | 'paused';

export type DecisionStatus =
  | 'open'
  | 'answered'
  | 'assumed'
  | 'deferred'
  | 'needs_review'
  | 'blocked';

export type DecisionPriority = 'critical' | 'important' | 'minor';

export type DecisionAnswerActor = 'user' | 'assumption';

export type DecisionOption = {
  id: string;
  label: string;
  consequence: string;
  /**
   * Marks the option that means "no decision yet". Selecting it records the
   * answer without settling it, so it can never satisfy a prerequisite or an
   * approval. This flag is the deterministic option identity that keeps the
   * rule off answer wording.
   */
  unresolved?: true;
};

export type DecisionAnswer = {
  text: string;
  chosenOptionId?: string;
  actor: DecisionAnswerActor;
};

export type Decision = {
  id: string;
  question: string;
  whyItMatters: string;
  priority: DecisionPriority;
  prerequisites: string[];
  status: DecisionStatus;
  options: DecisionOption[];
  answer?: DecisionAnswer;
  updatedAt: string;
};

export type Session = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  id: string;
  workspace: string;
  goal: string;
  status: SessionStatus;
  decisions: Decision[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedSnapshot?: string;
};

export type SessionReadResult =
  | { kind: 'empty' }
  | { kind: 'unreadable'; reason: string }
  | { kind: 'ok'; session: Session };

const SESSION_STATUSES: readonly SessionStatus[] = ['interviewing', 'review', 'approved', 'paused'];
const DECISION_STATUSES: readonly DecisionStatus[] = [
  'open', 'answered', 'assumed', 'deferred', 'needs_review', 'blocked',
];
const PRIORITIES: readonly DecisionPriority[] = ['critical', 'important', 'minor'];
const ANSWER_ACTORS: readonly DecisionAnswerActor[] = ['user', 'assumption'];

/**
 * Labels that explicitly mean "no decision yet". Only the M0 choice is listed,
 * and it is matched exactly after whitespace normalization: an answer is never
 * reclassified just because it mentions uncertainty in its own words.
 */
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
 * option is judged only by its identity, never by its prose.
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
 * The only decisions that may satisfy a prerequisite or an approval: an answer
 * that was given by the user or explicitly assumed, and that is not a recorded
 * non-decision. `needs_review` is deliberately excluded — it retains an answer
 * but that answer is stale.
 */
export function isSettledDecision(decision: Decision): boolean {
  if (decision.status !== 'answered' && decision.status !== 'assumed') return false;
  if (decision.answer === undefined) return false;
  return !isUnresolvedAnswer(decision.answer, decision.options);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFilledString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function readOption(value: unknown): DecisionOption | 'invalid' {
  if (!isPlainObject(value)) return 'invalid';
  const { id, label, consequence, unresolved } = value;
  if (!isFilledString(id)) return 'invalid';
  if (!isFilledString(label)) return 'invalid';
  if (!isFilledString(consequence)) return 'invalid';
  if (unresolved !== undefined && unresolved !== true) return 'invalid';
  const option: DecisionOption = { id, label, consequence };
  if (unresolved === true) option.unresolved = true;
  return option;
}

function readAnswer(value: unknown): DecisionAnswer | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return 'invalid';
  const { text, chosenOptionId, actor } = value;
  if (!isFilledString(text)) return 'invalid';
  if (chosenOptionId !== undefined && !isFilledString(chosenOptionId)) return 'invalid';
  if (typeof actor !== 'string' || !ANSWER_ACTORS.includes(actor as DecisionAnswerActor)) {
    return 'invalid';
  }
  const answer: DecisionAnswer = { text, actor: actor as DecisionAnswerActor };
  if (chosenOptionId !== undefined) answer.chosenOptionId = chosenOptionId;
  return answer;
}

/** Returns the decision, or a short reason the decision cannot be trusted. */
function readDecision(value: unknown): Decision | string {
  if (!isPlainObject(value)) return 'it is not an object';
  const { id, question, whyItMatters, priority, prerequisites, status, options, answer, updatedAt } = value;

  if (!isFilledString(id)) return 'it has no id';
  if (!isFilledString(question)) return 'it has no question';
  if (!isFilledString(whyItMatters)) return 'it has no reason';
  if (typeof priority !== 'string' || !PRIORITIES.includes(priority as DecisionPriority)) return 'it has an unknown priority';
  if (!Array.isArray(prerequisites) || !prerequisites.every(isFilledString)) return 'its prerequisites are not a list of ids';
  if (typeof status !== 'string' || !DECISION_STATUSES.includes(status as DecisionStatus)) return 'it has an unknown status';
  if (!Array.isArray(options)) return 'its options are not a list';
  const readOptions: DecisionOption[] = [];
  for (const option of options) {
    const parsed = readOption(option);
    if (parsed === 'invalid') return 'one of its options is incomplete';
    readOptions.push(parsed);
  }
  if (!isFilledString(updatedAt)) return 'it has no timestamp';

  const parsedAnswer = readAnswer(answer);
  if (parsedAnswer === 'invalid') return 'its answer is incomplete';

  // An answer that names an option must name one this decision offers, so that
  // "which option did the user pick" always has an answer.
  const chosenOptionId = parsedAnswer?.chosenOptionId;
  if (chosenOptionId !== undefined && !readOptions.some((option) => option.id === chosenOptionId)) {
    return 'its answer names an option that does not exist';
  }
  const answerIsUnresolved = parsedAnswer !== undefined && isUnresolvedAnswer(parsedAnswer, readOptions);

  if (status === 'answered') {
    if (parsedAnswer === undefined) return 'it is answered but carries no answer';
    if (parsedAnswer.actor !== 'user') return 'it is answered by an assumption, not by the user';
    if (answerIsUnresolved) return 'an undecided answer cannot be an answered decision';
  } else if (status === 'assumed') {
    if (parsedAnswer === undefined) return 'it is assumed but carries no assumption';
    if (parsedAnswer.actor !== 'assumption') return 'it is assumed but carries a user answer';
    if (answerIsUnresolved) return 'an undecided answer cannot be an assumed decision';
  } else if (status === 'needs_review') {
    // An upstream edit invalidated this decision but the answer it had is kept,
    // marked stale by the status. It is retained, never settled.
    if (answerIsUnresolved) return 'an undecided answer cannot be retained as a previous answer';
  } else if (parsedAnswer !== undefined) {
    // open, deferred and blocked hold no answer at all.
    return 'a decision that is not answered cannot carry an answer';
  }

  const decision: Decision = {
    id,
    question,
    whyItMatters,
    priority: priority as DecisionPriority,
    prerequisites: [...prerequisites],
    status: status as DecisionStatus,
    options: readOptions,
    updatedAt,
  };
  if (parsedAnswer !== undefined) decision.answer = parsedAnswer;
  return decision;
}

/**
 * Validates a persisted v2 value. Never mutates the input.
 * Unknown extra fields are dropped, so a future schema cannot leak fields
 * into this version's writes.
 */
export function readStoredSession(value: unknown): SessionReadResult {
  if (value === undefined || value === null) return { kind: 'empty' };
  if (!isPlainObject(value)) return { kind: 'unreadable', reason: 'saved data is not an object' };

  const version = value.schemaVersion;
  if (version !== SESSION_SCHEMA_VERSION) {
    const shown = typeof version === 'number' || typeof version === 'string' ? String(version) : 'missing';
    return { kind: 'unreadable', reason: `saved data uses schema version ${shown}, this version expects ${SESSION_SCHEMA_VERSION}` };
  }

  const { id, workspace, goal, status, decisions, createdAt, updatedAt, approvedAt, approvedSnapshot } = value;

  if (!isFilledString(id)) return { kind: 'unreadable', reason: 'session is missing its id' };
  if (!isFilledString(workspace)) return { kind: 'unreadable', reason: 'session is missing its workspace' };
  if (!isFilledString(goal)) return { kind: 'unreadable', reason: 'session goal is empty' };
  if (typeof status !== 'string' || !SESSION_STATUSES.includes(status as SessionStatus)) {
    return { kind: 'unreadable', reason: `session has an unknown status (${String(status)})` };
  }
  if (!Array.isArray(decisions)) return { kind: 'unreadable', reason: 'session decisions are not a list' };
  if (!isFilledString(createdAt) || !isFilledString(updatedAt)) {
    return { kind: 'unreadable', reason: 'session is missing its timestamps' };
  }

  const readDecisions: Decision[] = [];
  const ids = new Set<string>();
  for (const raw of decisions) {
    const parsed = readDecision(raw);
    if (typeof parsed === 'string') return { kind: 'unreadable', reason: `session contains an invalid decision (${parsed})` };
    if (ids.has(parsed.id)) return { kind: 'unreadable', reason: `duplicate decision id (${parsed.id})` };
    ids.add(parsed.id);
    readDecisions.push(parsed);
  }

  // Approval metadata consistency: approvedAt/approvedSnapshot require an approved
  // session; an approved session requires both; neither may appear otherwise.
  const hasApprovedAt = approvedAt !== undefined;
  const hasSnapshot = approvedSnapshot !== undefined;
  if (hasApprovedAt && !isFilledString(approvedAt)) {
    return { kind: 'unreadable', reason: 'approval timestamp is not text' };
  }
  if (hasSnapshot && !isFilledString(approvedSnapshot)) {
    return { kind: 'unreadable', reason: 'approval snapshot is not text' };
  }
  if (hasApprovedAt !== hasSnapshot) {
    return { kind: 'unreadable', reason: 'approval metadata is incomplete' };
  }
  if (status === 'approved') {
    if (!hasApprovedAt || !hasSnapshot) {
      return { kind: 'unreadable', reason: 'approved session is missing approval metadata' };
    }
    // An approval over no decisions approves nothing.
    if (readDecisions.length === 0) {
      return { kind: 'unreadable', reason: 'approved session has no decisions to approve' };
    }
    // Blockers are reported before the snapshot, because a stale snapshot on a
    // genuinely incomplete session is the less actionable of the two faults.
    for (const decision of readDecisions) {
      if (decision.status === 'needs_review') {
        return { kind: 'unreadable', reason: `approved session has a decision requiring review (${decision.id})` };
      }
      if (decision.priority === 'critical' && !isSettledDecision(decision)) {
        return { kind: 'unreadable', reason: `approved session has an unresolved critical decision (${decision.id})` };
      }
    }
    // The snapshot must be the canonical text of exactly these decisions.
    // Anything else is stale, hand-edited or fabricated.
    if (approvedSnapshot !== canonicalDecisionSnapshot(readDecisions)) {
      return { kind: 'unreadable', reason: 'approval snapshot does not match the session decisions' };
    }
  } else {
    if (hasApprovedAt || hasSnapshot) {
      return { kind: 'unreadable', reason: 'approval metadata present on a non-approved session' };
    }
  }

  const session: Session = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id,
    workspace,
    goal,
    status: status as SessionStatus,
    decisions: readDecisions,
    createdAt,
    updatedAt,
  };
  if (hasApprovedAt) session.approvedAt = approvedAt as string;
  if (hasSnapshot) session.approvedSnapshot = approvedSnapshot as string;
  return { kind: 'ok', session };
}

export function createDecision(input: {
  id: string;
  question: string;
  whyItMatters: string;
  priority: DecisionPriority;
  prerequisites?: string[];
  options?: DecisionOption[];
  now: string;
}): Decision {
  return {
    id: input.id,
    question: input.question,
    whyItMatters: input.whyItMatters,
    priority: input.priority,
    prerequisites: [...(input.prerequisites ?? [])],
    status: 'open',
    options: [...(input.options ?? [])],
    updatedAt: input.now,
  };
}

export function createSession(input: {
  id: string;
  workspace: string;
  goal: string;
  decisions: Decision[];
  now: string;
}): Session {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: input.id,
    workspace: input.workspace,
    goal: input.goal,
    status: 'interviewing',
    decisions: input.decisions.map((decision) => ({ ...decision, prerequisites: [...decision.prerequisites], options: [...decision.options] })),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * The canonical text of a decision list: the one representation an approval
 * snapshot may use, both when it is produced and when it is verified.
 *
 * Ordering contract — two deliberately different things:
 * - Decisions are written in the stored array order. The array is NOT sorted by
 *   id, so reordering the decisions produces a different snapshot. Decision
 *   order is part of what a person reviews, so it is part of the snapshot.
 * - Object keys follow the fixed insertion order written below. They are NOT
 *   lexicographically sorted, so a JSON with sorted keys, a pretty-printed
 *   variant with different whitespace, or any extra field is a different
 *   string and fails verification.
 *
 * Absent optional fields (`answer`, `chosenOptionId`, `unresolved`) are left out
 * rather than written as null. No hashing here: this is a plain comparable
 * string. Cryptographic hashing belongs to export (M4).
 */
export function canonicalDecisionSnapshot(decisions: readonly Decision[]): string {
  return JSON.stringify(decisions.map((decision) => ({
    id: decision.id,
    question: decision.question,
    whyItMatters: decision.whyItMatters,
    priority: decision.priority,
    prerequisites: [...decision.prerequisites],
    status: decision.status,
    options: decision.options.map((option) => ({
      id: option.id,
      label: option.label,
      consequence: option.consequence,
      unresolved: option.unresolved,
    })),
    answer: decision.answer
      ? { text: decision.answer.text, chosenOptionId: decision.answer.chosenOptionId, actor: decision.answer.actor }
      : undefined,
    updatedAt: decision.updatedAt,
  })));
}

// ---------------------------------------------------------------------------
// Legacy M0 (schema v1) compatibility — pure, non-destructive preparation.
// ---------------------------------------------------------------------------

export type LegacyMigrationPreview =
  | { kind: 'ready'; legacy: LegacySessionRecord; session: Session; notes: string[] }
  | { kind: 'needs_review'; legacy: LegacySessionRecord; session: Session; reason: string; notes: string[] }
  | { kind: 'unavailable'; legacy?: LegacySessionRecord; reason: string };

/**
 * Builds a non-destructive preview of how an M0 record could become an M1
 * session. The original record is never mutated and is returned alongside the
 * preview so no information is lost.
 *
 * `value` is whatever the host store returned, not a trusted record: this
 * function validates at its own boundary instead of assuming a caller already
 * did. Unreadable input yields `unavailable`; a readable but contradictory
 * record yields `needs_review`.
 *
 * - A real M0 answer becomes an `answered` decision.
 * - "I have not decided" becomes an `open` (unresolved) decision; the original
 *   answer text is preserved in `legacy`.
 * - An unanswered M0 record becomes an `open` decision.
 * - M0's dummy approval is NEVER carried into M1 approval metadata.
 *
 * The produced session is checked against `readStoredSession` before it is
 * returned, so a preview never hands out something v2 would reject.
 *
 * M0 option lists are not stored in v1 records, so migrated decisions have an
 * empty `options` array. This limitation is reported in `notes`.
 */
export function previewLegacyMigration(value: unknown): LegacyMigrationPreview {
  const read = readStoredRecord(value);
  if (read.kind !== 'ok') {
    return {
      kind: 'unavailable',
      reason: read.kind === 'empty'
        ? 'no legacy record is saved for this workspace'
        : `the legacy record cannot be read: ${read.reason}`,
    };
  }

  const legacy = read.record;
  const notes: string[] = [
    'M0 option labels and consequences are not stored in v1 records; migrated decision options are empty.',
    'M0 dummy approval is not carried into M1 approval metadata.',
  ];

  const questionId = legacy.answer?.questionId ?? 'who-uses-this';
  const questionText = legacy.answer?.question ?? 'Who is going to use this?';
  const now = legacy.updatedAt;

  const isUndecided = legacy.answer !== undefined && isUnresolvedAnswerText(legacy.answer.answer);

  const decisionStatus: DecisionStatus = (legacy.status === 'answered' && legacy.answer !== undefined && !isUndecided)
    ? 'answered'
    : 'open';

  const decision: Decision = {
    id: questionId,
    question: questionText,
    whyItMatters: 'Migrated from an M0 record; rationale not stored in v1.',
    priority: 'critical',
    prerequisites: [],
    status: decisionStatus,
    options: [],
    updatedAt: now,
  };
  if (decisionStatus === 'answered' && legacy.answer !== undefined) {
    decision.answer = { text: legacy.answer.answer, actor: 'user' };
  }

  const session: Session = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: `migrated-${legacy.workspace}`,
    workspace: legacy.workspace,
    goal: legacy.goal,
    status: 'interviewing',
    decisions: [decision],
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  };

  // The preview itself must satisfy the contract it feeds.
  const check = readStoredSession(session);
  if (check.kind !== 'ok') {
    const why = check.kind === 'unreadable' ? check.reason : check.kind;
    return { kind: 'unavailable', legacy, reason: `the converted session would not satisfy schema v2 (${why})` };
  }

  const contradictions: string[] = [];
  if (legacy.status === 'awaiting_answer' && legacy.answer !== undefined) {
    contradictions.push('it is marked as awaiting an answer but already carries one');
  }
  if (legacy.approvedAt !== undefined && legacy.answer === undefined) {
    contradictions.push('it carries an approval but no answer to approve');
  }
  if (legacy.approvedAt !== undefined) {
    notes.push('The M0 approval timestamp stays on the legacy record and is not promoted.');
  }

  if (contradictions.length > 0) {
    return {
      kind: 'needs_review',
      legacy,
      session,
      reason: `The legacy record contradicts itself: ${contradictions.join('; ')}. The decision stays unresolved.`,
      notes,
    };
  }

  if (isUndecided) {
    return {
      kind: 'needs_review',
      legacy,
      session,
      reason: `Legacy answer was "${legacy.answer?.answer ?? ''}"; the decision remains unresolved until explicitly settled.`,
      notes,
    };
  }

  return { kind: 'ready', legacy, session, notes };
}

/**
 * Reads a raw legacy (v1) value using the existing M0 validator, without
 * mutating it. Returns the same shape as `readStoredRecord`.
 */
export function readLegacySession(value: unknown): V1ReadResult {
  return readStoredRecord(value);
}