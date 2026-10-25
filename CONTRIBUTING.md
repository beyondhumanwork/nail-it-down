# Contributing

Thanks for helping make Nail It Down reliable and useful.

**Project status:** pre-alpha. The product contract is still under review; please start with an issue before proposing major new capabilities.

## Before contributing

- Read the [README](README.md), [draft specification](docs/PRODUCT_SPEC_DRAFT.md), [architecture](docs/ARCHITECTURE_DECISIONS.md), and [agent rules](AGENTS.md).
- Check [open issues](https://github.com/beyondhumanwork/nail-it-down/issues) for current scope and known limitations.
- For significant changes, propose a narrowly scoped issue describing the problem, approach, alternatives and acceptance criteria.


## Pull requests

1. Use a topic branch and submit a focused PR.
2. Explain **why** the change is needed, not just what changed.
3. Include tests or explain precisely why they were not run. Never imply unexecuted checks passed.
4. For Command Code behavior, include exact host version, OS/mode, reproduction steps and observed result.
5. Include privacy, dependencies and compatibility impacts where relevant.
6. Don't introduce paid services, automatic CI, telemetry, or installation scripts without prior discussion.

The maintainers may request changes or decline contributions that exceed the current milestone, even if they are useful features.

## Development environment

M0 established the toolchain. It uses Node's built-in test runner and type stripping, so the mod has **no runtime dependencies**:

```bash
npm install          # devDependencies only: typescript, @types/node
npm run typecheck    # tsc --noEmit
npm test             # node --test test/*.test.ts
```

Node 22.18 or newer is required to run the TypeScript tests without a build step. The mod itself loads through Command Code's own TypeScript loader, so it needs no build step either:

```bash
cmd --mod ./src/index.ts
```

[`docs/M0_EVIDENCE.md`](docs/M0_EVIDENCE.md) records the tested Command Code version, the interactive smoke test, and the host API limitations found during M0.

`src/host/modApi.ts` is a hand-written description of the host surface this mod uses, because the `@commandcode/harness` package the official docs reference is not published to npm. If you touch the adapter, check it against the installed host and note the version you used.

## Attribution

Only submit code and assets you have rights to contribute. If you adapt MIT/other licensed works, preserve required notices and document the upstream work in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Security reports

Do not disclose vulnerabilities, exploits, or credentials in public issues. Follow [SECURITY.md](SECURITY.md).

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
