import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { listings, domainGroups, renderListing, renderDomainGroup } from '../../src/site/listing.js';
import type { Observation } from '../../src/record/types.js';

function row(host: string, overrides: Partial<Observation> = {}): Observation {
  return {
    schema: '1',
    run_id: 'r1',
    target_id: host.replace(/\./g, '-'),
    host,
    url: `https://${host}/`,
    dimension: 'availability',
    checked_at: '2026-08-20T06:00:00Z',
    outcome: 'success',
    status_code: 200,
    redirect_chain: [],
    latency: { samples: 1, median_ms: 100, min_ms: 100, max_ms: 100 },
    tier: 'hot',
    method: { vantage: 'github-actions/test', timeout_ms: 15_000, sample_count: 1, tool_version: '0.1.0', source: 'self_run' },
    ...overrides,
  } as Observation;
}

describe('a listing is keyed on host, never target_id (D3, research R7)', () => {
  test('the real www.irs.gov split yields ONE listing whose history sums both ids', () => {
    // Reproduces the live record: the id scheme changed and three hosts kept
    // both ids. Keyed on target_id, www.irs.gov gets two pages each stating
    // half its sample count — an FR-201 violation made of an identity accident.
    const rows = [
      row('www.irs.gov', { target_id: 'irs-gov', run_id: 'old-1', checked_at: '2026-08-03T06:00:00Z' }),
      row('www.irs.gov', { target_id: 'irs-gov', run_id: 'old-2', checked_at: '2026-08-03T07:00:00Z' }),
      row('www.irs.gov', { target_id: 'www-irs-gov', run_id: 'new-1', checked_at: '2026-08-20T06:00:00Z' }),
    ];
    const list = listings(rows);
    assert.equal(list.length, 1, 'one host, one listing — however many ids its history spans');
    const l = list[0]!;
    assert.equal(l.host, 'www.irs.gov');
    assert.deepEqual([...l.targetIds].sort(), ['irs-gov', 'www-irs-gov'], 'provenance carried, not hidden');
    assert.equal(l.readings, 3, 'the sample count sums the whole history');
  });

  test('an undetermined listing leads with what is unknown (FR-246)', () => {
    const rows = [
      row('unreach.gov', {
        outcome: 'dns_failure',
        tier: 'broad',
        cycle: '2026-W34',
        slice: 1,
        latency: { samples: 0 },
        resolution: { status: 'resolver_error', apex: false, www: false, codes: ['ESERVFAIL'] },
        presence: { state: 'undetermined', rule: 'presence/1' },
      } as Partial<Observation>),
    ];
    const html = renderListing(listings(rows)[0]!).replace(/\s+/g, ' ');

    const unknownAt = html.search(/could not establish/i);
    const nameAt = html.indexOf('unreach.gov');
    assert.ok(unknownAt >= 0, 'the page must lead with what is unknown');
    assert.match(html, /says nothing about whether/i, 'our failure is not their failure');
    // The jurisdiction's name never sits beside a failure state.
    assert.doesNotMatch(html, /unreach\.gov[^.]{0,60}(down|broken|failed|failing)/i);
    assert.ok(nameAt >= 0);
  });

  test('a mail-only domain reads as having no website, never as broken (FR-213)', () => {
    const rows = [
      row('mailonly.gov', {
        outcome: 'skipped',
        skip_reason: 'no web address published (mail_only)',
        tier: 'broad',
        cycle: '2026-W34',
        slice: 1,
        latency: { samples: 0 },
        resolution: { status: 'mail_only', apex: false, www: false, codes: ['ENODATA'] },
        presence: { state: 'no_website', rule: 'presence/1' },
      } as Partial<Observation>),
    ];
    const html = renderListing(listings(rows)[0]!).replace(/\s+/g, ' ');
    assert.match(html, /no web address|publishes no website/i);
    assert.doesNotMatch(html, /down|broken|unavailable|failing/i);
  });

  test('a listing states when it was checked and at what cadence (FR-247)', () => {
    const html = renderListing(listings([row('www.usa.gov')])[0]!).replace(/\s+/g, ' ');
    assert.match(html, /2026-08-20/);
    assert.match(html, /hourly/i);
  });

  test('a listing carries the correction route (FR-240)', () => {
    const html = renderListing(listings([row('www.usa.gov')])[0]!).replace(/\s+/g, ' ');
    assert.match(html, /correct|removed|remove/i);
    assert.match(html, /github\.com\/theDotGovDev\/govWebChecker/);
  });
});

