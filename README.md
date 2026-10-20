# Nail It Down

**Before you build something, make sure you know what it is.**

Coding agents have made it cheap to write code. They've done less to make it cheap to figure out which code to write.

Suppose you tell an agent to add subscriptions to your app. It can probably build a billing flow. But there's a question it might never ask: who is the subscriber?

Is it each person who signs up? A team? A company? These sound like variations on the same feature. They aren't. The answer affects who pays, who has access, and what happens when someone leaves a team.

The dangerous part is that the agent can make these choices without telling you. By the time you discover them, they're code.

Nail It Down is a planned [Command Code](https://commandcode.ai/) mod for catching those decisions *before* implementation.

> **Pre-alpha. Not installable yet.** We're proving the basic integration with Command Code. The behavior below is planned, not shipped or tested.

## How it would work

You start with a rough idea. Nail It Down asks the questions that matter, explains why they matter, and keeps track of your answers.

Sometimes it should challenge the idea itself. You may be about to build a feature that already exists, or solve a problem that could be fixed with something much smaller. A useful assistant ought to notice that. There's not much value in carefully planning the wrong thing.

### An example

```text
/naildown Add subscriptions to my app

Who pays for a subscription?
  1. Each person
  2. Each workspace
  3. Something else

Why it matters:
If the workspace pays, people can join and leave
without each needing their own subscription.

Choose an answer, or tell me what I've missed.
```

*Illustrative dialogue. This is not a real recording of a working mod.*

You could then change your mind, return later, or ask what remains undecided. When the important questions are settled, the mod would produce a brief that another developer or coding agent could use.

The brief should distinguish what you decided from what the agent merely suggested. It should also say what is still unknown. A good specification doesn't make uncertainty disappear. It makes uncertainty visible.

## What about the codebase?

Sometimes the answer is already in the project.

If you've already built workspace membership, the mod shouldn't quiz you about whether workspaces exist. It should be able to inspect a limited set of files **if you allow it**, then ask about the choices the code can't answer.

You should be able to use it without granting repository access at all. And it should never treat something it hasn't checked as a verified fact.

## What it won't do

Nail It Down is for deciding what to build. It isn't meant to build it.

It won't automatically edit your code, run project commands, deploy anything, or treat approval of a brief as permission to implement it.

The design calls for optional, bounded repository inspection and no separate telemetry service. When future versions ask a model to reason over project context, relevant user inputs or approved snippets may go to the configured model provider and consume usage. Host-backed saved state should not be assumed encrypted. Those safeguards still need to be implemented and verified.

See [privacy](docs/PRIVACY.md) and [security](SECURITY.md).

## Where things stand

Right now we're working on **M0**, the smallest useful technical test: can Command Code load `/naildown`, ask a question, save an answer, and recover it after restarting?

There are no model calls in M0. No npm package has been published, and there isn't a verified installation command.

The work is public:

- [Roadmap](docs/ROADMAP.md)
- [Product specification (draft)](docs/PRODUCT_SPEC_DRAFT.md)
- [Architecture decisions](docs/ARCHITECTURE_DECISIONS.md)
- [M0 acceptance tests](docs/M0_ACCEPTANCE.md)

## Contributing

The goal isn't to ask the maximum number of questions. It's to ask the smallest number that prevents expensive misunderstandings.

We're building the first version with [Pi](https://pi.dev/) and testing it in Command Code. New code will be reviewed before it reaches `main`. There is no automatic CI or publishing while we're still testing the host integration.

If you'd like to help, see [CONTRIBUTING.md](CONTRIBUTING.md) or [open an issue](https://github.com/beyondhumanwork/nail-it-down/issues).

This project is informed by existing open-source planning skills, including [the grilling workflow](https://github.com/mattpocock/skills). The implementation is intended to be independently written. Any adapted third-party material will receive the notices its license requires. See [research](docs/COMPETITIVE_AND_LICENSE_RESEARCH.md) and [third-party notices](THIRD-PARTY-NOTICES.md).

Maintained by [Beyond Human Work](https://github.com/beyondhumanwork). [MIT licensed](LICENSE).
