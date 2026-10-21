# Changelog

All notable released changes will be recorded here.

## Unreleased

- Established public project documentation, architecture proposals, contribution guidelines and M0 development plan.
- Implemented the M0 host-feasibility mod: `/naildown <idea>` registers one hard-coded question, saves the confirmed answer through `cmd.store`, recovers it after a restart, keeps state per workspace, and refuses to record approval unless it is explicitly given. No model calls, repository access or process execution.
- Added 57 unit tests and a typecheck (`node --test`, `tsc --noEmit`).
- Recorded M0 results for Command Code 1.84.0 in `docs/M0_EVIDENCE.md`: eleven acceptance checks pass, and the headless check is blocked because `cmd -p` does not dispatch mod slash commands.
- **Not published, not installable from npm, no release yet.** M1 is not authorized.
