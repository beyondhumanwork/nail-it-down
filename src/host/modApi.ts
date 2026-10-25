/**
 * The slice of Command Code's ModApi this mod uses.
 *
 * Why this file exists: the official docs and bundled examples import
 * `type {ModApi} from '@commandcode/harness'`, but that package is not published on npm
 * (the registry answers 404 for it as of 2026-10-20), so a standalone mod cannot typecheck
 * against the real typings. These signatures were transcribed from the installed host,
 * Command Code 1.84.0:
 *
 *   - `dist/bundled/mod-builder/reference/api.md` and `ui.md` (shipped docs)
 *   - `dist/cli.mjs` (the actual `addCommand` / `runCommand` / `buildUi` / store implementations)
 *
 * Notable facts taken from the implementation rather than the prose docs:
 *
 * - `ui.select` takes `{label, description?}` options and resolves the selected **label**
 *   (`options.some(o => o.label === picked) ? picked : undefined`). There is no `value` field
 *   on a dialog option; the pane `select` *element* has one and the dialog does not.
 * - `ui.select` / `ui.input` resolve `undefined`, and `ui.confirm` resolves `false`, when the
 *   host is headless.
 * - `ui.capabilities.surface` is false when no widget/pane/toast surface is rendered (headless).
 * - `ui.confirm` is deliberately absent below. In 1.84.0 it hard-codes `[Yes, No]` and
 *   pre-highlights the first option, so pressing Enter approves; it cannot be told to default to
 *   no. Approval therefore uses `ui.select` with the refusal listed first (see src/index.ts).
 * - A command handler may be async: the host does `await command.handler({args, ui, cwd, exec})`
 *   and renders a truthy `message` as a feed row.
 * - `store.get` is synchronous; `store.set` mutates its in-memory map *before* awaiting the
 *   disk write, so a rejected `set` leaves the in-memory value changed. Callers must treat the
 *   resolved promise — not a later `get` — as proof that data was saved.
 *
 * `exec` is deliberately absent from `CommandContext`: this mod must not run processes or read
 * the workspace, and leaving it out makes an accidental call a type error.
 */

export type Disposable = {
  dispose(): void;
};

export type DialogOption = {
  label: string;
  description?: string;
};

export type ModUi = {
  select(input: {title: string; options: readonly DialogOption[]}): Promise<string | undefined>;
  capabilities: {
    readonly status: boolean;
    readonly surface: boolean;
  };
};

export type ModStore = {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
};

export type CommandResult = {
  /** Rendered as an info row. The mod always returns one. */
  message?: string;
  /** Declared because the host accepts it; this mod must never return one (it would start a turn). */
  prompt?: string;
};

export type CommandContext = {
  /** Raw text typed after the command name, exactly as the host parsed it. */
  args: string;
  ui: ModUi;
  /** Workspace root reported by the host. */
  cwd: string;
};

export type CommandHandler = (
  context: CommandContext,
) => CommandResult | void | Promise<CommandResult | void>;

export type ModApi = {
  readonly name: string;
  readonly cwd: string;
  readonly ui: ModUi;
  readonly store: ModStore;
  addCommand(command: {
    name: string;
    description?: string;
    argumentHint?: string;
    handler: CommandHandler;
  }): Disposable;
};
