/**
 * M2-5D: human-authorised repository context.
 *
 * The synthetic adapter (`offerRepositoryContext`) takes a `FixtureAuthorization`
 * from its caller. That is the right shape for a harness that mints its own
 * fixture, and the wrong shape for production: a caller-supplied path is a claim,
 * not a decision by the person using the tool.
 *
 * This module is the human-authorised counterpart. It supplies the pilot with an
 * `authorizeRoot` *function* instead of a static root, so the authorization is
 * established by a native dialog answered at runtime, in order, by the operator.
 * There is no parameter here through which a caller can name a root:
 *
 *     offerHumanAuthorizedContext({ ui })   // <- no root argument exists
 *
 * THE THREE POSITIVE HUMAN DECISIONS
 *
 *   1. opt in       - the interview asks whether to use repository context at all
 *   2. authorise    - the person types an exact root and then explicitly confirms
 *                     that this exact root may be inspected for this invocation
 *   3. consent      - the person explicitly grants a bounded read of the
 *                     disclosed allowlist
 *
 * Steps 2 and 3 are separate dialogs with separate labels and separate refusal
 * paths. Authorising a root is not authorising a read, and the tests assert each
 * is refused independently of the other.
 *
 * WHAT THIS IS NOT
 *
 * It is not proof that a filesystem is safe. Ownership, canonical-root and
 * pre-read checks still run, and the cooperative-workspace threat model is
 * unchanged: hostile concurrent replacement of a parent directory is not
 * reliably prevented or detected. The authorization says "the person chose this
 * directory"; it says nothing about the directory's contents or its honesty.
 */

import * as nodePath from 'node:path';

import type { ModUi } from './modApi.ts';
import {
  PILOT_PERSISTENCE_STATEMENT,
  pilotDisclosure,
  runWorkspacePilot,
} from './workspacePilot.ts';
import type { PilotRefusalReason, PilotResult } from './workspacePilot.ts';
import { verifiedEvidenceOf } from './offerRepositoryContext.ts';
import type { RepositoryContextOutcome } from './offerRepositoryContext.ts';

/** The root-authorization dialog. Separate from the read-consent dialog. */
export const AUTHORIZE_TITLE = 'Inspect this exact workspace for this run?';
export const AUTHORIZE_LABELS = {
  refuse: 'Do not inspect it',
  grant: 'Inspect this workspace',
} as const;

/** The opt-in question, asked before anything else happens. */
export const OPT_IN_TITLE = 'Use repository context for this interview?';
export const OPT_IN_LABELS = {
  ideaOnly: 'Continue without reading files',
  useRepository: 'Offer to read project files',
} as const;

export type HumanRefusalReason =
  | 'opted-out'
  | 'opt-in-dismissed'
  | 'opt-in-malformed'
  | 'no-ui'
  /** The person declined to authorise the root. */
  | 'root-not-authorized'
  | 'authorization-dismissed'
  | 'authorization-malformed'
  /** The authorization dialog could not be shown the terms it authorises. */
  | 'authorization-surface-failed'
  | `pilot:${string}`;

export type HumanAuthorizedOutcome =
  | { kind: 'idea-only'; reason: HumanRefusalReason; message: string }
  | {
    kind: 'inspected';
    message: string;
    root: string;
    filesRead: number;
    filesRejected: number;
    evidence: ReturnType<typeof verifiedEvidenceOf>;
  };

function isUsable(ui: ModUi | undefined): ui is ModUi {
  if (ui === undefined) return false;
  if (typeof ui.select !== 'function' || typeof ui.input !== 'function') return false;
  // A host with no rendered surface resolves `undefined` for every dialog, which
  // is indistinguishable from a dismissal - and a dialog nobody saw is not a
  // decision. Refuse before asking rather than after.
  if (ui.capabilities?.surface === false) return false;
  return true;
}

/**
 * Asks whether to use repository context at all.
 *
 * Asked first, and refusal-first, so a person who did not want this feature
 * never sees a path prompt. A dismissal, an unexpected value or a headless host
 * all mean idea-only.
 */
