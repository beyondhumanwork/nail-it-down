# How Nail It Down speaks

The code can be correct and the writing can still be wrong.

Suppose the mod asks, "Please specify the desired ownership model for the proposed subscription architecture." It has asked a real question. But it has made the user do unnecessary work to understand it.

Ask "Who pays for the subscription?" instead.

The difference isn't decoration. The second question makes it easier to think about the problem. That's what the writing in Nail It Down should do.

This guide applies to the README, help text, menus, questions, explanations, confirmations, errors, examples, release notes, and prose the mod asks a model to generate. The instructions are for **original writing**. They are not a request to reproduce another writer's sentences or make claims of authorship.

## The voice

**Simple.** Use ordinary words. The writing should sound like an experienced programmer explaining something to another person, not a department writing a policy.

**Conversational.** Write what you could reasonably say out loud. Contractions are fine. Rhetorical questions are useful when they lead to a real point.

**Curious.** Find what's strange or incomplete about an idea. Ask why something is needed before asking how to implement it.

**Skeptical.** A proposal is not a fact. An answer is not necessarily a good answer. Show the weaknesses of the obvious approach without trying to win an argument.

**Concrete.** Use the smallest example that makes a consequence visible. "If the workspace pays, what happens when the owner leaves?" is more useful than "Consider subscription lifecycle edge cases."

**Economical.** Keep the words that help; remove those that don't. Some ideas deserve a paragraph. A cancel button doesn't.

**A little dry.** Understatement or understated humor can help when it's natural. Don't add jokes to security warnings or important confirmations.

## How to write an explanation

A useful pattern is:

1. Start with a fact, question, or observation.
2. Show why the obvious answer may not be enough.
3. Use a concrete example or consequence.
4. End with the specific decision the user needs to make.

Don't use this as a fixed template. Most UI messages need only a sentence or two.

### Original examples

**Explaining a question**

> Who owns the subscription?
>
> It may sound like a small detail. But if a workspace pays, you need to decide what happens when people join or leave it.

**Challenging a premise**

> Why build a new settings page?
>
> There's already one in this project. Is something missing from it, or do you want a different way to organize settings?

The second sentence must not claim an existing page unless the mod actually verified it.

**Showing an assumption**

> I'm assuming teams share one subscription. You haven't decided that yet. Should we settle it before going further?

**Making a recommendation**

> I'd start with one plan. Three plans may look more flexible, but they also mean three sets of upgrade and downgrade rules.

**Showing a trade-off**

> A shorter grace period is simpler. But users may lose access before they have a chance to fix a failed payment.

**A saved answer**

> Saved. We'll treat the workspace as the subscriber.

Show this only after the host has confirmed the write. The choice must really be the user's answer.

**A failed save**

> I couldn't save that answer. You can try again. I won't pretend it went through.

**Resuming**

> We settled who pays. We still need to decide what happens when a payment fails.

Only say this when the restored state supports it.

**Approval**

> You've approved this brief. No code has been changed.

Approval of a brief is not permission to implement it.

## What to avoid

- Inflated words: *leverage, streamline, comprehensive, robust, seamless, empower, innovative, revolutionary*.
- Generic praise: *Great question! Amazing idea! Excellent choice!*
- Corporate introductions: *In today's fast-paced development landscape...*
- Unnecessary abstractions: *subscription ownership strategy* when *who pays* will do.
- False certainty: *We've checked everything* after checking only a few files.
- Performance of skepticism: contrarian questions asked merely to sound clever.
- Long explanations before simple yes/no choices.
- Forced analogies, jokes, philosophical digressions or invented stories.
- Copying user inputs into a prettier but less accurate form.

A good test is whether the sentence would still be useful if it were stripped of all its style.

## Different surfaces need different lengths

| Surface | Default approach |
| --- | --- |
| README | Short essay-like introduction, concrete scenario, then honest project status and links |
| Product help | Explain what it does and when to use it in plain words |
| Question | One clear decision, followed by the reason it matters |
| Recommendation | State a preference, its basis, and an important trade-off |
| Error | What failed, whether anything was saved or changed, and what to do |
| Consent | Precisely what will be read, sent, saved or changed; straightforward Yes/No |
| Saved brief | Clear headings and useful prose; exact user decisions and source evidence preserved |
| Security/privacy docs | Accuracy, specific boundaries and completeness ahead of compactness |
| Code, schemas, API references | Standard technical terminology; no essay-like embellishment |

Never soften a security or privacy warning to maintain a conversational mood.

## Model-generated writing

Not all of Nail It Down's future questions will be hard-coded. Some will be generated by the model the user has chosen.

When model completions are introduced **after M0**, the mod should pass a short, original writing instruction in its own request. The mod should not alter the coding agent's global personality, intercept other responses, or send another model request merely to rewrite a sentence.

### Proposed mod-owned instruction

```text
Write as a thoughtful, practical programmer speaking to another person.
Use simple conversational English. Be concise, but explain the
consequence of an important choice. Ask specific questions, not broad
surveys. Question assumptions where there's a good reason.
Prefer concrete examples to abstract claims. Avoid praise, slogans,
corporate jargon, and forced cleverness.

Separate confirmed facts from user statements and suggestions.
Don't claim to have checked files or run tests unless the supplied
evidence establishes that. Preserve the meaning of the user's answers.
Return only the requested structured fields.
```

This is a **proposal**, not an instruction currently running in the mod. Models may follow it differently. Schema validation, deterministic state, honest error messages and user review are required regardless of tone.

## What not to rewrite

User-provided goals and answers; citations; exact quotes from project files; code; paths; logs; legal notices; version numbers; command outputs; or test evidence. If technical language is required for accuracy, use it and explain it.

## Review checklist

Before merging a user-facing change, ask:

1. Would an intelligent stranger understand this without the codebase in front of them?
2. Does the first sentence say something useful?
3. Is there a hidden assumption that should be made visible?
4. Are the facts, guesses, recommendations, and user decisions kept separate?
5. Does the text explain what happens if the user agrees?
6. Could it be shorter without losing meaning?
7. Would the message remain accurate on failure, cancellation, or a different model?

For eventual generated copy, run a small fixed evaluation set across different model configurations. Grade clarity, specificity, factual fidelity, brevity, useful skepticism, and consent correctness. The most elegant false statement still fails.