describe('a domain groups its sites without standing in for them (FR-245a, FR-245b, FR-244)', () => {
  test('the group states which sites were checked and does not imply the rest', () => {
    const rows = [
      row('nih.gov', { tier: 'broad', cycle: '2026-W34', slice: 1,
        presence: { state: 'website', rule: 'presence/1' } } as Partial<Observation>),
      row('pubmed.ncbi.nlm.nih.gov'),
    ];
    const groups = domainGroups(listings(rows));
    const nih = groups.find((g) => g.domain === 'nih.gov')!;
    assert.equal(nih.listings.length, 2);
    const html = renderDomainGroup(nih).replace(/\s+/g, ' ');
    assert.match(html, /2 sites (checked|we know)/i, 'depth is a property of our knowledge');
    assert.match(html, /do not have a source|not imply|unknown number|other sites/i,
      'unlisted sites are not implied covered');
  });

  test('a reading at one host is never presented as a reading about another (FR-245a)', () => {
    const rows = [
      row('www.nih.gov', { outcome: 'success' }),
      row('pubmed.ncbi.nlm.nih.gov', { outcome: 'timeout', latency: { samples: 0 } }),
    ];
    const groups = domainGroups(listings(rows));
    const html = renderDomainGroup(groups[0]!).replace(/\s+/g, ' ');
    // Each host's outcome sits with its own host, and no domain-level verdict exists.
    assert.doesNotMatch(html, /nih\.gov is (up|down|responding|broken)/i);
  });

  test('no individual is named — the registry contact never reaches a page (FR-244, SC-208)', () => {
    const rows = [row('alamosa.gov', { tier: 'broad', cycle: '2026-W34', slice: 1,
      presence: { state: 'website', rule: 'presence/1' } } as Partial<Observation>)];
    const l = listings(rows)[0]!;
    const html = renderListing(l) + renderDomainGroup(domainGroups([l])[0]!);
    assert.doesNotMatch(html, /@[a-z0-9.-]+\.(gov|com|org)/i, 'no email address of any kind');
  });
});

describe('refusal and restraint are not failure (FR-261 at the listing level)', () => {
  test('a blocked host reads as declining automation, never as not answering', () => {
    const rows = [row('www.ssa.gov', { outcome: 'blocked', status_code: 403, latency: { samples: 0 } })];
    const html = renderListing(listings(rows)[0]!).replace(/\s+/g, ' ');
    assert.match(html, /declin|refus/i, 'the site chose to refuse automation');
    assert.match(html, /not (a statement|evidence) (about|that)|not.{0,30}down/i);
    assert.doesNotMatch(html, /did not answer/i, 'it answered — with a refusal');
  });

  test('a robots-skipped host reads as not checked, because nothing was sent', () => {
    const rows = [row('secure.login.gov', {
      outcome: 'skipped', skip_reason: 'robots.txt disallows this path', latency: { samples: 0 },
    })];
    const html = renderListing(listings(rows)[0]!).replace(/\s+/g, ' ');
    assert.match(html, /not checked/i);
    assert.match(html, /robots\.txt/i, 'the stated reason is the rule we honored');
    assert.doesNotMatch(html, /did not answer/i, 'nothing was asked');
  });
});

describe('a listing shows its history visually before its numbers (FR-285)', () => {
  test('one mark per calendar day, gaps shown as gaps, caption carrying the method', () => {
    const rows = [
      row('www.usa.gov', { run_id: 'h1', checked_at: '2026-08-20T06:00:00Z' }),
      row('www.usa.gov', { run_id: 'h2', checked_at: '2026-08-20T07:00:00Z', outcome: 'timeout', latency: { samples: 0 } }),
      // 2026-08-21 has no readings: the day must appear as a gap, not vanish.
      row('www.usa.gov', { run_id: 'h3', checked_at: '2026-08-22T06:00:00Z' }),
    ];
    const html = renderListing(listings(rows)[0]!);
    const strip = html.match(/<figure class="chart[\s\S]*?<\/figure>/)?.[0];
    assert.ok(strip, 'the history strip renders when there is history to show');
    assert.match(strip, /class="chart-method"/, 'a chart without its method is a bare number at scale');
    const days = strip.match(/<rect/g) ?? [];
    assert.equal(days.length, 3, 'three calendar days: two with readings, one gap between them');
    assert.match(strip, /day-gap/, 'a day nothing was measured shows as absence, never as good or bad (FR-233)');
    assert.match(strip, /2026-08-20: 1 of 2/, 'each day states its readings');
  });

  test('a refusing site\u2019s history reads as refusals, and a lone reading draws no strip', () => {
    const blocked = listings([
      row('www.ssa.gov', { run_id: 'b1', checked_at: '2026-08-20T06:00:00Z', outcome: 'blocked', status_code: 403, latency: { samples: 0 } }),
      row('www.ssa.gov', { run_id: 'b2', checked_at: '2026-08-21T06:00:00Z', outcome: 'blocked', status_code: 403, latency: { samples: 0 } }),
    ])[0]!;
    const html = renderListing(blocked);
    const strip = html.match(/<figure class="chart[\s\S]*?<\/figure>/)?.[0];
    assert.ok(strip);
    assert.doesNotMatch(strip, /day-full/, 'no day reads as answered');

    const lone = listings([row('once.gov', { tier: 'broad', cycle: '2026-W34', slice: 1,
      presence: { state: 'website', rule: 'presence/1' } } as Partial<Observation>)])[0]!;
    assert.doesNotMatch(renderListing(lone), /<figure class="chart"/,
      'one reading is one reading — a strip of one mark would dress it as a history');
  });
});
