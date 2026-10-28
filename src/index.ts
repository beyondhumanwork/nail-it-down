import type { ModApi, ModUi } from './host/modApi.ts';
import { parseIntent } from './core/commands.ts';
import { ACTIONS, APPROVAL, TITLES } from './core/copy.ts';
import * as copy from './core/copy.ts';
import {
  readSession,
  removeSession,
  sessionKeyFor,
  writeSession,
} from './core/persistence.ts';
import type { KeyValueStore } from './core/persistence.ts';
import { readLegacySession, previewLegacyMigration } from './core/session.ts';
import type { LegacyMigrationPreview, Session } from './core/session.ts';
import { frontier, isSettledDecision, unsettledPrerequisites } from './core/graph.ts';
import type { Decision } from './core/session.ts';
import {
  answerDecision,
  approvalReadiness,
  approveSession,
  deferDecision,
  pauseSession,
  reconsiderDeferred,
  resumeSession,
} from './core/transitions.ts';
import type { ApprovalBlocker } from './core/transitions.ts';
import {
  createInterviewSession,
  interviewSpec,
  isDeferable,
  optionIdForLabel,
} from './core/interview.ts';
import { workspaceKeyFrom } from './core/workspace.ts';

/**
 * Nail It Down, M1 host adapter.
 *
 * This file is deliberately thin: it owns dialogs, storage sequencing and
 * message selection, and nothing else. Every rule about what counts as settled,
 * what becomes stale, what is eligible next and what may be approved lives in
 * `src/core`. If a rule ever needs restating here, that is a bug — the core
 * already has one, and this module would be the second copy.
 *
 * What it still does not do: model calls, workspace reads, process execution,
 * file writes, network requests, background timers. `src/host/modApi.ts` omits
 * `exec` from the command context so a stray call cannot compile.
 */

