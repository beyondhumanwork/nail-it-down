/**
 * Argument parsing for the single `/naildown` command.
 *
 * The host hands the handler the raw text after the command name (verified: `parseSlashCommand`
 * in the installed Command Code matches `/^\/([\w:-]+)\s*([\s\S]*)$/` and passes group 2 through
 * untouched). Everything that is not an exact subcommand is a goal, with internal spacing kept.
 *
 * The host refuses multi-line slash commands, so a goal is always a single line here.
 */

export const SUBCOMMANDS = ['status', 'resume', 'help', 'context'] as const;

export type Intent =
  | { kind: 'status' }
  | { kind: 'resume' }
  | { kind: 'help' }
  /**
   * The optional repository-context step.
   *
   * Never carries a path: `context` with any trailing text is a rejection, not a
   * root and not a goal. Accepting arguments here would put a filesystem path
   * into slash-command history, and the M2-7 run showed that history *is*
   * written to disk.
   */
  | { kind: 'context' }
  | { kind: 'context-invalid'; detail: string }
  | { kind: 'start'; goal: string };

export function parseIntent(args: unknown): Intent {
  const raw = typeof args === 'string' ? args : '';
  const trimmed = raw.trim();
  const lowered = trimmed.toLowerCase();

  // A goal is arbitrary text, so subcommands are exact matches only: "Status page" stays a goal.
  if (lowered === 'status') return { kind: 'status' };
  if (lowered === 'resume') return { kind: 'resume' };
  if (lowered === 'help' || lowered === '?' || trimmed === '') return { kind: 'help' };

  // `context` takes no arguments. Anything after the word is refused rather than
  // folded into the goal, because "context /home/me/repo" would otherwise start a
  // *new interview* whose goal is that path - and would write the path to
  // history. The detail names no path back, so nothing new is echoed.
  if (lowered === 'context') return { kind: 'context' };
  const head = lowered.split(/\s+/)[0];
  if (head === 'context') {
    return { kind: 'context-invalid', detail: 'context takes no arguments' };
  }

  return { kind: 'start', goal: trimmed };
}
