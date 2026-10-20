# How Nail It Down writes

**Status:** Editorial standard for project-owned text. This is not a runtime feature and is not a claim that every model will produce the same prose.

We want a mod that sounds like a good technical collaborator: plainspoken, curious, precise, and willing to question an assumption. Users should understand what is being asked, why it matters, and what will happen next.

This standard takes inspiration from the general writing principles described in Paul Graham's [Write Simply](https://paulgraham.com/simply.html) and [How to Write Usefully](https://paulgraham.com/useful.html). Write **original** prose; do not imitate his distinctive voice, quote or paraphrase long essay passages, suggest his involvement, or ship the essay excerpts supplied in an external example prompt.

## The rules

1. **Say the thing plainly.** Prefer ordinary nouns and verbs. Avoid inflated language, jargon, corporate slogans and needless labels.
2. **Start with the point.** Make the first sentence useful. Explain the reasoning in the next sentence if necessary.
3. **Ask one real question at a time.** If two decisions depend on each other, settle the first one before asking the second.
4. **Explain why the question matters.** A user should know what changes if they choose differently.
5. **Challenge ideas without being adversarial.** Point out assumptions and simpler alternatives. Never mock users or turn questions into a performance.
6. **Distinguish facts from guesses.** Say what was checked, what came from the user, and what is still unknown. Don't claim something was scanned, tested, saved or approved unless it was.
7. **Be brief, not cryptic.** A modal can use one or two sentences. A security or privacy notice may need more.
8. **Use a human tone without flattery.** No synthetic excitement, patronizing reassurances, roleplay or sales language.
9. **Be accurate before being elegant.** Do not shorten warnings in a way that hides danger, cost, consent, limitations or reversibility.
10. **Keep product terminology stable.** A decision is a decision. A suggestion is a suggestion. A reviewed brief is not permission to implement code.

## Examples (original copy, not shipped functionality)

| Situation | Avoid | Prefer |
| --- | --- | --- |
| First question | Please specify your preferred subscription ownership strategy. | Who pays for the subscription: a person or a workspace? |
| Reason | This is critical for downstream billing architecture decisions. | This decides who gets billed when someone joins or leaves a team. |
| Premise check | Assess the necessity of this feature before proceeding. | Do you need a new feature, or could the existing one do the job? |
| Unknown fact | No billing system was found. | I haven't checked whether billing already exists. |
| Recommendation | We strongly recommend implementing option B. | I'd choose B. It fits the existing workspace model, though it means handling team changes. |
| Resume | Your workflow has successfully been restored. | You're back where you left off. Two decisions are still open. |
| Save failure | Persisting state failed due to an unexpected error. | I couldn't save that answer. Nothing was marked as saved. |
| Approval | Congratulations! Your plan is finalized and implementation ready. | You've approved the brief. No code has been changed. |
| Cancellation | Action cancelled successfully. | Stopped. Your earlier answers are still here. |
| Unavailable model | We are unable to perform this operation. | The model isn't available. Your answers are still saved. |

Examples must be adapted to actual state. Never show "your earlier answers are still here" unless they have been durably persisted.

## Which writing belongs to the product?

**Public-facing, written by us:**
- README opening, release notes and public explanations;
- onboarding, commands, help descriptions and examples;
- menu labels, question framing, error and confirmation messages;
- issue and PR templates, contribution guidance, privacy and security notices;
- snippets and templates used in exported briefs;
- prompts we explicitly own and supply to the mod's model call.

**Technical material may use standard terminology:** licenses, protocol names, API/type signatures, schemas, security rules, diagnostics, configuration keys, test evidence and normative acceptance criteria. Clarity is more important than a uniform "voice" in these documents.

**Do not rewrite:** user-submitted goals and answers, code, file paths, source excerpts, third-party licenses, tool stdout/stderr, or accurate technical terms merely to fit an editorial voice.

## Runtime implementation plan

The first version of the mod is M0, a **no-model** host-feasibility slice.

**M0 — static copy only**
- Keep all visible strings in a small, reviewable copy module or equivalent constants.
- Use plain wording for the one hard-coded question, `status`, `resume`, save errors and dummy approval.
- Never introduce a model merely to polish a fixed string.
- Test messages against actual stored state and default-deny behavior.

**M1–M2 — domain logic and optional context**
- Maintain deterministic statuses, evidence and user approval regardless of wording.
- Do not let a writing guideline override consent or data bounds.

**M3 onward — model-generated questions and explanations**
- Use `cmd.model.complete({ system, prompt, ... })` for mod-owned completions **after verifying the installed host API**.
- Provide a short *original* instruction containing this guide's principles, the job of the output, and a few brief original examples only when necessary.
- Request structured fields for question, why-it-matters, options, consequence and recommendation; validate schema before presentation.
- Do not insert a 52 KB essay prompt, publish copyrighted examples, intercept the entire assistant's responses, or add an always-on global style hook.
- Keep UI templates and decision state independent of model-generated text.
- Do not promise uniform tone across the user's selected models. On failures, use clear deterministic messages.

**M4 onward — brief generation**
- Use fixed headings and data-backed facts; allow the model to draft only prose fields that need it.
- Preserve the exact meaning of confirmed user answers. Separate facts, decisions, assumptions and open questions.
- The user can review and edit before approval; style never changes the approval snapshot.

## Editorial checks at review

Read the result as someone who has never seen the code. Can they answer:
- What is being asked or reported?
- Why does it matter?
- What was actually checked?
- What changes if they agree or refuse?
- What has been saved or sent, and to whom?

Also reject:
- sweeping confidence claims, invented progress or promotional adjectives;
- unnecessary acronyms and repetitive filler;
- patronizing or hostile challenges;
- unclear choices, hidden side effects and euphemistic security errors;
- text that imitates or reproduces another author's recognizable writing.

Test sample outputs across at least two materially different model configurations at a later milestone. Score *clarity, accuracy, concision, fidelity to user decisions, and helpful challenge* separately. A fluent answer that invents a fact fails.

## References

- Paul Graham, [Write Simply](https://paulgraham.com/simply.html), March 2021.
- Paul Graham, [How to Write Usefully](https://paulgraham.com/useful.html), February 2020.
- [Command Code Mods API](https://commandcode.ai/docs/mods), including model completions and UI.
- [OpenAI prompt engineering guidance](https://developers.openai.com/api/docs/guides/prompt-engineering), including model differences and evaluation.

These links are inspiration and background, not endorsement or a license to republish essays.
