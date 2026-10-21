/**
 * Every string the mod shows. M0 uses fixed copy on purpose: no model writes these, so the
 * wording can be reviewed here in one place.
 *
 * House style, taken from the public README: plain second person, no jargon, no exclamation
 * marks, and never a claim stronger than what actually happened.
 */

import type { SessionRecord } from './record.ts';

export const QUESTION = {
  id: 'who-uses-this',
  title: 'Who is going to use this?',
  options: [
    {
      label: 'Just me',
      description: 'You can change your mind without asking anyone.',
    },
    {
      label: 'One team',
      description: 'A few people rely on it, so someone else has to agree before it changes.',
    },
    {
      label: 'Many teams or customers',
      description: 'People will plan around it, so getting it wrong later costs more to undo.',
    },
    {
      label: 'I have not decided',
      description: 'That is a real answer, and it is the first thing worth settling.',
    },
  ],
} as const;

export const APPROVAL = {
  title: 'Approve this? Nothing will be built from it.',
  /** The host highlights the first option, so the safe answer is listed first. */
  denyLabel: 'No, do not approve',
  approveLabel: 'Yes, approve',
  options: [
    {
      label: 'No, do not approve',
      description: 'Nothing is approved. This is the safe answer.',
    },
    {
      label: 'Yes, approve',
      description: 'Records a test approval and nothing else. No plan, no code.',
    },
  ],
} as const;

const MAX_REASON_LENGTH = 200;

export function reasonText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return 'the host did not say why';
  return trimmed.length > MAX_REASON_LENGTH ? `${trimmed.slice(0, MAX_REASON_LENGTH)}…` : trimmed;
}

export function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function usage(): string {
  return [
    'Settle the decisions before you build.',
    '',
    '/naildown <your idea>   start, and answer one question',
    '/naildown status        what is saved for this workspace',
    '/naildown resume        answer the question again',
    '',
    'M0 spike: one fixed question and one saved answer. It does not read your files, call a model, or change anything.',
  ].join('\n');
}

export function goalNotSaved(reason: string): string {
  return [
    `I could not save your goal to disk: ${reason}`,
    'Nothing is approved, and restarting Command Code would lose it.',
  ].join('\n');
}

export function answerCancelled(goal: string): string {
  return [
    'No answer was recorded, so nothing is approved.',
    `Goal saved: ${goal}`,
    'Run /naildown resume when you want to answer.',
  ].join('\n');
}

export function noDialogsHere(goal: string): string {
  return [
    'This session cannot show questions, so no answer was recorded and nothing is approved.',
    `Goal saved: ${goal}`,
    'Run /naildown resume in the interactive Command Code TUI.',
  ].join('\n');
}

export function answerNotSaved(reason: string, goal: string): string {
  return [
    `I could not save your answer to disk: ${reason}`,
    'Nothing is approved.',
    `Goal saved: ${goal}. The question stays unanswered.`,
  ].join('\n');
}

export function answeredNotApproved(record: SessionRecord, outcome: 'declined' | 'dismissed'): string {
  const reason =
    outcome === 'declined'
      ? 'Not approved: you chose not to approve.'
      : 'Not approved: the approval question was dismissed.';

  return [
    `Goal saved: ${record.goal}`,
    `Answer recorded: ${record.answer?.answer ?? 'none'}`,
    reason,
    '',
    'No plan was produced and no files changed. Next: /naildown status',
  ].join('\n');
}

export function answeredApproved(record: SessionRecord): string {
  return [
    `Goal saved: ${record.goal}`,
    `Answer recorded: ${record.answer?.answer ?? 'none'}`,
    'Marked approved, as a test. No plan was produced and no files changed.',
    '',
    'Next: /naildown status',
  ].join('\n');
}

export function approvalNotSaved(reason: string, record: SessionRecord): string {
  return [
    `The answer is saved, but the approval could not be written to disk: ${reason}`,
    `Answer recorded: ${record.answer?.answer ?? 'none'}`,
    'So nothing is approved.',
  ].join('\n');
}

export function nothingSavedYet(workspace: string): string {
  return [`Nothing is saved for this workspace yet (${workspace}).`, 'Start with: /naildown <your idea>'].join(
    '\n',
  );
}

export function unreadableData(reason: string, workspace: string): string {
  return [
    `Saved data for this workspace cannot be read by this version: ${reason}`,
    `Workspace: ${workspace}`,
    'I left it untouched. Starting a new goal will replace it.',
  ].join('\n');
}

export function statusReport(record: SessionRecord): string {
  const lines = [
    `Workspace: ${record.workspace}`,
    `Goal: ${record.goal}`,
    `Question: ${record.answer?.question ?? QUESTION.title}`,
    `Answer: ${record.answer?.answer ?? 'none yet'}`,
    `Approval: ${record.approvedAt ? `approved ${formatTimestamp(record.approvedAt)} (test only)` : 'not approved'}`,
    `Last saved: ${formatTimestamp(record.updatedAt)}`,
  ];

  if (record.status !== 'answered') {
    lines.push('', 'Next: /naildown resume');
  }

  return lines.join('\n');
}

export function resumeAlreadyAnswered(record: SessionRecord): string {
  return ['This goal already has an answer.', '', statusReport(record)].join('\n');
}
