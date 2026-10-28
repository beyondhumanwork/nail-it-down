/**
 * The built-in M1 interview: three decisions, one root and two dependents.
 *
 * This is data, not logic. The dependency rules, answer recording, invalidation
 * and approval all live in `graph.ts`, `session.ts` and `transitions.ts`; this
 * module only says which questions this version asks. Changing the interview
 * means changing this file, not the engine.
 *
 * The shape is deliberately the M1 decision package's worked example: D1 is the
 * root, D2 and D3 both depend on it, so they become answerable together the
 * moment D1 is confirmed and neither can be asked before that.
 *
 * Priorities are not uniform on purpose. D1 and D2 are critical, so an approval
 * can never happen while either is open. D3 is `important`, which makes it the
 * one decision a person may legitimately defer — a graph where everything is
 * critical would leave the deferral path unreachable through the UI.
 */

import { createDecision, createSession } from './session.ts';
import type { Decision, DecisionOption, DecisionPriority, Session } from './session.ts';

export type InterviewDecisionSpec = {
  /** Stable id, and also the key a person revises later. */
  id: string;
  question: string;
  whyItMatters: string;
  priority: DecisionPriority;
  prerequisites: string[];
  options: DecisionOption[];
};

/** The id of the choice that records "no decision yet". Never settles anything. */
export const UNDECIDED_OPTION_ID = 'not-decided';

const undecided = (consequence: string): DecisionOption => ({
  id: UNDECIDED_OPTION_ID,
  label: 'I have not decided',
  consequence,
  unresolved: true,
});

export const INTERVIEW: readonly InterviewDecisionSpec[] = [
  {
    id: 'who-uses-this',
    question: 'Who is going to use this?',
    whyItMatters: 'It decides who has to agree before the thing can change.',
    priority: 'critical',
    prerequisites: [],
    options: [
      {
        id: 'just-me',
        label: 'Just me',
        consequence: 'You can change your mind without asking anyone.',
      },
      {
        id: 'one-team',
        label: 'One team',
        consequence: 'A few people rely on it, so someone else has to agree before it changes.',
      },
      {
        id: 'many-teams',
        label: 'Many teams or customers',
        consequence: 'People will plan around it, so getting it wrong later costs more to undo.',
      },
      undecided('That is a real answer, and it is the first thing worth settling.'),
    ],
  },
  {
    id: 'first-scope',
    question: "What is the first version's intended scope?",
    whyItMatters: 'It decides what is out of bounds, which is most of the work.',
    priority: 'critical',
    prerequisites: ['who-uses-this'],
    options: [
      {
        id: 'single-job',
        label: 'One job, end to end',
        consequence: 'Narrow, and it can be judged finished.',
      },
      {
        id: 'core-loop',
        label: 'The core loop, without the extras',
        consequence: 'Proves the idea, but someone will ask for the extras.',
      },
      {
        id: 'one-workflow',
        label: 'A thin slice of one workflow',
        consequence: 'Low commitment, and it may not settle the real question.',
      },
      undecided('Leaving scope open is how a first version quietly grows.'),
    ],
  },
  {
    id: 'proof-of-working',
    question: 'What outcome would demonstrate that the first version works?',
    whyItMatters: 'It turns "done" into something you can check instead of argue about.',
    // Not critical, so it is the one decision that may be deferred.
    priority: 'important',
    prerequisites: ['who-uses-this'],
    options: [
      {
        id: 'i-use-it',
        label: 'I use it for real work',
        consequence: 'Fast to reach, and easy to fool yourself about.',
      },
      {
        id: 'team-uses-it',
        label: 'One other person uses it without help',
        consequence: 'Proves it survives someone else, and needs that person.',
      },
      {
        id: 'customer-signs',
        label: 'A customer signs up or pays',
        consequence: 'The strongest signal, and the slowest.',
      },
      undecided('Without an outcome, "working" stays a matter of opinion.'),
    ],
  },
];

/** The spec for one decision, or `undefined` when the id is not part of the interview. */
export function interviewSpec(id: string): InterviewDecisionSpec | undefined {
  return INTERVIEW.find((spec) => spec.id === id);
}

/** True when this decision may be deferred (everything the interview does not call critical). */
export function isDeferable(spec: InterviewDecisionSpec): boolean {
  return spec.priority !== 'critical';
}

export function createInterviewDecisions(now: string): Decision[] {
  return INTERVIEW.map((spec) => createDecision({
    id: spec.id,
    question: spec.question,
    whyItMatters: spec.whyItMatters,
    priority: spec.priority,
    prerequisites: spec.prerequisites,
    options: spec.options.map((option) => (
      option.unresolved === true
        ? { id: option.id, label: option.label, consequence: option.consequence, unresolved: true }
        : { id: option.id, label: option.label, consequence: option.consequence }
    )),
    now,
  }));
}

/**
 * A fresh session for a goal, built through the schema module's own
 * constructors so there is no second way to make a `Session`.
 */
export function createInterviewSession(input: {
  id: string;
  workspace: string;
  goal: string;
  now: string;
}): Session {
  return createSession({
    id: input.id,
    workspace: input.workspace,
    goal: input.goal,
    decisions: createInterviewDecisions(input.now),
    now: input.now,
  });
}

/** Look up the option id a dialog label refers to, so no rule keys off the wording. */
export function optionIdForLabel(spec: InterviewDecisionSpec, label: string): string | undefined {
  return spec.options.find((option) => option.label === label)?.id;
}

/** The dialog label for a stored option id, or `undefined` when the id is unknown. */
export function optionLabelForId(decision: Decision, optionId: string | undefined): string | undefined {
  if (optionId === undefined) return undefined;
  return decision.options.find((option) => option.id === optionId)?.label;
}