async function askOptIn(ui: ModUi): Promise<{ ok: true } | { ok: false; reason: HumanRefusalReason }> {
  let picked: string | undefined;
  try {
    picked = await ui.select({
      title: OPT_IN_TITLE,
      options: [
        { label: OPT_IN_LABELS.ideaOnly, description: 'Nothing is read. The interview works without it.' },
        { label: OPT_IN_LABELS.useRepository, description: 'You will be asked for a folder, and then asked to allow a bounded read.' },
      ],
    });
  } catch {
    return { ok: false, reason: 'opt-in-dismissed' };
  }
  if (picked === OPT_IN_LABELS.useRepository) return { ok: true };
  if (picked === OPT_IN_LABELS.ideaOnly) return { ok: false, reason: 'opted-out' };
  if (picked === undefined) return { ok: false, reason: 'opt-in-dismissed' };
  return { ok: false, reason: 'opt-in-malformed' };
}

/**
 * The mid-sequence human root authorization.
 *
 * Returns the root the person authorised, or a refusal. The dialog shows the
 * exact path being authorised and the persistence boundary, because a person
 * agreeing to "inspect this workspace" should be able to see both at the moment
 * they decide.
 *
 * Note what is *not* here: no filesystem call. Nothing in this function stats,
 * resolves or opens the path. It is shown and confirmed, and the pilot does the
 * rest only after the read consent has also been granted.
 */
export async function authorizeRootByHuman(
  ui: ModUi,
  proposed: string,
): Promise<{ ok: true; root: string; issuedBy: string } | { ok: false; reason: PilotRefusalReason }> {
  const notify = ui.notify;
  if (typeof notify !== 'function') {
    // No surface means the terms were never shown, which means the answer is not
    // informed. Fail closed rather than asking anyway.
    //
    // This branch is behaviourally redundant with the `catch` below - calling
    // `notify.call` on `undefined` throws a TypeError, which lands on the same
    // refusal. It exists because an explicit check is legible and does not make
    // the safety property rest on exception control flow; it is asserted by the
    // zero-dialogs test, not claimed as independently necessary.
    return { ok: false, reason: 'authorization-disclosure-failed' };
  }
  try {
    notify.call(ui, [
      `You are about to authorise this exact folder for this run: ${proposed}`,
      'Authorising the folder is not the same as allowing a read: you will be asked separately.',
      `Only these root files can ever be read: README.md, AGENTS.md, package.json, pyproject.toml, Cargo.toml, go.mod, tsconfig.json.`,
      `Host persistence: ${PILOT_PERSISTENCE_STATEMENT}`,
    ].join('\n'), 'warning');
  } catch {
    return { ok: false, reason: 'authorization-disclosure-failed' };
  }

  let picked: string | undefined;
  try {
    picked = await ui.select({
      title: AUTHORIZE_TITLE,
      options: [
        { label: AUTHORIZE_LABELS.refuse, description: 'Nothing is inspected. This is the safe answer.' },
        { label: AUTHORIZE_LABELS.grant, description: `Authorise exactly ${proposed} for this run only.` },
      ],
    });
  } catch {
    return { ok: false, reason: 'disclosure-failed' };
  }

  if (picked === AUTHORIZE_LABELS.grant) {
    return { ok: true, root: proposed, issuedBy: 'human authorization dialog, this invocation' };
  }
  if (picked === AUTHORIZE_LABELS.refuse) return { ok: false, reason: 'not-authorized-root' };
  if (picked === undefined) return { ok: false, reason: 'not-authorized-root' };
  return { ok: false, reason: 'authorization-malformed' };
}

/** Renders a pilot result, appending the host-persistence boundary. */
function messageFor(result: PilotResult): string {
  const body = result.kind === 'inspected'
    ? renderInspected(result)
    : renderOther(result);
  return `${body}\n\nHost persistence: ${PILOT_PERSISTENCE_STATEMENT}`;
}

