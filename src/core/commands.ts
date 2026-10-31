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
   * root and not a goal.
   *
   * What that rejection *can* prevent: the path being used, being echoed back, or
   * starting an interview whose goal is that path.
   *
   * What it cannot prevent: the host writing the typed text to slash-command
   * history. Command Code records what the user typed **before** the mod receives
   * or rejects the command - M2-7 observed `/nid-m27-probe` in
   * `~/.commandcode/history.jsonl` - so a path typed after `context` may already
   * be on disk by the time this parser sees it. The no-arguments contract keeps a
   * path from being *accepted*, which is the part a mod can control.
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
  // *new interview* whose goal is that path.
  //
  // This does not un-write anything: the host records typed slash-command text
  // before the mod runs, so a path typed here may already be in history. It keeps
  // the path from being accepted, used, or echoed - see the Intent comment.
  if (lowered === 'context') return { kind: 'context' };
  const head = lowered.split(/\s+/)[0];
  if (head === 'context') {
    return { kind: 'context-invalid', detail: 'context takes no arguments' };
  }

  return { kind: 'start', goal: trimmed };
}