type Deps = {
  store: KeyValueStore;
  ui: ModUi;
  workspace: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Session ids include a counter because two sessions created in the same
 * millisecond would otherwise share one. Two workspaces started back to back is
 * a realistic case (and the one the isolation test caught).
 */
let sessionCounter = 0;

function nextSessionId(prefix: string): string {
  sessionCounter += 1;
  return `${prefix}-${nowIso()}-${sessionCounter}`;
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
    argumentHint: '<your idea> | status | resume | help',
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
        return showStatus(deps);
      case 'resume':
        return resumeInterview(deps);
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

// ---------------------------------------------------------------------------
// Reading what is stored
// ---------------------------------------------------------------------------

type Loaded =
  | { kind: 'session'; session: Session }
  | { kind: 'legacy'; preview: LegacyMigrationPreview }
  | { kind: 'legacy-unreadable'; reason: string }
  | { kind: 'corrupt'; reason: string }
  | { kind: 'empty' };

/**
 * v2 first, then the M0 record. A corrupt v2 session is reported rather than
 * replaced, and it does not fall through to the legacy record: two damaged
 * inputs are not a reason to pick one and start writing.
 */
function load(deps: Deps): Loaded {
  const session = readSession(deps.store, deps.workspace);
  if (session.kind === 'ok') return { kind: 'session', session: session.session };
  if (session.kind === 'unreadable') return { kind: 'corrupt', reason: session.reason };

  const legacy = readLegacySession(deps.store.get(`session.v1:${deps.workspace}`));
  if (legacy.kind === 'unreadable') return { kind: 'legacy-unreadable', reason: legacy.reason };
  if (legacy.kind === 'empty') return { kind: 'empty' };

  return { kind: 'legacy', preview: previewLegacyMigration(legacy.record) };
}

function showStatus(deps: Deps): string {
  const loaded = load(deps);
  switch (loaded.kind) {
    case 'empty':
      return copy.nothingSavedYet(deps.workspace);
    case 'corrupt':
      return copy.unreadableData(loaded.reason, deps.workspace);
    case 'legacy-unreadable':
      return copy.legacyUnreadable(loaded.reason);
    case 'legacy':
      return describeLegacy(loaded.preview);
    case 'session':
      return copy.statusReport(loaded.session, approvalReadiness(loaded.session));
  }
}

function describeLegacy(preview: LegacyMigrationPreview): string {
  if (preview.kind === 'unavailable') return copy.migrationNotAvailable(preview.reason);
  const note = preview.kind === 'needs_review'
    ? `The saved M0 answer was not a decision: ${preview.reason}`
    : 'Its answer can be carried into the first question as a real decision.';
  return copy.migrationOffered(preview.legacy.goal, note);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Writes are serialized within this process. Command Code's `store.set` is a
 * read-modify-write of one JSON file per mod, so two overlapping commands could
 * otherwise interleave and lose one of the two records.
 *
 * This is not a cross-process guarantee, and nothing here claims one: two
 * Command Code processes on the same workspace can still race.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeChain.then(operation, operation);
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

type SaveOutcome =
  | { ok: true }
  | { ok: false; reason: string; rollbackFailed: boolean };

/**
 * Writes a session, and on failure puts the host's in-memory store back the way
 * it was.
 *
 * Command Code updates its in-memory store *before* it writes the file, so after
 * a rejected `set` the new value is still visible to `store.get` even though
 * nothing reached disk. Without the rollback, `/naildown status` in the same
 * session would report data that was never saved. When the rollback itself
 * fails, the caller is told the saved state is uncertain rather than being told
 * anything reassuring.
 */
/**
 * The value currently stored for this workspace, exactly as it was written.
 *
 * Raw rather than parsed on purpose: rolling back must restore the bytes that
 * were there, including a record this version cannot read. Restoring a
 * re-serialised session would quietly drop fields a future version stored.
 */
type RawEntry = { present: boolean; value: unknown };

function rawSession(deps: Deps): RawEntry {
  const value = deps.store.get(sessionKeyFor(deps.workspace));
  return { present: value !== undefined, value };
}

/**
 * Writes a session, and on failure restores exactly what was stored before.
 *
 * Command Code updates its in-memory store *before* it writes the file, so after
 * a rejected `set` the new value is still visible to `store.get`. The previous
 * value is therefore read inside the serialized section, before the write, so
 * the rollback target is the real prior state and not the failed attempt.
 *
 * The previous value is restored verbatim. An absent key stays absent, a valid
 * session comes back as itself, and an unreadable record the person chose to
 * replace is not deleted when the replacement fails.
 */
async function save(deps: Deps, next: Session): Promise<SaveOutcome> {
  return serializeWrite(async () => {
    const previous = rawSession(deps);
    try {
      await writeSession(deps.store, next);
      return { ok: true };
    } catch (error) {
      const reason = copy.reasonText(error);
      try {
        if (previous.present) await deps.store.set(sessionKeyFor(next.workspace), previous.value);
        else await removeSession(deps.store, next.workspace);
        return { ok: false, reason, rollbackFailed: false };
      } catch {
        return { ok: false, reason, rollbackFailed: true };
      }
    }
  });
}

function saveFailure(what: string, outcome: SaveOutcome): string {
  if (outcome.ok) return '';
  return outcome.rollbackFailed
    ? copy.persistenceUncertain(what, outcome.reason)
    : copy.notSaved(what, outcome.reason);
}

// ---------------------------------------------------------------------------
// Starting and resuming
// ---------------------------------------------------------------------------

async function startGoal(deps: Deps, goal: string): Promise<string> {
  const loaded = load(deps);

  if (loaded.kind === 'corrupt') {
    // Explicit choice only: an unreadable record is never replaced on its own.
    const replace = await askReplace(deps, 'corrupt');
    if (!replace) return copy.unreadableData(loaded.reason, deps.workspace);
  } else if (loaded.kind === 'session') {
    const replace = await askReplace(deps, 'session');
    if (!replace) return copy.statusReport(loaded.session, approvalReadiness(loaded.session));
  } else if (loaded.kind === 'legacy' || loaded.kind === 'legacy-unreadable') {
    const outcome = await handleLegacy(deps, loaded, goal);
    if (outcome.kind === 'handled') return outcome.message;
  }

  return startFresh(deps, goal);
}

/** Creates and saves a new interview, then drives it. */
async function startFresh(deps: Deps, goal: string): Promise<string> {
  const session = createInterviewSession({
    id: nextSessionId('interview'),
    workspace: deps.workspace,
    goal,
    now: nowIso(),
  });

  const outcome = await save(deps, session);
  if (!outcome.ok) return saveFailure('the goal', outcome);

  return runInterview(deps, session);
}

/** Explicit confirmation before overwriting anything already saved. */
async function askReplace(deps: Deps, existing: 'session' | 'corrupt'): Promise<boolean> {
  const picked = await deps.ui.select({
    title: existing === 'corrupt'
      ? 'The saved data for this workspace cannot be read. Replace it?'
      : TITLES.replace,
    options: [
      { label: ACTIONS.keepLabel, description: 'Nothing changes. This is the safe answer.' },
      { label: ACTIONS.replaceLabel, description: 'Overwrites the saved record for this workspace.' },
    ],
  });
  return picked === ACTIONS.replaceLabel;
}

/**
 * What the legacy path decided. Explicit rather than "undefined means start
 * fresh", because that ambiguity turned a dismissed dialog into permission to
 * write a new session over a record the person had not agreed to touch.
 */
type LegacyOutcome =
  | { kind: 'start-fresh' }
  | { kind: 'handled'; message: string };

/**
 * The M0 record, handled honestly.
 *
 * Only the exact `fresh` label starts a new interview. Dismissal, `undefined`,
 * an unexpected label, a headless host or an unavailable dialog all cancel with
 * nothing written. When the record cannot be read at all, the same safe choice
 * is offered so an unreadable M0 record cannot permanently block starting over.
 *
 * Nothing is written here; the caller saves.
 */
async function handleLegacy(
  deps: Deps,
  loaded: Extract<Loaded, { kind: 'legacy' | 'legacy-unreadable' }>,
  goal: string,
): Promise<LegacyOutcome> {
  if (loaded.kind === 'legacy-unreadable') {
    return offerStartOverUnreadable(deps, copy.legacyUnreadable(loaded.reason));
  }

  const preview = loaded.preview;
  if (preview.kind === 'unavailable') {
    return offerStartOverUnreadable(deps, copy.migrationNotAvailable(preview.reason));
  }

  const picked = await deps.ui.select({
    title: TITLES.migrate,
    options: [
      { label: ACTIONS.migrateLabel, description: 'Keeps the M0 goal and carries its answer into the first question.' },
      { label: ACTIONS.freshLabel, description: `Starts a new interview for: ${goal}` },
    ],
  });

  if (picked === ACTIONS.freshLabel) return { kind: 'start-fresh' };
  if (picked !== ACTIONS.migrateLabel) {
    // Dismissed, headless, or an unexpected label: leave everything alone.
    return { kind: 'handled', message: copy.startAbandoned() };
  }

  const migrated = migrateFromPreview(preview, deps.workspace);
  const outcome = await save(deps, migrated.session);
  if (!outcome.ok) return { kind: 'handled', message: saveFailure('the migrated interview', outcome) };

  const notice = copy.migratedFromM0(migrated.session, migrated.stillUnresolved);
  const continued = await runInterview(deps, migrated.session);
  return { kind: 'handled', message: `${notice}\n\n${continued}` };
}

/**
 * A record this version cannot migrate is not a dead end. The safe answer is
 * listed first and does nothing; starting over requires the exact label, and the
 * M0 record is left byte-identical either way.
 */
async function offerStartOverUnreadable(deps: Deps, note: string): Promise<LegacyOutcome> {
  const picked = await deps.ui.select({
    title: TITLES.startOverUnreadable,
    options: [
      { label: ACTIONS.keepLabel, description: 'Nothing changes. This is the safe answer.' },
      {
        label: ACTIONS.freshLabel,
        description: 'Starts a new interview. The M0 record is left exactly as it is.',
      },
    ],
  });

  if (picked === ACTIONS.freshLabel) return { kind: 'start-fresh' };
  return { kind: 'handled', message: `${note}\n\n${copy.startAbandoned()}` };
}

/**
 * Carries the M0 answer into the built-in graph instead of adopting the preview
 * session wholesale.
 *
 * The preview session contains one decision with no options, because v1 never
 * stored them. Adopting it would leave an interview with a single question and
 * no way to answer it again. Building the real three-question graph and copying
 * the answer into its root keeps the graph intact and preserves what the person
 * actually said. The M0 approval is never consulted, so a dummy approval cannot
 * become M1 approval.
 */
function migrateFromPreview(
  preview: Exclude<LegacyMigrationPreview, { kind: 'unavailable' }>,
  workspace: string,
): { session: Session; stillUnresolved: boolean } {
  const now = nowIso();
  const base = createInterviewSession({
    id: nextSessionId('migrated'),
    workspace,
    goal: preview.legacy.goal,
    now,
  });

  const carried = preview.session.decisions[0];
  const answer = carried?.answer;
  if (answer === undefined) {
    // The preview decided the M0 answer recorded no decision; the root stays open.
    return { session: base, stillUnresolved: true };
  }

  const spec = interviewSpec('who-uses-this');
  const chosenOptionId = spec === undefined ? undefined : optionIdForLabel(spec, answer.text);
  const result = answerDecision(
    base,
    'who-uses-this',
    chosenOptionId === undefined
      ? { text: answer.text }
      : { text: answer.text, chosenOptionId },
    now,
  );

  if (!result.ok) return { session: base, stillUnresolved: true };
  return { session: result.session, stillUnresolved: false };
}

async function resumeInterview(deps: Deps): Promise<string> {
  const loaded = load(deps);

  switch (loaded.kind) {
    case 'empty':
      return copy.nothingSavedYet(deps.workspace);
    case 'corrupt':
      return copy.unreadableData(loaded.reason, deps.workspace);
    case 'legacy-unreadable':
      // Resume has no new goal to start with, so it reports and points at the
      // command that does, rather than inventing one.
      return copy.legacyUnreadableOnResume(loaded.reason);
    case 'legacy': {
      const goal = loaded.preview.kind === 'unavailable' ? undefined : loaded.preview.legacy.goal;
      const outcome = await handleLegacy(deps, loaded, goal ?? '');
      if (outcome.kind === 'handled') return outcome.message;
      // Only an explicit "start fresh" reaches here, and only with a real goal.
      if (goal === undefined || goal.trim() === '') return copy.legacyUnreadableOnResume('the M0 goal is not stored');
      return startFresh(deps, goal);
    }
    case 'session':
      return continueSession(deps, loaded.session);
  }
}

/**
 * A paused interview is resumed here and only here. Every mutating transition
 * refuses a paused session, so nothing can change until this explicit step.
 */
async function continueSession(deps: Deps, session: Session): Promise<string> {
  if (session.status === 'paused') {
    const resumed = resumeSession(session, nowIso());
    if (!resumed.ok) return resumed.error.message;
    const outcome = await save(deps, resumed.session);
    if (!outcome.ok) return saveFailure('the resume', outcome);
    const continued = await runInterview(deps, resumed.session);
    return `${copy.resumedFromPause(resumed.session)}\n\n${continued}`;
  }
  return runInterview(deps, session);
}

// ---------------------------------------------------------------------------
// The interview loop
// ---------------------------------------------------------------------------

type Step =
  | { kind: 'continue'; session: Session; message: string }
  | { kind: 'stop'; message: string };

/** Guards the dialog loop against a core bug turning into a stuck command. */
const MAX_STEPS = 60;

/**
 * Drives the interview until there is nothing to ask and nothing chosen.
 *
 * Each pass asks the core two questions — `frontier` for what is answerable now,
 * `approvalReadiness` for what blocks approval — and acts on the answer. It never
 * decides eligibility itself, so a stored `blocked` value cannot override the
 * derived verdict, and a deferred decision is never presented as answerable.
 */
async function runInterview(deps: Deps, start: Session): Promise<string> {
  let current = start;
  let lastMessage = '';

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const eligible = frontier(current.decisions);
    if (eligible.length > 0) {
      const next = await askDecision(deps, current, eligible[0]);
      if (next.kind === 'stop') return next.message;
      current = next.session;
      lastMessage = next.message;
      continue;
    }

    const action = await chooseAction(deps, current);
    if (action.kind === 'stop') return action.message;
    current = action.session;
    lastMessage = action.message;
  }

  return [
    'Stopped after a long run of changes without reaching a stopping point.',
    lastMessage,
    'Run /naildown status to see what is saved.',
  ].filter((line) => line !== '').join('\n');
}

/** One question. A dismissed dialog changes nothing and stops the loop. */
async function askDecision(deps: Deps, session: Session, decision: Decision): Promise<Step> {
  const spec = interviewSpec(decision.id);
  if (spec === undefined) {
    return { kind: 'stop', message: `This interview has no question for ${decision.id}.` };
  }

  const options = decision.options.map((option) => ({
    label: option.label,
    description: option.consequence,
  }));
  if (isDeferable(spec)) {
    options.push({ label: ACTIONS.deferLabel, description: ACTIONS.deferDescription });
  }
  // Pause is offered on the question itself, not only from the action menu:
  // the menu is unreachable while anything is still answerable, which would
  // otherwise mean finishing the whole interview before it could be set aside.
  options.push({ label: ACTIONS.pauseLabel, description: 'Keep every answer and stop here.' });

  const picked = await deps.ui.select({ title: decision.question, options });

  if (picked === ACTIONS.pauseLabel) {
    const result = pauseSession(session, nowIso());
    if (!result.ok) return { kind: 'stop', message: result.error.message };
    const outcome = await save(deps, result.session);
    if (!outcome.ok) return { kind: 'stop', message: saveFailure('the pause', outcome) };
    return { kind: 'stop', message: copy.paused(result.session) };
  }

  if (picked === undefined) {
    const canShowDialogs = deps.ui.capabilities?.surface !== false;
    return {
      kind: 'stop',
      message: canShowDialogs ? copy.questionDismissed(session) : copy.noDialogsHere(session),
    };
  }

  if (isDeferable(spec) && picked === ACTIONS.deferLabel) {
    const result = deferDecision(session, decision.id, nowIso());
    if (!result.ok) return { kind: 'stop', message: result.error.message };
    const outcome = await save(deps, result.session);
    if (!outcome.ok) return { kind: 'stop', message: saveFailure('the deferral', outcome) };
    return { kind: 'continue', session: result.session, message: copy.deferred(result.session, decision) };
  }

  const optionId = optionIdForLabel(spec, picked);
  if (optionId === undefined) {
    return { kind: 'stop', message: `That choice is not one of the options for ${decision.id}.` };
  }

  const result = answerDecision(session, decision.id, { text: picked, chosenOptionId: optionId }, nowIso());
  if (!result.ok) {
    const message = result.error.code === 'unresolved-answer'
      ? 'That choice records no decision, so it cannot settle this question.'
      : result.error.message;
    return { kind: 'stop', message };
  }

  const outcome = await save(deps, result.session);
  if (!outcome.ok) return { kind: 'stop', message: saveFailure('the answer', outcome) };

  return {
    kind: 'continue',
    session: result.session,
    message: copy.answered(result.session, findDecision(result.session, decision.id) ?? decision),
  };
}

/**
 * The next action once nothing is answerable. Approval is offered only when the
 * core says the session is ready, and is still just an option — never automatic.
 */
async function chooseAction(deps: Deps, session: Session): Promise<Step> {
  const readiness = approvalReadiness(session);
  const deferred = session.decisions.filter((decision) => decision.status === 'deferred');
  const revisable = revisableDecisions(session);

  const options: Array<{ label: string; description: string }> = [];
  if (readiness.ready) {
    options.push({
      label: ACTIONS.approveLabel,
      description: 'Asks for your explicit confirmation before anything is approved.',
    });
  }
  if (revisable.length > 0) {
    options.push({ label: ACTIONS.reviseLabel, description: 'Change an answer you already gave.' });
  }
  if (deferred.length > 0) {
    options.push({ label: ACTIONS.reconsiderLabel, description: 'Bring a parked question back.' });
  }
  options.push({ label: ACTIONS.pauseLabel, description: 'Keep everything and stop here.' });
  options.push({ label: ACTIONS.doneLabel, description: 'Change nothing and stop here.' });

  const picked = await deps.ui.select({ title: TITLES.action, options });

  if (picked === ACTIONS.approveLabel) return requestApproval(deps, session);
  if (picked === ACTIONS.reviseLabel) return chooseRevision(deps, session, revisable);
  if (picked === ACTIONS.reconsiderLabel) return chooseReconsideration(deps, session, deferred);
  if (picked === ACTIONS.pauseLabel) {
    const result = pauseSession(session, nowIso());
    if (!result.ok) return { kind: 'stop', message: result.error.message };
    const outcome = await save(deps, result.session);
    if (!outcome.ok) return { kind: 'stop', message: saveFailure('the pause', outcome) };
    return { kind: 'stop', message: copy.paused(result.session) };
  }

  if (picked === undefined) return { kind: 'stop', message: copy.questionDismissed(session) };
  return { kind: 'stop', message: copy.statusReport(session, readiness) };
}

/**
 * Settled decisions whose own prerequisites are settled, so a revision will not
 * be refused. Uses the core predicates — this is a filter, not a rule.
 */
function revisableDecisions(session: Session): Decision[] {
  return session.decisions.filter(
    (decision) =>
      isSettledDecision(decision) && unsettledPrerequisites(session.decisions, decision).length === 0,
  );
}

async function chooseRevision(deps: Deps, session: Session, revisable: Decision[]): Promise<Step> {
  const picked = await deps.ui.select({
    title: TITLES.chooseDecision,
    options: revisable.map((decision) => ({
      label: decision.question,
      description: 'Changing this marks anything decided on it as needing review.',
    })),
  });
  if (picked === undefined) return { kind: 'stop', message: copy.questionDismissed(session) };

  const target = revisable.find((decision) => decision.question === picked);
  if (target === undefined) return { kind: 'stop', message: copy.questionDismissed(session) };

  return askDecision(deps, session, target);
}

async function chooseReconsideration(deps: Deps, session: Session, deferred: Decision[]): Promise<Step> {
  const picked = await deps.ui.select({
    title: TITLES.chooseDecision,
    options: deferred.map((decision) => ({
      label: decision.question,
      description: 'Puts it back on the list as an open question.',
    })),
  });
  if (picked === undefined) return { kind: 'stop', message: copy.questionDismissed(session) };

  const target = deferred.find((decision) => decision.question === picked);
  if (target === undefined) return { kind: 'stop', message: copy.questionDismissed(session) };

  const result = reconsiderDeferred(session, target.id, nowIso());
  if (!result.ok) return { kind: 'stop', message: result.error.message };
  const outcome = await save(deps, result.session);
  if (!outcome.ok) return { kind: 'stop', message: saveFailure('the reconsideration', outcome) };

  return {
    kind: 'continue',
    session: result.session,
    message: copy.reconsidered(result.session, findDecision(result.session, target.id) ?? target),
  };
}

/**
 * Default deny, enforced where it actually holds.
 *
 * `cmd.ui.confirm` cannot express a default: the host hard-codes `[Yes, No]` and
 * pre-highlights the first option, so pressing Enter would approve (observed in
 * Command Code 1.84.0, re-checked against 1.88.0, recorded in docs/M0_EVIDENCE.md).
 * A `select` with the refusal first gets the host's own pre-highlight to land on
 * "no". A dismissed dialog resolves `undefined` and a headless host resolves
 * `undefined`, so neither can approve.
 */
async function requestApproval(deps: Deps, session: Session): Promise<Step> {
  const readiness = approvalReadiness(session);
  if (!readiness.ready) {
    return { kind: 'stop', message: copy.notApproved(readiness.blockers.map(blockerLine)) };
  }

  const picked = await deps.ui.select({
    title: APPROVAL.title,
    options: APPROVAL.options.map((option) => ({ label: option.label, description: option.description })),
  });

  if (picked === undefined) return { kind: 'stop', message: copy.approvalDismissed(session) };
  if (picked !== APPROVAL.approveLabel) return { kind: 'stop', message: copy.approvalDeclined(session) };

  const result = approveSession(session, { confirmed: true }, nowIso());
  if (!result.ok) {
    const blockers = result.error.blockers?.map(blockerLine)
      ?? [result.error.message];
    return { kind: 'stop', message: copy.notApproved(blockers) };
  }

  const outcome = await save(deps, result.session);
  if (!outcome.ok) return { kind: 'stop', message: saveFailure('the approval', outcome) };

  return { kind: 'stop', message: copy.approved(result.session) };
}

function blockerLine(blocker: ApprovalBlocker): string {
  return blocker.message;
}

function findDecision(session: Session, id: string): Decision | undefined {
  return session.decisions.find((decision) => decision.id === id);
}
