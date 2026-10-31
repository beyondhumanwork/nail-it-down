/**
 * Every string the mod shows. Fixed copy on purpose: no model writes these, so
 * the wording can be reviewed here in one place.
 *
 * House style, taken from the public README: plain second person, no jargon, no
 * exclamation marks, and never a claim stronger than what actually happened. In
 * particular no message says a write succeeded until the host has confirmed it.
 */

import type { Session } from './session.ts';
import type { ApprovalReadiness } from './transitions.ts';
import type { Decision } from './session.ts';
import { isSettledDecision } from './graph.ts';
import { optionLabelForId } from './interview.ts';

export const APPROVAL = {
  title: 'Approve these decisions? Nothing will be built from them.',
  /** The host pre-highlights the first option, so the safe answer is listed first. */
  denyLabel: 'No, do not approve',
  approveLabel: 'Yes, approve',
  options: [
    {
      label: 'No, do not approve',
      description: 'Nothing is approved. This is the safe answer.',
    },
    {
      label: 'Yes, approve',
      description: 'Records your approval. No plan, no code, no files changed.',
    },
  ],
} as const;

/** Extra dialog choices that are actions rather than answers. */
export const ACTIONS = {
  deferLabel: 'Decide this later',
  deferDescription: 'Parks this question. It stays unresolved until you come back to it.',
  reviseLabel: 'Revise an earlier answer',
  reconsiderLabel: 'Reconsider a deferred question',
  approveLabel: 'Review and approve',
  pauseLabel: 'Pause this interview',
  doneLabel: 'Nothing for now',
  migrateLabel: 'Migrate the saved M0 record',
  freshLabel: 'Start a fresh interview',
  replaceLabel: 'Replace the saved goal',
  keepLabel: 'Keep what is saved',
} as const;

export const TITLES = {
  action: 'What next?',
  chooseDecision: 'Which decision do you want to change?',
  migrate: 'This workspace has an M0 record. What should happen to it?',
  replace: 'This workspace already has an interview. Replace it?',
  startOverUnreadable: 'This workspace has an M0 record that cannot be migrated. Start over anyway?',
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
    '/naildown <your idea>   start an interview for this goal',
    '/naildown resume        continue: answer, revise, defer, or approve',
    '/naildown status        what is actually saved for this workspace',
    '/naildown context       optional repository context (experimental, off by default)',
    '',
    'Three questions, and the later ones wait for the first. It does not read your files, call a model, or change anything.',
    'The context command is the only one that can read files, and only after three separate permissions.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function decisionLine(decision: Decision): string {
  const label = optionLabelForId(decision, decision.answer?.chosenOptionId);
  const text = label ?? decision.answer?.text;
  const marker = decision.status === 'answered' ? 'answered'
    : decision.status === 'needs_review' ? 'needs review'
      : decision.status === 'deferred' ? 'deferred'
        : decision.status === 'assumed' ? 'assumed (not confirmed)'
          : 'open';
  const shown = text !== undefined ? ` — ${text}` : '';
  return `  [${marker}] ${decision.question}${shown}`;
}

export function statusReport(session: Session, readiness: ApprovalReadiness): string {
  const lines = [
    `Workspace: ${session.workspace}`,
    `Goal: ${session.goal}`,
    `State: ${describeSessionStatus(session.status)}`,
    '',
    'Decisions:',
    ...session.decisions.map(decisionLine),
  ];

  const settled = session.decisions.filter(isSettledDecision).length;
  lines.push('', `Settled: ${settled} of ${session.decisions.length}`);

  if (session.approvedAt !== undefined) {
    lines.push(`Approval: approved ${formatTimestamp(session.approvedAt)}`);
  } else {
    lines.push('Approval: not approved');
  }

  if (!readiness.ready) {
    lines.push('', 'Before this can be approved:');
    for (const blocker of readiness.blockers) lines.push(`  - ${blocker.message}`);
  } else {
    lines.push('', 'Every critical decision is settled, so this is ready to approve.');
  }

  lines.push(`Last saved: ${formatTimestamp(session.updatedAt)}`);
  lines.push('', 'Next: /naildown resume');
  return lines.join('\n');
}

function describeSessionStatus(status: Session['status']): string {
  if (status === 'paused') return 'paused — resume before changing anything';
  if (status === 'approved') return 'approved';
  return 'in progress';
}

export function nothingSavedYet(workspace: string): string {
  return [
    `Nothing is saved for this workspace yet (${workspace}).`,
    'Start with: /naildown <your idea>',
  ].join('\n');
}

