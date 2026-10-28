import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CONSENT_LABELS,
  CONSENT_TITLE,
  consentDisclosure,
  consentOptions,
  isGranted,
  requestRepositoryReadConsent,
} from '../src/host/repositoryConsent.ts';
import type { ModUi } from '../src/host/modApi.ts';
import { DEFAULT_BUDGET, selectCandidates } from '../src/core/discovery.ts';
import type { RepositoryReader } from '../src/core/discovery.ts';

/** A UI stub that records the dialog it was asked to show. */
function uiReturning(answer: string | undefined, options: { surface?: boolean; throws?: boolean } = {}): ModUi & { calls: Array<{ title: string; options: readonly { label: string; description?: string }[] }> } {
  const calls: Array<{ title: string; options: readonly { label: string; description?: string }[] }> = [];
  return {
    calls,
    select: async (input) => {
      calls.push({ title: input.title, options: input.options });
      if (options.throws === true) throw new Error('dialog exploded with /home/ahmed/private/path');
      return answer;
    },
    capabilities: { status: options.surface ?? true, surface: options.surface ?? true },
  };
}

/** A reader that fails the test if anything asks it for bytes. */
function tripwireReader(): RepositoryReader & { touches: number } {
  const reader = {
    touches: 0,
    list: () => {
      reader.touches += 1;
      return [];
    },
    read: () => {
      reader.touches += 1;
      return { kind: 'missing' as const };
    },
  };
  return reader;
}

describe('consent: refusal is the default', () => {
  it('lists the refusal first, so the pre-highlighted option refuses', () => {
    const options = consentOptions();
    assert.equal(options[0].label, CONSENT_LABELS.refuse);
    assert.equal(options[1].label, CONSENT_LABELS.grant);
    assert.match(options[0].description, /safe answer/);
  });

  it('states the limits and that nothing is sent to a model in this slice', () => {
    const [refuse, grant] = consentOptions();
    assert.match(grant.description, new RegExp(String(DEFAULT_BUDGET.maxFiles)));
    assert.match(grant.description, /KiB/);
    assert.match(grant.description, /not sent to a model|Nothing read this way is sent to a model/);
    assert.match(consentDisclosure(), /package\.json/);
    assert.match(consentDisclosure(), /No repository content is sent to a model/);
    // The refusal option does not need to repeat the disclosure.
    assert.ok(refuse.description.length > 0);
  });

  it('grants only on the exact grant label', async () => {
    const outcome = await requestRepositoryReadConsent(uiReturning(CONSENT_LABELS.grant));
    assert.equal(outcome.kind, 'granted');
    assert.equal(isGranted(outcome), true);
  });

  const refusals: Array<[string, string | undefined, string]> = [
    ['the refusal label', CONSENT_LABELS.refuse, 'refused-by-choice'],
    ['a dismissal', undefined, 'dismissed'],
    ['an empty string', '', 'unexpected-value'],
    ['a near-miss label', `${CONSENT_LABELS.grant} `, 'unexpected-value'],
    ['an unrelated label', 'Yes', 'unexpected-value'],
    ['an object-ish value', String(CONSENT_LABELS.grant).toLowerCase(), 'unexpected-value'],
  ];

  for (const [label, answer, reason] of refusals) {
    it(`refuses on ${label}`, async () => {
      const outcome = await requestRepositoryReadConsent(uiReturning(answer));
      assert.equal(outcome.kind, 'refused');
      if (outcome.kind !== 'refused') return;
      assert.equal(outcome.reason, reason);
    });
  }

  it('refuses headless without asking', async () => {
    const ui = uiReturning(CONSENT_LABELS.grant, { surface: false });
    const outcome = await requestRepositoryReadConsent(ui);
    assert.equal(outcome.kind, 'refused');
    if (outcome.kind !== 'refused') return;
    assert.equal(outcome.reason, 'headless');
    assert.equal(ui.calls.length, 0, 'a headless host must not be asked at all');
  });

  it('refuses when there is no UI at all', async () => {
    const outcome = await requestRepositoryReadConsent(undefined);
    assert.equal(outcome.kind, 'refused');
    if (outcome.kind !== 'refused') return;
    assert.equal(outcome.reason, 'headless');
  });

  it('refuses when the dialog throws, without disclosing the error text', async () => {
    const outcome = await requestRepositoryReadConsent(uiReturning(undefined, { throws: true }));
    assert.equal(outcome.kind, 'refused');
    if (outcome.kind !== 'refused') return;
    assert.equal(outcome.reason, 'ui-failure');
    // The reason is a closed code, so no host text or path can ride along.
    assert.doesNotMatch(outcome.reason, /home|\//);
  });

  it('asks exactly one dialog, with the disclosed title', async () => {
    const ui = uiReturning(CONSENT_LABELS.grant);
    await requestRepositoryReadConsent(ui);
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.calls[0].title, CONSENT_TITLE);
    assert.equal(ui.calls[0].options.length, 2);
  });
});

describe('consent: no read happens without a grant', () => {
  it('never causes a read, whatever the answer', async () => {
    // The helper has no reader parameter at all — this asserts the property at
    // the integration point too: a caller that gates on the outcome must not
    // touch a reader when consent is refused.
    for (const answer of [undefined, CONSENT_LABELS.refuse, 'something else']) {
      const reader = tripwireReader();
      const outcome = await requestRepositoryReadConsent(uiReturning(answer));

      assert.equal(outcome.kind, 'refused');
      if (isGranted(outcome)) {
        selectCandidates({ reader, consent: { granted: true } });
      }
      assert.equal(reader.touches, 0, `a refusal (${String(answer)}) must not read`);
    }
  });

  it('reaches the reader only when consent is granted', async () => {
    const reader = tripwireReader();
    const outcome = await requestRepositoryReadConsent(uiReturning(CONSENT_LABELS.grant));

    assert.equal(outcome.kind, 'granted');
    if (isGranted(outcome)) {
      selectCandidates({ reader: { ...reader, list: () => { reader.touches += 1; return []; } }, consent: { granted: true } });
    }
    assert.equal(reader.touches, 1, 'a grant is the only path that reaches the reader');
  });

  it('does not import a filesystem module or persist consent', () => {
    const raw = readFileSync('src/host/repositoryConsent.ts', 'utf8');
    // Scan code, not prose: the doc comment names what the module avoids.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    assert.doesNotMatch(source, /node:fs/);
    assert.doesNotMatch(source, /readFileSync|openSync|readdir/);
    assert.doesNotMatch(source, /cmd\.store/);
    assert.doesNotMatch(source, /writeFile/);
  });
});
