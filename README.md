<div align="center">

# Nail It Down

### Before you build something, figure out what it is.

A planned [Command Code](https://commandcode.ai/) mod that catches expensive decisions before your coding agent turns them into code.

![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange?style=flat-square)
![Built for Command Code](https://img.shields.io/badge/built%20for-Command%20Code-black?style=flat-square)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

[How it works](#how-it-would-work) · [Privacy](#what-it-wont-do) · [Status](#where-things-stand) · [Contributing](#contributing)

</div>

---

> [!WARNING]
> **Pre-alpha. Not installable yet.** We're proving the basic integration with Command Code. Everything below describes what we plan to build, not what exists.

## The problem

Coding agents have made code cheap to write. Deciding what to write is as hard as it ever was.

Say you tell an agent to add subscriptions to your app. It will build a billing flow, and probably a decent one. But there's a question it may never ask: **who is the subscriber?**

A person? A team? A company? These sound like the same feature. They aren't. The answer determines who pays, who has access, and what happens when someone leaves a team.

The agent will pick one anyway, and it won't tell you. By the time you find out, the decision is code.

Nail It Down exists to catch these decisions while they're still cheap to change.

## How it would work

You start with a rough idea. Nail It Down asks the questions that matter, tells you why each one matters, and keeps track of your answers.

Sometimes the most useful question is whether to build the thing at all. You may be about to rebuild a feature you already have, or spend a week on a problem a small change would fix. A good collaborator would say so. It's a waste to plan the wrong thing carefully.

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

<sub>*Illustrative dialogue, not a recording of a working mod.*</sub>

You can change your mind, come back later, or ask what's still undecided. When the important questions are settled, the mod writes a brief that another developer or coding agent can build from.

The brief separates **what you decided** from **what the agent merely suggested**, and it lists what's still unknown. A good spec doesn't make uncertainty go away. It makes it visible.

## What about the codebase?

Sometimes the answer is already in the code. If you've built workspace membership, the mod shouldn't ask whether workspaces exist.

So, if you allow it, it can read a limited set of files and ask only about the choices the code can't answer. You can also use it without giving it repository access at all. Either way, it never treats something it hasn't checked as fact.

## What it won't do

Nail It Down decides what to build. It doesn't build it.

| It will | It won't |
| :--- | :--- |
| Ask the questions that prevent expensive misunderstandings | Edit your code |
| Explain why each question matters | Run project commands |
| Inspect a limited set of files, only if you allow it | Deploy anything |
| Produce a brief that separates decisions from suggestions | Treat approval of a brief as permission to implement it |

> [!NOTE]
> **Privacy, as designed.** Repository inspection is optional and bounded, and there's no separate telemetry service. When future versions ask a model to reason about your project, relevant inputs or approved snippets may go to your configured model provider and count against your usage. Saved state stored by the host shouldn't be assumed to be encrypted. None of these safeguards are implemented or verified yet.
>
> Details: [Privacy](docs/PRIVACY.md) · [Security](SECURITY.md)

## Where things stand

We're working on **M0**, the smallest useful test: can Command Code load `/naildown`, ask a question, save the answer, and recover it after a restart?

That's all for now. We'll publish installation instructions once something works.

The work is public:

- 🗺️ [Roadmap](docs/ROADMAP.md)
- 📝 [Product specification (draft)](docs/PRODUCT_SPEC_DRAFT.md)
- 🧱 [Architecture decisions](docs/ARCHITECTURE_DECISIONS.md)
- ✅ [M0 acceptance tests](docs/M0_ACCEPTANCE.md)

## Contributing

The goal isn't to ask as many questions as possible. It's to ask the fewest that prevent an expensive misunderstanding.

If you'd like to help, read [CONTRIBUTING.md](CONTRIBUTING.md) or [open an issue](https://github.com/beyondhumanwork/nail-it-down/issues).

<details>
<summary><strong>Prior art and licensing</strong></summary>

<br>

This project is informed by existing open-source planning skills, including [the grilling workflow](https://github.com/mattpocock/skills). The implementation is independently written, and any adapted third-party material gets the notices its license requires.

See [research](docs/COMPETITIVE_AND_LICENSE_RESEARCH.md) and [third-party notices](THIRD-PARTY-NOTICES.md).

</details>

---

<div align="center">

Maintained by [Beyond Human Work](https://github.com/beyondhumanwork) · [MIT licensed](LICENSE)

</div>
