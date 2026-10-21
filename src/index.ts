import type { ModApi, ModUi } from './host/modApi.ts';
import { parseIntent } from './core/commands.ts';
import { APPROVAL, QUESTION } from './core/copy.ts';
import * as copy from './core/copy.ts';
import { readRecord, removeRecord, writeRecord } from './core/persistence.ts';
import type { KeyValueStore } from './core/persistence.ts';
import { startRecord, withAnswer, withApproval } from './core/record.ts';
import type { ReadResult, SessionRecord } from './core/record.ts';
import { workspaceKeyFrom } from './core/workspace.ts';

/**
 * Nail It Down, M0 host-feasibility spike.
 *
 * What this proves, and nothing more: Command Code can load a TypeScript mod, register
 * `/naildown`, ask one native question, save the confirmed answer through `cmd.store`, and find
 * that answer again after the process restarts — with separate state per workspace.
 *
 * Deliberately absent: model calls, workspace reads, process execution, file writes, network
 * requests, background timers. `src/host/modApi.ts` omits `exec` from the command context so a
 * stray call cannot compile.
 */

type Deps = {
  store: KeyValueStore;
  ui: ModUi;
  workspace: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export default function nailItDown(cmd: ModApi): void {
  const store: KeyValueStore = {
    get: (key) => cmd.store.get(key),
    set: (key, value) => cmd.store.set(key, value),
    delete: (key) => cmd.store.delete(key),
  };

  cmd.addCommand({
    name: 'naildown',
    description: 'Settle what you are building before anything gets built',
    argumentHint: '<your idea> | status | resume',
    handler: async ({ args, ui, cwd }) => ({
      message: await run({ store, ui, workspace: workspaceKeyFrom(cwd) }, args),
    }),
  });
}

async function run(deps: Deps, args: string): Promise<string> {
  const intent = parseIntent(args);

  try {
    switch (intent.kind) {
      case 'help':
        return copy.usage();
      case 'status':
        return describeStatus(deps);
      case 'resume':
        return resume(deps);
      case 'start':
        return startGoal(deps, intent.goal);
    }
  } catch (error) {
    return [
      `That failed before it finished: ${copy.reasonText(error)}`,
      'Nothing was approved. Run /naildown status to see what is actually saved.',
    ].join('\n');
  }
}

function describeStatus(deps: Deps): string {
  const saved = readRecord(deps.store, deps.workspace);
  return describeReadResult(saved, deps.workspace);
}

function describeReadResult(saved: ReadResult, workspace: string): string {
  if (saved.kind === 'empty') return copy.nothingSavedYet(workspace);
  if (saved.kind === 'unreadable') return copy.unreadableData(saved.reason, workspace);
  return copy.statusReport(saved.record);
}

async function resume(deps: Deps): Promise<string> {
  const saved = readRecord(deps.store, deps.workspace);
  if (saved.kind !== 'ok') return describeReadResult(saved, deps.workspace);

  if (saved.record.status === 'answered') return copy.resumeAlreadyAnswered(saved.record);
  return askAndSave(deps, saved.record);
}

async function startGoal(deps: Deps, goal: string): Promise<string> {
  const record = startRecord({ workspace: deps.workspace, goal, now: nowIso() });
  const previous = readRecord(deps.store, deps.workspace);
  const previousRecord = previous.kind === 'ok' ? previous.record : undefined;

  try {
    await save(deps, record, previousRecord);
  } catch (error) {
    return copy.goalNotSaved(copy.reasonText(error));
  }

  return askAndSave(deps, record);
}

/**
 * The one interactive step. Every exit path is covered explicitly: a dismissed dialog, a host
 * that cannot show dialogs, a rejected write, a declined approval. Only the approval label coming
 * back from the approval dialog is allowed to write `approvedAt`.
 */
async function askAndSave(deps: Deps, record: SessionRecord): Promise<string> {
  const picked = await deps.ui.select({
    title: QUESTION.title,
    options: QUESTION.options.map((option) => ({ label: option.label, description: option.description })),
  });

  const answer = typeof picked === 'string' ? picked.trim() : '';
  if (answer === '') {
    const canShowDialogs = deps.ui.capabilities?.surface !== false;
    return canShowDialogs ? copy.answerCancelled(record.goal) : copy.noDialogsHere(record.goal);
  }

  const answeredAt = nowIso();
  const answered = withAnswer(record, {
    questionId: QUESTION.id,
    question: QUESTION.title,
    answer,
    answeredAt,
  }, answeredAt);

  try {
    await save(deps, answered, record);
  } catch (error) {
    return copy.answerNotSaved(copy.reasonText(error), record.goal);
  }

  const outcome = await askForApproval(deps);
  if (outcome !== 'approved') return copy.answeredNotApproved(answered, outcome);

  const approved = withApproval(answered, nowIso());
  try {
    await save(deps, approved, answered);
  } catch (error) {
    return copy.approvalNotSaved(copy.reasonText(error), answered);
  }

  return copy.answeredApproved(approved);
}

/**
 * Writes a record, and on failure puts the host's in-memory store back the way it was.
 *
 * Command Code 1.84.0 updates its in-memory store *before* it writes the file, so after a rejected
 * `set` the new value is still visible to `store.get` even though nothing reached disk. Without the
 * rollback, `/naildown status` in the same session would report data that was never saved — the
 * same false claim the failure message refuses to make. Restoring the last good record (or removing
 * the key when there was none) keeps status and disk telling the same story. The rollback write is
 * best effort: if the store cannot be written at all, there is nothing further to do, and the
 * original error is what the caller reports.
 */
async function save(deps: Deps, record: SessionRecord, previous: SessionRecord | undefined): Promise<void> {
  try {
    await writeRecord(deps.store, record);
  } catch (error) {
    try {
      if (previous) await writeRecord(deps.store, previous);
      else await removeRecord(deps.store, record.workspace);
    } catch {
      // The store is unwritable; the in-memory value is already the best we can restore.
    }
    throw error;
  }
}

/**
 * Default deny, enforced where it actually holds.
 *
 * `cmd.ui.confirm` cannot express a default: the host hard-codes `[Yes, No]` and pre-highlights the
 * first option, so pressing Enter would approve (observed in Command Code 1.84.0, recorded in
 * docs/M0_EVIDENCE.md). A `select` with the refusal first gets the host's own pre-highlight to land
 * on "no", and only the literal approval label counts as approval. A dismissed dialog resolves
 * `undefined`, which is not approval.
 */
async function askForApproval(deps: Deps): Promise<'approved' | 'declined' | 'dismissed'> {
  const picked = await deps.ui.select({
    title: APPROVAL.title,
    options: APPROVAL.options.map((option) => ({ label: option.label, description: option.description })),
  });

  if (picked === APPROVAL.approveLabel) return 'approved';
  if (picked === APPROVAL.denyLabel) return 'declined';
  return 'dismissed';
}
