# Option A decision (2026-10-28)

The owner approved using the cooperative local-workspace threat model to **develop** M2 Slice 3B2. The owner acknowledged the existing parent-directory replacement race: the Node reader does not protect against hostile concurrent filesystem modifications.

This does not authorize reading any actual repository, integration into the installed `/naildown` mod, or a release. The next authorized work is **dormant integration code tested on disposable synthetic workspaces**. A later real-workspace canary requires a separate explicit authorization naming the workspace.

See `docs/M2_REAL_WORKSPACE_SECURITY_DECISION.md` for the proposed architecture and residual risks.
