# M0 interface copy

**Status:** Proposed static strings for the M0 host feasibility test. No mod has been implemented.

M0 is a technical test, not the finished interview. Its words should be clear enough that users understand that distinction. Keep the questions and system messages separate from user input and actual stored state.

For implementation: follow [the writing guide](WRITING_GUIDE.md) and keep copy in a small, reviewable module or constants object. **Do not add a model call just to write UI text.** Commands, error states and confirmation semantics are specified in [M0 handoff](M0_HANDOFF.md).

| Context | Proposed user-visible copy | Condition |
| --- | --- | --- |
| Command help | `Nail down an idea before you build it.` | Command registration |
| No goal | `What do you want to build? Try /naildown followed by your idea.` | Goal missing |
| Starting | `You want to build: {goal}\nBefore going further, one question.` | New interaction |
| Hard-coded question | `Who is this for?` | Initial interactive input |
| Why the question matters | `It helps to know who's supposed to benefit before deciding how to build it.` | Explanation in prompt, if host UI supports it |
| Stored answer | `Saved. This is for {answer}.` | Only after awaited persistence succeeds |
| Cancelled question | `Stopped. Nothing new was saved.` | Cancelled before a new write |
| Save failed | `I couldn't save that answer. You can try again.` | Store write rejected |
| Status title | `Here's what we have so far.` | Valid stored session |
| Status goal | `Goal: {goal}` | Exact user goal, unaltered |
| Status answer | `Who it's for: {answer}` | Confirmed restored answer |
| Missing answer | `Who it's for: Not decided yet` | No confirmed answer |
| Resume missing | `There's nothing to resume in this workspace yet.` | No valid stored session |
| Test confirmation | `Approve this test? This won't start coding.` | Dummy approval, default No |
| Explicitly denied | `Not approved. No code was changed.` | Approval returned false |
| Approved dummy test | `Test approved. No code was changed.` | Only if actual affirmative confirmation |
| Unsupported headless | `This question needs an interactive session. Nothing was approved.` | When headless cannot answer |
| Corrupt or outdated data | `I couldn't read the saved answer safely. Nothing was changed.` | Invalid version or stored value |

## Behavior matters more than phrasing

The text above is a design baseline, not an unconditional promise. Never claim a write succeeded when the host did not confirm it. Do not show a restored answer if state validation fails. Use the user's exact goal and answer without adding false detail.

The M0 implementation must not add an LLM, inspect the user's repository, generate a full brief, or describe the technical spike as a finished product. Any differences forced by tested host API capabilities belong in the PR evidence.

## Later milestones

Future model-generated questions should make their **reason** and **consequence** clear while using ordinary words. That behavior is defined by [the writing guide](WRITING_GUIDE.md), not by rewriting the whole coding agent's output.
