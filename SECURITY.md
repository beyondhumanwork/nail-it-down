# Security policy

## Supported versions

**None yet.** Nail It Down is pre-alpha and has not been released or security-audited.

## Reporting a vulnerability

Please **do not post exploit details, private source, credentials, or sensitive logs in public issues**.

Use GitHub's **Report a vulnerability** feature under this repository's **Security** tab **if it is enabled**. If that private reporting feature is not available, open a *minimal, non-sensitive* issue requesting a private disclosure channel without describing the exploit. Maintainers will coordinate a suitable private route.

Please include affected version/commit, steps to reproduce, impact, and a proof of concept only through an agreed private channel.

## Security expectations

Future releases will be reviewed for permission boundaries, prompt-injection resilience, secret handling, scoped storage, dependency safety, and consent-gated exports. Because Command Code mods can execute trusted code, installing a mod should be treated as a code-execution trust decision.

A published MIT license does **not** imply a security warranty.
