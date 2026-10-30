/**
 * M2-5B: the dormant seam for optional repository context.
 *
 * This is the shape a future `/naildown` integration would call. It is **not**
 * imported by `src/index.ts`, not registered as a command, and not installed.
 * The existing interview is untouched by it, and this module is uninteresting
 * until someone adds the one optional call site - which is a separate, reviewed
 * decision that this slice deliberately does not take.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * `runWorkspacePilot` is a fine controller but a bad seam. It takes an
 * authorization and assumes the caller already established provenance, which is
 * exactly the judgement a future integration must not be free to get wrong. This
 * adapter narrows that: the *only* roots it can authorize are ones a harness has
 * registered as its own disposable fixture, and the prose it hands back is the
 * shape an interview step needs (a decision plus a message) rather than a raw
 * pilot result.
 *
 * THE THREE THINGS THAT MUST NEVER MERGE
 *
 *   Proposal      - the exact path a person typed in a native dialog. A string,
 *                   normalised lexically. Never filesystem access.
 *   Authorization - an independent grant, made by whoever created a disposable
 *                   fixture, naming that fixture's exact root. A typed path,
 *                   `cmd.cwd`, a slash-command argument or a caller-supplied
 *                   `permittedParents` value can never supply this.
 *   Consent       - a separate native, refusal-first decision made *after* the
 *                   proposal and the disclosure, for this invocation only.
 *
 * A proposal plus consent is still not authority: without a registered fixture
 * the adapter refuses before touching anything.
 */

import * as nodePath from 'node:path';

import type { ModUi } from './modApi.ts';
import {
  PILOT_PERSISTENCE_STATEMENT,
  renderWorkspacePilot,
  runWorkspacePilot,
} from './workspacePilot.ts';
import type { PilotResult } from './workspacePilot.ts';

/**
 * What the caller must produce to authorize anything.
 *
 * `fixtureRoot` is the disposable directory the *caller* created and owns. The
 * adapter holds it to a lexical standard: the person must type this exact path.
 * It is not a permission to read `fixtureRoot`'s parent, its siblings, or
 * anything else reachable by another string.
 */
export type FixtureAuthorization = {
  /** Absolute path of the fixture this caller minted for this invocation. */
  fixtureRoot: string;
  /** Free-text provenance for the record. Never sufficient on its own. */
  issuedBy: string;
};

/** Why the adapter declined to inspect anything. A closed set. */
export type ContextRefusalReason =
  /** No UI, or no dialog surface: nothing could be asked, so nothing is read. */
  | 'no-ui'
  /** The fixture authorization the caller supplied was absent or malformed. */
  | 'authorization-invalid'
  /** The proposal was not the registered fixture. Refused with zero filesystem access. */
  | 'not-authorized-root'
  /** Everything the pilot itself reports - consent, root, listing, evidence. */
  | `pilot:${string}`;

export type RepositoryContextOutcome =
  /**
   * Nothing was read. The interview continues exactly as it would have without
   * this feature; `message` is renderable and `ideaOnly` is always true here.
   */
  | {
    kind: 'idea-only';
    reason: ContextRefusalReason;
    message: string;
  }
  /**
   * Something was read. `message` may contain citations; it contains none when
   * the pilot's own verification did not pass.
   */
  | {
    kind: 'inspected';
    message: string;
    /** False when a refusal inside the pilot means no evidence may be shown. */
    hasEvidence: boolean;
  };

/** Narrow a caller's authorization to a resolved root, or `undefined`. */
function fixtureRootOf(authorization: FixtureAuthorization | undefined): string | undefined {
  if (authorization === null || typeof authorization !== 'object') return undefined;
  const { fixtureRoot, issuedBy } = authorization;
  if (typeof fixtureRoot !== 'string' || fixtureRoot === '') return undefined;
  if (!nodePath.isAbsolute(fixtureRoot)) return undefined;
  if (typeof issuedBy !== 'string' || issuedBy.trim() === '') return undefined;
  return nodePath.resolve(fixtureRoot);
}

