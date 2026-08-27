import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { standings, type Standing } from '../../src/site/standings.js';
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

function readings(host: string, outcomes: string[]): Observation[] {
  return outcomes.map((outcome, i) =>
    row(host, {
      run_id: `r-${host}-${i}`,
      checked_at: `2026-08-2${Math.min(i, 4)}T0${i % 10}:00:00Z`,
      outcome: outcome as Observation['outcome'],
      ...(outcome === 'blocked' ? { status_code: 403 } : {}),
      ...(outcome === 'skipped' ? { skip_reason: 'robots.txt disallows this path', latency: { samples: 0 } } : {}),
      ...(outcome === 'timeout' ? { latency: { samples: 0 } } : {}),
    }),
  );
}

/**
 * D1 made concrete. Four of the 58 real hosts answered nothing successfully
 * across nineteen days, and none was down: one is robots-skipped, three refuse
 * automated traffic with 403. Any ordering that assigns them a rate publishes
 * Social Security at zero availability — FR-261 exists for exactly these rows.
 */
describe('a standing is a figure XOR a stated reason there is none (FR-260 to FR-262)', () => {
  test('a host that answered gets a rate carrying its method', () => {
    const list = standings([...readings('www.usa.gov', ['success', 'success', 'timeout', 'success'])]);
    const s = list.find((x) => x.host === 'www.usa.gov')!;
    assert.ok(s.figure, 'an answering host has a rate');
    assert.equal(s.noRate, undefined);
    assert.equal(s.figure.value, 75);
    assert.equal(s.figure.samples, 4);
    assert.equal(s.figure.cadence, 'hourly');
  });

  test('a host refusing automated traffic has no rate — not a zero (FR-261)', () => {
    const list = standings(readings('www.ssa.gov', ['blocked', 'blocked', 'blocked']));
    const s = list.find((x) => x.host === 'www.ssa.gov')!;
    assert.equal(s.figure, undefined, 'no rate exists to state');
    assert.deepEqual(s.noRate, { kind: 'refused', statusCode: 403 });
  });

  test('a robots-skipped host has no rate, and the reason is the rule (FR-261)', () => {
    const list = standings(readings('secure.login.gov', ['skipped', 'skipped']));
    const s = list.find((x) => x.host === 'secure.login.gov')!;
    assert.equal(s.figure, undefined);
    assert.equal(s.noRate?.kind, 'not_checked');
    assert.match((s.noRate as { rule: string }).rule, /robots/);
  });

  test('an ordering never contains a no-rate host, and never a zero standing in for one (FR-262)', () => {
    const list = standings([
      ...readings('www.usa.gov', ['success', 'timeout']),
      ...readings('www.ssa.gov', ['blocked', 'blocked']),
      ...readings('www.irs.gov', ['success', 'success']),
    ]);
    const ordered = list.filter((s) => s.figure !== undefined);
    assert.deepEqual(
      ordered.map((s) => s.host).sort(),
      ['www.irs.gov', 'www.usa.gov'],
      'the refused host appears nowhere in the ordering',
    );
    assert.ok(!ordered.some((s) => s.figure!.value === 0 && s.host === 'www.ssa.gov'));
    // Ordered descending by the one named measure, nothing else.
    const rates = list.filter((s) => s.figure).map((s) => s.figure!.value);
    assert.deepEqual(rates, [...rates].sort((a, b) => b - a), 'sorted on the single stated measure');
  });

  test('a host that mixes refusals with answers still gets its honest rate', () => {
    // Refusing sometimes is not refusing always. 2 successes of 4 readings is
    // 50%, and the blocked readings count in the denominator because they were
    // readings — the carve-out is for hosts with NO successful basis at all.
    const list = standings(readings('travel.state.gov', ['success', 'blocked', 'success', 'blocked']));
    const s = list.find((x) => x.host === 'travel.state.gov')!;
    assert.equal(s.figure?.value, 50);
  });

  test('no composite exists anywhere in the shape (D1, FR-260)', () => {
    const list = standings(readings('www.usa.gov', ['success']));
    for (const s of list) {
      const keys = Object.keys(s as unknown as Record<string, unknown>);
      const banned = keys.filter((k) => /score|grade|rank|index|composite/i.test(k));
      assert.deepEqual(banned, [], `a composite field is D1 undone: ${banned.join(', ')}`);
    }
  });
});
