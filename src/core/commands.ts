/**
 * Argument parsing for the single `/naildown` command.
 *
 * The host hands the handler the raw text after the command name (verified: `parseSlashCommand`
 * in the installed Command Code matches `/^\/([\w:-]+)\s*([\s\S]*)$/` and passes group 2 through
 * untouched). Everything that is not an exact subcommand is a goal, with internal spacing kept.
 *
 * The host refuses multi-line slash commands, so a goal is always a single line here.
 */

export const SUBCOMMANDS = ['status', 'resume', 'help'] as const;

export type Intent =
  | { kind: 'status' }
  | { kind: 'resume' }
  | { kind: 'help' }
  | { kind: 'start'; goal: string };

export function parseIntent(args: unknown): Intent {
  const raw = typeof args === 'string' ? args : '';
  const trimmed = raw.trim();
  const lowered = trimmed.toLowerCase();

  // A goal is arbitrary text, so subcommands are exact matches only: "Status page" stays a goal.
  if (lowered === 'status') return { kind: 'status' };
  if (lowered === 'resume') return { kind: 'resume' };
  if (lowered === 'help' || lowered === '?' || trimmed === '') return { kind: 'help' };

  return { kind: 'start', goal: trimmed };
}