function renderOther(result: Exclude<PilotResult, { kind: 'inspected' }>): string {
  if (result.kind === 'refused') {
    return ['Workspace pilot — nothing was read', '', `Reason: ${result.reason}`, result.note].join('\n');
  }
  if (result.kind === 'nothing-to-read') {
    return ['Workspace pilot — nothing to read', '', result.detail,
      'This is not evidence that the project lacks these files.'].join('\n');
  }
  return ['Workspace pilot — nothing was read', '',
    `The workspace was refused before any file was read (${result.reason}).`, result.detail].join('\n');
}

function renderInspected(result: Extract<PilotResult, { kind: 'inspected' }>): string {
  const lines = ['Workspace pilot', '', `Root: ${result.root.proposed}`, ''];
  lines.push(`Read ${result.files.length} files:`);
  for (const file of result.files) lines.push(`  ${file.path}  (${file.kind}, ${file.lines} lines)`);
  if (result.skipped.length > 0) {
    lines.push('Skipped:');
    for (const entry of result.skipped) lines.push(`  ${entry.path}  (${entry.reason})`);
  }
  if (result.declarations.length > 0) {
    lines.push('Cited from the workspace, not inferred:');
    for (const declaration of result.declarations) {
      lines.push(`  ${declaration.claim}`);
      lines.push(`    ${declaration.path} lines ${declaration.lineStart}-${declaration.lineEnd}: ${declaration.excerpt}`);
    }
  }
  if (result.evidenceGap !== undefined) {
    lines.push('');
    lines.push(result.evidenceGap);
  }
  lines.push('');
  lines.push('Worth knowing:');
  for (const caveat of result.caveats) lines.push(`  - ${caveat}`);
  return lines.join('\n');
}

/**
 * Runs the human-authorised flow, once, for this invocation.
 *
 * There is deliberately **no root parameter**. The only way a root becomes
 * authorised is the operator confirming it in `authorizeRootByHuman` at runtime.
 */
export async function offerHumanAuthorizedContext(input: {
  ui: ModUi | undefined;
}): Promise<HumanAuthorizedOutcome> {
  if (!isUsable(input.ui)) {
    return {
      kind: 'idea-only',
      reason: 'no-ui',
      message: 'Repository context was not offered: this host has no dialog surface, so nothing was read.',
    };
  }

  const optIn = await askOptIn(input.ui);
  if (!optIn.ok) {
    return {
      kind: 'idea-only',
      reason: optIn.reason,
      message: `Repository context was not used (${optIn.reason}), so nothing was read.`,
    };
  }

  const result = await runWorkspacePilot({
    ui: input.ui,
    // The root is established by the human step, not supplied here. There is no
    // `authorization` member on purpose.
    authorizeRoot: (proposed) => authorizeRootByHuman(input.ui as ModUi, proposed),
  });

  if (result.kind !== 'inspected') {
    const reason: HumanRefusalReason = result.kind === 'refused'
      ? `pilot:${result.reason}`
      : result.kind === 'not-inspected'
        ? `pilot:${result.reason}`
        : 'pilot:nothing-to-read';
    return { kind: 'idea-only', reason, message: messageFor(result) };
  }

  return {
    kind: 'inspected',
    message: messageFor(result),
    root: result.root.canonical,
    filesRead: result.files.length,
    filesRejected: result.skipped.length,
    evidence: verifiedEvidenceOf(result.declarations),
  };
}

/** True only when this outcome carries at least one verified, citable claim. */
export function hasVerifiedHumanEvidence(outcome: HumanAuthorizedOutcome): boolean {
  return outcome.kind === 'inspected' && outcome.evidence.length > 0;
}

/** The disclosure shown before the read consent, for tests and review. */
export function humanDisclosure(proposedRoot: string): string {
  return pilotDisclosure(nodePath.resolve(proposedRoot));
}

/** Re-exported so a future interview step needs one import. */
export type { RepositoryContextOutcome };
