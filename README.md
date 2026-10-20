# Nail It Down

**Think it through before you build it.**

A coding agent can build the wrong thing surprisingly quickly.

You describe a feature. The agent fills in the details you left out. Some of those choices may be right. Others may be expensive mistakes. By the time you notice, there's code to undo.

Nail It Down is a planned [Command Code](https://commandcode.ai/) mod that helps you settle the important questions before the agent starts writing code.

> **Pre-alpha. Not yet installable.** We're testing whether the mod can work reliably inside Command Code. Everything described below is a goal, not a shipped feature.

## What would it do?

Suppose you ask an agent to add subscriptions to your app.

A useful first question is not which billing library to install. It's **who owns the subscription**. A person? A team? A company? The answer changes how you handle payments, access and people leaving a team.

Nail It Down is meant to notice questions like this. It should ask what matters, explain the consequences of different answers, and keep a record of what you decide.

It should also notice when you're solving the wrong problem. Sometimes the right feature is smaller than the one you first described. Sometimes you don't need a new feature at all.

### A possible conversation

```text
/naildown Add subscription billing

Who pays for the subscription?
  1. Each person
  2. Each workspace
  3. Something else

Why this matters:
If the workspace pays, people can join and leave
without each needing a separate subscription.

[Your answer is saved after you confirm it.]
```

This is **illustrative copy**, not a screenshot or verified behavior. The eventual interface may differ.

## What should happen next?

The intended workflow is simple:

1. Start with your idea. Repository access is not required.
2. If you choose, let the mod inspect a limited set of project files so it doesn't ask questions your code already answers.
3. Answer the important questions. Revisit an answer when you change your mind.
4. Review a brief that says what to build, what not to build, which choices were made, and what remains uncertain.
5. Approve the brief. Approval **does not** authorize the agent to write or change code.

We want the result to be useful to another developer or agent without pretending it can eliminate every unknown.

## What it won't do

Nail It Down is not meant to write your feature, edit your code, run commands in your project, deploy anything, or approve decisions for you.

The planned default is **no automatic repository inspection**. If later versions send selected project content to a model, the user should know what is being shared. Your configured model provider may charge for usage; local mod storage should not be assumed encrypted.

These are design commitments **waiting to be tested**, not promises about software that has already shipped. Read the [privacy design](docs/PRIVACY.md) and [security policy](SECURITY.md).

## Where the project stands

We're beginning with a small technical test, **M0**. The first thing to prove is that Command Code can load `/naildown`, ask a single question, save a confirmed answer and recover it after a restart. M0 makes no model calls.

There is no verified installation command, npm package, or release yet.

- [Roadmap](docs/ROADMAP.md)
- [Product specification — draft](docs/PRODUCT_SPEC_DRAFT.md)
- [Architecture decisions](docs/ARCHITECTURE_DECISIONS.md)
- [M0 acceptance tests](docs/M0_ACCEPTANCE.md)
- [Writing guide](docs/WRITING_GUIDE.md)

## Building it in the open

The first implementation will be written in [Pi](https://pi.dev/), tested in Command Code, and reviewed before it's merged. We aren't running automatic CI workflows or publishing packages while the basic integration is unproven.

If you'd like to help, read [CONTRIBUTING.md](CONTRIBUTING.md) or [open an issue](https://github.com/beyondhumanwork/nail-it-down/issues).

Nail It Down is inspired in part by existing open-source question-and-planning skills, including [Matt Pocock's grilling workflow](https://github.com/mattpocock/skills). We intend to write our own implementation and preserve license notices for any third-party material we later adapt. See the [research](docs/COMPETITIVE_AND_LICENSE_RESEARCH.md) and [third-party notices](THIRD-PARTY-NOTICES.md).

Maintained by [Beyond Human Work](https://github.com/beyondhumanwork). [MIT licensed](LICENSE).
