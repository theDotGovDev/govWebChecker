import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { presenceOf, PRESENCE_RULE } from '../../src/census/presence.js';
import type { Observation } from '../../src/record/types.js';

function row(overrides: Partial<Observation> = {}): Observation {
  return {
    schema: '1',
    run_id: '2026-08-22T04:00:00Z/availability',
    target_id: 'alamosa.gov',
    host: 'alamosa.gov',
    url: 'https://alamosa.gov/',
    dimension: 'availability',
    checked_at: '2026-08-22T04:00:00Z',
    outcome: 'success',
    status_code: 200,
    redirect_chain: [],
    latency: { samples: 1, median_ms: 100, min_ms: 100, max_ms: 100 },
    method: {
      vantage: 'test',
      timeout_ms: 15_000,
      sample_count: 1,
      tool_version: '0.1.0',
      source: 'self_run',
    },
    resolution: { status: 'address', apex: true, www: true },
    ...overrides,
  };
}

/**
 * The largest correctness risk in the census, and it is a reputational risk to
 * real jurisdictions rather than a technical one.
 *
 * 1,807 registered `.gov` domains — one in nine — publish no web address at all.
 * A census that cannot tell "this government never published a website" from
 * "this government's website is down" publishes 1,807 accusations every cycle.
 */
describe('reading whether a website exists (FR-116, FR-118)', () => {
  test('resolves and answers 200 -> website', () => {
    assert.equal(presenceOf(row()).state, 'website');
  });

  test('resolves only at www and answers -> website', () => {
    const r = row({ resolution: { status: 'address', apex: false, www: true } });
    assert.equal(presenceOf(r).state, 'website');
  });

  test('resolves and answers 500 -> website, not absent', () => {
    // A site returning an error HAS a website; it is broken. Reading this as
    // absence would erase the difference the feature exists to draw.
    const r = row({ outcome: 'http_error', status_code: 500 });
    assert.equal(presenceOf(r).state, 'website');
  });

  test('resolves and is blocked -> website', () => {
    // A 403 to our User-Agent is a fact about access. Something is there.
    const r = row({ outcome: 'blocked', status_code: 403 });
    assert.equal(presenceOf(r).state, 'website');
  });

  test('mail service only -> no_website', () => {
    const r = row({
      resolution: { status: 'mail_only', apex: false, www: false, codes: ['ENODATA'] },
      outcome: 'dns_failure',
    });
    delete (r as { status_code?: number }).status_code;
    assert.equal(presenceOf(r).state, 'no_website');
  });

  test('name exists but publishes nothing -> no_website', () => {
    const r = row({
      resolution: { status: 'no_service', apex: false, www: false, codes: ['ENODATA'] },
      outcome: 'dns_failure',
    });
    assert.equal(presenceOf(r).state, 'no_website');
  });

  test('name does not exist -> no_website', () => {
    const r = row({
      resolution: { status: 'nxdomain', apex: false, www: false, codes: ['ENOTFOUND'] },
      outcome: 'dns_failure',
    });
    assert.equal(presenceOf(r).state, 'no_website');
  });

  test('our resolver failed -> undetermined, never no_website', () => {
    // FR-121. We do not know, and the record must say we do not know rather than
    // asserting something about the jurisdiction on the strength of our own
    // failure. Measured at 2.3% of the registry.
    const r = row({
      resolution: { status: 'resolver_error', apex: false, www: false, codes: ['ESERVFAIL'] },
      outcome: 'dns_failure',
    });
    assert.equal(presenceOf(r).state, 'undetermined');
    assert.notEqual(presenceOf(r).state, 'no_website');
  });

  test('resolves but the connection was refused -> undetermined', () => {
    // An address exists, so something is published there; we could not reach it.
    // Calling that absent would be a claim we have no evidence for.
    const r = row({ outcome: 'connection_failure' });
    delete (r as { status_code?: number }).status_code;
    assert.equal(presenceOf(r).state, 'undetermined');
  });

  test('resolves but TLS failed -> undetermined', () => {
    // The canonical URL rule is https-only (research.md R4), so an https failure
    // is recorded as a transport fact. It is not evidence that nothing is there.
    const r = row({ outcome: 'tls_failure' });
    delete (r as { status_code?: number }).status_code;
    assert.equal(presenceOf(r).state, 'undetermined');
  });

  test('a redirect away from the domain still counts as a website', () => {
    const r = row({
      redirect_chain: ['https://alamosa.gov/'],
      url: 'https://alamosa.gov/',
    });
    assert.equal(presenceOf(r).state, 'website');
  });

  test('a skipped target is undetermined — we never looked', () => {
    const r = row({ outcome: 'skipped', skip_reason: 'robots.txt disallows this path' });
    delete (r as { status_code?: number }).status_code;
    assert.equal(presenceOf(r).state, 'undetermined');
  });

  test('a row with no resolution at all is undetermined', () => {
    const r = row();
    delete (r as { resolution?: unknown }).resolution;
    assert.equal(presenceOf(r).state, 'undetermined');
  });

  test('every reading names the rule that produced it', () => {
    assert.equal(presenceOf(row()).rule, PRESENCE_RULE);
    assert.match(PRESENCE_RULE, /^presence\/\d+$/);
  });
});

/**
 * FR-119 in executable form.
 *
 * A better rule must be applicable to observations already stored, yielding a
 * revised reading without any target being checked again. That is only true if
 * the reading is a pure function of a stored row — anything reaching outside it
 * (a live lookup, a cache, the frame) makes history unrecomputable the moment
 * that outside thing changes.
 */
describe('the reading recomputes over stored history (FR-119)', () => {
  test('is computed from a hand-written row, with no check involved', () => {
    const stored = row({
      resolution: { status: 'mail_only', apex: false, www: false, codes: ['ENODATA'] },
      outcome: 'dns_failure',
    });
    assert.equal(presenceOf(stored).state, 'no_website');
  });

  test('takes exactly one argument — the observation', () => {
    // Structural, not stylistic. A second parameter is a door for the reading to
    // depend on something that is not in the record, and the guarantee dies
    // quietly the first time someone walks through it.
    assert.equal(presenceOf.length, 1);
  });

  test('does not mutate the row it reads', () => {
    const stored = row();
    const before = JSON.stringify(stored);
    presenceOf(stored);
    assert.equal(JSON.stringify(stored), before, 'observations are immutable (Principle IV)');
  });

  test('is stable — the same row always reads the same way', () => {
    const stored = row({ outcome: 'http_error', status_code: 503 });
    const first = presenceOf(stored);
    for (let i = 0; i < 5; i++) assert.deepEqual(presenceOf(stored), first);
  });
});