/**
 * Renders a pilot result as an interview-shaped message.
 *
 * Deliberately thin: it re-uses `renderWorkspacePilot` rather than formatting
 * citations again. A second formatter would be a second place for a citation to
 * be shown when it should not be.
 */
/**
 * Appends the host-persistence note to any message.
 *
 * Every outcome goes through here - including the two that never reach the
 * pilot. A person being told "nothing was read" still deserves to know what the
 * host keeps, and an early return that skips this is a silent gap in the one
 * disclosure this module exists to make.
 */
function withHostPersistenceNote(body: string): string {
  return `${body}\n\nHost persistence: ${PILOT_PERSISTENCE_STATEMENT}`;
}

function messageFor(result: PilotResult): string {
  // Re-uses `renderWorkspacePilot` rather than formatting citations again: a
  // second formatter would be a second place for a citation to be shown when it
  // should not be.
  return withHostPersistenceNote(renderWorkspacePilot(result));
}

/**
 * Offers optional repository context for one invocation.
 *
 * Order is the security property and it is inherited, not re-invented:
 *
 *   1. authorize  - the caller's fixture must be well-formed, or refuse. No
 *                   filesystem access of any kind happens before this passes.
 *   2. pilot      - which proposes a root, checks it lexically against the
 *                   fixture, discloses, asks for consent, and only then resolves
 *                   and reads.
 *
 * Every refusal returns `idea-only`, because the interview must always be able
 * to continue without repository context. There is no retry path and no partial
 * state: the result is the whole outcome of this invocation.
 */
export async function offerRepositoryContext(input: {
  ui: ModUi | undefined;
  authorization: FixtureAuthorization | undefined;
  /**
   * Optional pre-read gate, forwarded unchanged. It can only refuse; the
   * adapter does not add, remove or weaken any condition of its own.
   */
  beforeRead?: Parameters<typeof runWorkspacePilot>[0]['beforeRead'];
}): Promise<RepositoryContextOutcome> {
  const fixtureRoot = fixtureRootOf(input.authorization);

  if (input.ui === undefined || typeof input.ui.select !== 'function') {
    return {
      kind: 'idea-only',
      reason: 'no-ui',
      message: withHostPersistenceNote(
        'Repository context was not offered: this host has no dialog surface, so nothing was read.',
      ),
    };
  }
  if (fixtureRoot === undefined) {
    return {
      kind: 'idea-only',
      reason: 'authorization-invalid',
      message: withHostPersistenceNote(
        'Repository context was not offered: no valid fixture authorization was supplied, so nothing was read.',
      ),
    };
  }

  const result = await runWorkspacePilot({
    ui: input.ui,
    authorization: { root: fixtureRoot, issuedBy: input.authorization!.issuedBy },
    ...(input.beforeRead === undefined ? {} : { beforeRead: input.beforeRead }),
  });

  if (result.kind !== 'inspected') {
    // `refused`, `not-inspected` and `nothing-to-read` all mean the interview
    // continues without repository evidence. They are not failures.
    const reason: ContextRefusalReason = result.kind === 'refused'
      ? `pilot:${result.reason}`
      : result.kind === 'not-inspected'
        ? `pilot:${result.reason}`
        : 'pilot:nothing-to-read';
    return { kind: 'idea-only', reason, message: messageFor(result) };
  }

  return { kind: 'inspected', message: messageFor(result), hasEvidence: true };
}

/**
 * The command result a future integration would return.
 *
 * `message` only. `prompt` is what submits a model turn, and this feature never
 * submits one: repository content is rendered into the local feed and stops
 * there. The field exists in the host's type, so its absence is the assertion.
 */
export type IntegrationCommandResult = { message: string };

/** Convenience for the future call site: an outcome shaped for the host. */
export function asCommandResult(outcome: RepositoryContextOutcome): IntegrationCommandResult {
  return { message: outcome.message };
}
