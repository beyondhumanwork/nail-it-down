/**
 * M2 Slice 2: the consent gate for reading repository metadata.
 *
 * This module decides *whether* a read may happen. It never reads anything, and
 * it persists nothing: consent is a per-invocation answer, not a setting, so a
 * later session cannot inherit it from this one.
 *
 * Default deny is enforced structurally rather than by remembering to check a
 * flag. Only one exact label grants access, and every other outcome — the
 * refusal label, a dismissal, a headless host, an unexpected string, a thrown
 * dialog — has a named refusal reason. There is no path that returns `granted`
 * without the host having literally returned the grant label.
 */

import type { ModUi } from './modApi.ts';
import { CANDIDATE_POLICY, DEFAULT_BUDGET } from '../core/discovery.ts';

/**
 * The two labels, kept as constants so tests and the host dialog cannot drift.
 *
 * The refusal is listed first because Command Code pre-highlights the first
 * option: pressing Enter on an untouched dialog must refuse, not consent.
 */
export const CONSENT_LABELS = {
  refuse: 'Do not read anything',
  grant: 'Read those files',
} as const;

export const CONSENT_TITLE = 'Read a small set of project metadata files?';

export type ConsentRefusalReason =
  /** The person chose the refusal label. */
  | 'refused-by-choice'
  /** The dialog was dismissed (Escape, or `undefined` from the host). */
  | 'dismissed'
  /** No interactive surface, so nothing could be asked. */
  | 'headless'
  /** The host returned something that is not one of our labels. */
  | 'unexpected-value'
  /** The dialog itself failed. */
  | 'ui-failure';

export type RepositoryConsentOutcome =
  | { kind: 'granted' }
  | { kind: 'refused'; reason: ConsentRefusalReason };

/** How many files, and which kinds. Derived from the policy so the dialog cannot drift from it. */
function readableSummary(): string {
  const documentation = CANDIDATE_POLICY.filter((spec) => spec.kind === 'documentation').map((spec) => spec.name);
  const manifests = CANDIDATE_POLICY.filter((spec) => spec.kind === 'manifest').map((spec) => spec.name);
  return [
    `Root documentation: ${documentation.join(', ')}.`,
    `Root manifests: ${manifests.join(', ')}.`,
  ].join(' ');
}

/**
 * Extra facts the caller wants on the decision surface itself, next to the
 * choice rather than only in a preceding notice.
 *
 * Added for M2 Slice 3B2 without changing any existing behaviour: callers that
 * pass nothing get exactly the dialog they got before.
 */
export type ConsentDetail = {
  /** The exact workspace root the grant would cover. */
  root: string;
  /** A short, honest statement of the residual filesystem risk. */
  risk: string;
};

/**
 * The dialog's options, refusal first.
 *
 * The grant description states the limits and — importantly — that nothing is
 * sent anywhere in this slice. A person agreeing to a local read has not agreed
 * to model transmission, and the two must not be blurred.
 */
export function consentOptions(detail?: ConsentDetail): ReadonlyArray<{ label: string; description: string }> {
  const grant = [
    `Reads at most ${DEFAULT_BUDGET.maxFiles} of these root files,`,
    `${DEFAULT_BUDGET.maxFileBytes / 1024} KiB each and ${DEFAULT_BUDGET.maxTotalBytes / 1024} KiB in total.`,
    'Nothing read this way is sent to a model or any external service.',
  ].join(' ');
  return [
    {
      label: CONSENT_LABELS.refuse,
      description: 'Nothing is read. This is the safe answer.',
    },
    {
      label: CONSENT_LABELS.grant,
      // The root and the risk belong on the choice itself: a notice above the
      // dialog can scroll away, and a grant must be made against the exact
      // directory and the exact residual risk it covers.
      description: detail === undefined
        ? grant
        : `${grant} Root: ${detail.root}. Risk: ${detail.risk}`,
    },
  ];
}

/** The full disclosure text, so a reviewer can read it without running the dialog. */
export function consentDisclosure(): string {
  return [
    CONSENT_TITLE,
    readableSummary(),
    `Limits: ${DEFAULT_BUDGET.maxFiles} files, ${DEFAULT_BUDGET.maxFileBytes / 1024} KiB each,`,
    `${DEFAULT_BUDGET.maxTotalBytes / 1024} KiB total, ${DEFAULT_BUDGET.maxFileLines} lines each.`,
    'No repository content is sent to a model or an external service in this version.',
  ].join(' ');
}

/**
 * Asks whether the person permits a bounded read of root metadata.
 *
 * Never throws and never reads. A host without a dialog surface refuses without
 * asking, because "there was no way to ask" is not consent.
 */
export async function requestRepositoryReadConsent(
  ui: ModUi | undefined,
  detail?: ConsentDetail,
): Promise<RepositoryConsentOutcome> {
  if (ui === undefined || typeof ui.select !== 'function') {
    return { kind: 'refused', reason: 'headless' };
  }
  // Checked before asking: a headless host resolves `undefined`, which is
  // indistinguishable from a dismissal, and "no surface existed" is the more
  // accurate of the two.
  if (ui.capabilities?.surface === false) {
    return { kind: 'refused', reason: 'headless' };
  }

  let picked: string | undefined;
  try {
    picked = await ui.select({ title: CONSENT_TITLE, options: consentOptions(detail) });
  } catch {
    // A dialog that failed is not an answer. No error text is surfaced: it is
    // host text and this decision does not need it.
    return { kind: 'refused', reason: 'ui-failure' };
  }

  if (picked === CONSENT_LABELS.grant) return { kind: 'granted' };
  if (picked === CONSENT_LABELS.refuse) return { kind: 'refused', reason: 'refused-by-choice' };
  if (picked === undefined) return { kind: 'refused', reason: 'dismissed' };
  return { kind: 'refused', reason: 'unexpected-value' };
}

/** True only for the one outcome that may be followed by a read. */
export function isGranted(outcome: RepositoryConsentOutcome): boolean {
  return outcome.kind === 'granted';
}