export function unreadableData(reason: string, workspace: string): string {
  return [
    `Saved data for this workspace cannot be read by this version: ${reason}`,
    `Workspace: ${workspace}`,
    'I left it exactly as it was. Run /naildown <your idea> if you want to replace it.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Interview progress
// ---------------------------------------------------------------------------

export function questionDismissed(session: Session): string {
  return [
    'No answer was recorded, so nothing changed.',
    `Goal: ${session.goal}`,
    'Run /naildown resume to pick this up again.',
  ].join('\n');
}

export function noDialogsHere(session: Session): string {
  return [
    'This session cannot show questions, so no answer was recorded and nothing was approved.',
    `Goal: ${session.goal}`,
    'Run /naildown resume in the interactive Command Code TUI.',
  ].join('\n');
}

export function answered(session: Session, decision: Decision): string {
  const label = optionLabelForId(decision, decision.answer?.chosenOptionId)
    ?? decision.answer?.text
    ?? 'none';
  const lines = [`Recorded: ${decision.question} — ${label}`, ''];

  const stale = session.decisions.filter((candidate) => candidate.status === 'needs_review');
  if (stale.length > 0) {
    lines.push('These now need review, because they were decided on the old answer:');
    for (const candidate of stale) lines.push(`  - ${candidate.question}`);
    lines.push('');
  }

  lines.push('Next: /naildown resume');
  return lines.join('\n');
}

export function deferred(session: Session, decision: Decision): string {
  return [
    `Parked: ${decision.question}`,
    'It stays unresolved, and anything that depends on it waits too.',
    '',
    `Goal: ${session.goal}`,
    'Next: /naildown resume',
  ].join('\n');
}

export function reconsidered(session: Session, decision: Decision): string {
  return [
    `Back on the list: ${decision.question}`,
    '',
    `Goal: ${session.goal}`,
    'Next: /naildown resume',
  ].join('\n');
}

export function paused(session: Session): string {
  return [
    'Paused. Nothing else will change until you resume.',
    `Goal: ${session.goal}`,
    'Next: /naildown resume',
  ].join('\n');
}

export function resumedFromPause(session: Session): string {
  return [
    'Resumed.',
    `Goal: ${session.goal}`,
    'Nothing was reopened or approved while it was paused.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export function approved(session: Session): string {
  return [
    'Approved, and saved with a record of exactly which decisions were reviewed.',
    `Goal: ${session.goal}`,
    '',
    'No plan was produced and no files changed.',
    'Next: /naildown status',
  ].join('\n');
}

export function notApproved(blockers: string[]): string {
  return [
    'Not approved. These still stand in the way:',
    ...blockers.map((blocker) => `  - ${blocker}`),
    '',
    'Nothing was approved. Next: /naildown resume',
  ].join('\n');
}

export function approvalDeclined(session: Session): string {
  return [
    'Not approved: you chose not to approve.',
    `Goal: ${session.goal}`,
    'Nothing was approved. Next: /naildown status',
  ].join('\n');
}

export function approvalDismissed(session: Session): string {
  return [
    'Not approved: the approval question was dismissed.',
    `Goal: ${session.goal}`,
    'Nothing was approved. Next: /naildown status',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Persistence and migration
// ---------------------------------------------------------------------------

export function notSaved(what: string, reason: string): string {
  return [
    `I could not save ${what} to disk: ${reason}`,
    'What was saved before is still there, but this message cannot tell you what it contains.',
    'Run /naildown status to see the state that is actually stored.',
  ].join('\n');
}

/**
 * Used when the write failed *and* restoring the previous value also failed. The
 * only honest message at that point says the saved state is unknown.
 */
export function persistenceUncertain(what: string, reason: string): string {
  return [
    `I could not save ${what} to disk: ${reason}`,
    'I also could not restore what was there before, so the stored state is now uncertain.',
    'Run /naildown status before trusting what it shows. This message cannot tell you whether anything is approved.',
  ].join('\n');
}

export function migrationOffered(goal: string, note: string): string {
  return [
    'This workspace has an M0 record and no interview yet.',
    `M0 goal: ${goal}`,
    note,
    '',
    'Nothing has been changed. Run /naildown <your idea> to choose whether to migrate it or start fresh.',
  ].join('\n');
}

export function legacyUnreadable(reason: string): string {
  return [
    `The M0 record for this workspace cannot be read: ${reason}`,
    'I left it exactly as it was. Nothing was migrated and nothing is approved.',
  ].join('\n');
}

export function migrationNotAvailable(reason: string): string {
  return [
    `That M0 record cannot be migrated: ${reason}`,
    'I left it exactly as it was. Nothing was migrated and nothing is approved.',
    'You can still start a fresh interview with /naildown <your idea>.',
  ].join('\n');
}

export function migratedFromM0(session: Session, stillUnresolved: boolean): string {
  const lines = [
    'Migrated the M0 record into an interview. The original M0 record is still saved and untouched.',
    `Goal: ${session.goal}`,
  ];
  if (stillUnresolved) {
    lines.push('The M0 answer recorded no decision, so it stays unresolved.');
  }
  lines.push('', 'The M0 approval was a test and was not carried over, so nothing is approved.');
  return lines.join('\n');
}

export function legacyUnreadableOnResume(reason: string): string {
  return [
    `The M0 record for this workspace cannot be made into an interview: ${reason}`,
    'I left it exactly as it was.',
    'To start a new interview, run /naildown <your idea>.',
  ].join('\n');
}

export function startAbandoned(): string {
  return [
    'Left everything as it was.',
    'Next: /naildown status',
  ].join('\n');
}
