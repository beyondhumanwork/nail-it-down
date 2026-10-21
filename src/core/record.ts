/**
 * The saved record for one workspace, and the only code allowed to change it.
 *
 * Everything here is pure: no host API, no filesystem, no clock reads (callers pass `now`).
 * That is what lets the M0 acceptance checks for schema versioning and corrupt data run as
 * ordinary unit tests without Command Code installed.
 *
 * M0 stores exactly one record per workspace: the most recent goal and its one answer. The full
 * decision graph in docs/PRODUCT_SPEC_DRAFT.md is M1 work and is deliberately not modelled here.
 */

export const SCHEMA_VERSION = 1;

export type SessionStatus = 'awaiting_answer' | 'answered';

export type StoredAnswer = {
  questionId: string;
  question: string;
  answer: string;
  answeredAt: string;
};

export type SessionRecord = {
  schemaVersion: number;
  workspace: string;
  goal: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  answer?: StoredAnswer;
  /** Set only when the person explicitly said yes to the dummy approval dialog. */
  approvedAt?: string;
};

export type ReadResult =
  | { kind: 'empty' }
  | { kind: 'unreadable'; reason: string }
  | { kind: 'ok'; record: SessionRecord };

const STATUSES: readonly SessionStatus[] = ['awaiting_answer', 'answered'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFilledString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function readAnswer(value: unknown): StoredAnswer | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return 'invalid';

  const { questionId, question, answer, answeredAt } = value;
  if (!isFilledString(questionId)) return 'invalid';
  if (!isFilledString(question)) return 'invalid';
  if (!isFilledString(answer)) return 'invalid';
  if (!isFilledString(answeredAt)) return 'invalid';

  return { questionId, question, answer, answeredAt };
}

/**
 * Accepts whatever the host store returned and answers one of three things: nothing saved,
 * something saved that this version cannot trust, or a normalized record.
 *
 * Unknown extra fields are dropped rather than carried forward, so a future schema cannot leak
 * fields into this version's writes.
 */
export function readStoredRecord(value: unknown): ReadResult {
  if (value === undefined || value === null) return { kind: 'empty' };

  if (!isPlainObject(value)) {
    return { kind: 'unreadable', reason: 'saved data is not an object' };
  }

  const version = value.schemaVersion;
  if (version !== SCHEMA_VERSION) {
    const shown = typeof version === 'number' || typeof version === 'string' ? String(version) : 'missing';
    return { kind: 'unreadable', reason: `saved data uses schema version ${shown}, this version expects ${SCHEMA_VERSION}` };
  }

  const { workspace, goal, status, createdAt, updatedAt, approvedAt } = value;
  if (!isFilledString(workspace)) return { kind: 'unreadable', reason: 'saved goal is missing its workspace' };
  if (!isFilledString(goal)) return { kind: 'unreadable', reason: 'saved goal is empty' };
  if (typeof status !== 'string' || !STATUSES.includes(status as SessionStatus)) {
    return { kind: 'unreadable', reason: `saved goal has an unknown status (${String(status)})` };
  }
  if (!isFilledString(createdAt) || !isFilledString(updatedAt)) {
    return { kind: 'unreadable', reason: 'saved goal is missing its timestamps' };
  }
  if (approvedAt !== undefined && !isFilledString(approvedAt)) {
    return { kind: 'unreadable', reason: 'saved approval timestamp is not text' };
  }

  const answer = readAnswer(value.answer);
  if (answer === 'invalid') return { kind: 'unreadable', reason: 'saved answer is incomplete' };
  if (status === 'answered' && answer === undefined) {
    return { kind: 'unreadable', reason: 'saved goal says it was answered but has no answer' };
  }

  const record: SessionRecord = {
    schemaVersion: SCHEMA_VERSION,
    workspace,
    goal,
    status: status as SessionStatus,
    createdAt,
    updatedAt,
  };
  if (answer !== undefined) record.answer = answer;
  if (approvedAt !== undefined) record.approvedAt = approvedAt;

  return { kind: 'ok', record };
}

export function startRecord(input: { workspace: string; goal: string; now: string }): SessionRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    workspace: input.workspace,
    goal: input.goal,
    status: 'awaiting_answer',
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Records a real, confirmed selection. Nothing else may mark a question answered. */
export function withAnswer(
  record: SessionRecord,
  answer: Omit<StoredAnswer, 'answeredAt'> & { answeredAt: string },
  now: string,
): SessionRecord {
  return {
    ...record,
    status: 'answered',
    updatedAt: now,
    answer: {
      questionId: answer.questionId,
      question: answer.question,
      answer: answer.answer,
      answeredAt: answer.answeredAt,
    },
  };
}

/** Records explicit approval. The only caller passes a dialog result that was literally true. */
export function withApproval(record: SessionRecord, now: string): SessionRecord {
  return { ...record, updatedAt: now, approvedAt: now };
}
