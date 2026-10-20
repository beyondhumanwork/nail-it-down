# Privacy design (proposed, not implemented)

Nail It Down has **no released software**. This document describes design intent, not verified runtime behavior.

- **Idea-only mode:** user-supplied problem statement and answers, without automatic filesystem scanning.
- **Repository inspection:** optional, bounded, read-only, with explicit disclosure of what may be inspected and forwarded to the user's configured model.
- **Secrets:** recognized credential files and sensitive paths should be excluded; filtering cannot guarantee that arbitrary repository content contains no secret.
- **Model requests:** users' selected providers may receive prompt content and approved snippets, and usage may be billed by that provider.
- **Persistence:** planned use of Command Code host-backed `cmd.store`. Stored content should not be assumed encrypted; export and deletion requirements will be tested.
- **No planned telemetry, background jobs, separate backend, or undisclosed outbound network calls.**
- **Exports:** only after review and a separate explicit write confirmation; no overwrite by default.

Any implementation deviating from this policy requires documentation and review before release.
