/**
 * A fake Command Code host for tests.
 *
 * It mirrors the behaviour observed in the installed host (Command Code 1.84.0, dist/cli.mjs)
 * rather than an idealized API:
 *
 * - headless dialogs resolve their deterministic defaults (`select` → undefined)
 * - `store.set` updates the in-memory map BEFORE the disk write, so a failed write still leaves
 *   the new value visible to a later `get` in the same process
 *
 * Sharing one `data` map between two hosts is how a process restart is simulated.
 */

import { APPROVAL } from '../src/core/copy.ts';
import type {
  CommandContext,
  CommandHandler,
  CommandResult,
  DialogOption,
  Disposable,
  ModApi,
  ModStore,
  ModUi,
} from '../src/host/modApi.ts';

export type StoreData = Map<string, unknown>;

export type FakeHostOptions = {
  cwd?: string;
  /** Share the same map between hosts to simulate a restart. */
  data?: StoreData;
  headless?: boolean;
  /** Answers handed to the question dialog, in order. */
  selectAnswers?: Array<string | undefined>;
  /** Answers handed to the approval dialog, in order. */
  approvalAnswers?: Array<string | undefined>;
  /** 1-based ordinals of store writes that should reject, after updating the in-memory map. */
  failWritesAt?: number[];
};

export type RegisteredCommand = {
  name: string;
  description?: string;
  argumentHint?: string;
  handler: CommandHandler;
};

export type SelectCall = { title: string; options: readonly DialogOption[] };

export class FakeHost implements ModApi {
  readonly name = 'naildown-test';
  readonly cwd: string;
  readonly store: ModStore;
  readonly ui: ModUi;
  readonly data: StoreData;
  readonly selectCalls: SelectCall[] = [];

  command: RegisteredCommand | undefined;

  private readonly selectAnswers: Array<string | undefined>;
  private readonly approvalAnswers: Array<string | undefined>;
  private readonly failWritesAt: Set<number>;
  private writeCount = 0;

  constructor(options: FakeHostOptions = {}) {
    this.cwd = options.cwd ?? '/work/example';
    this.data = options.data ?? new Map();
    this.selectAnswers = [...(options.selectAnswers ?? [])];
    this.approvalAnswers = [...(options.approvalAnswers ?? [])];
    this.failWritesAt = new Set(options.failWritesAt ?? []);

    const headless = options.headless ?? false;

    this.store = {
      get: <T,>(key: string): T | undefined => this.data.get(key) as T | undefined,
      set: async (key, value) => {
        // The installed host writes to its in-memory map first, then to disk.
        this.data.set(key, value);
        this.writeCount += 1;
        if (this.failWritesAt.has(this.writeCount)) {
          throw new Error(`EACCES: permission denied, open '${key}'`);
        }
      },
      delete: async (key) => {
        this.data.delete(key);
      },
    };

    this.ui = {
      select: async (input) => {
        this.selectCalls.push({ title: input.title, options: input.options });
        if (headless) return undefined;

        const isApproval = input.title === APPROVAL.title;
        if (isApproval) {
          // Unscripted approval falls to the refusal, matching the default-deny design under test.
          return this.approvalAnswers.length === 0 ? APPROVAL.denyLabel : this.approvalAnswers.shift();
        }

        if (this.selectAnswers.length === 0) {
          throw new Error('FakeHost: no scripted question answer left');
        }
        return this.selectAnswers.shift();
      },
      capabilities: {
        status: !headless,
        surface: !headless,
      },
    };
  }

  get questionCalls(): SelectCall[] {
    return this.selectCalls.filter((call) => call.title !== APPROVAL.title);
  }

  get approvalCalls(): SelectCall[] {
    return this.selectCalls.filter((call) => call.title === APPROVAL.title);
  }

  addCommand(command: RegisteredCommand): Disposable {
    this.command = command;
    return { dispose: () => {} };
  }

  /** Invokes `/naildown <args>` exactly the way the host does: awaited, with `{args, ui, cwd}`. */
  async run(args = ''): Promise<string> {
    if (!this.command) throw new Error('FakeHost: no command registered');
    const context: CommandContext = { args, ui: this.ui, cwd: this.cwd };
    const result = (await this.command.handler(context)) as CommandResult | void;
    return result?.message ?? '';
  }
}
