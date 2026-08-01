import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseTargets, activeTargets } from '../../src/targets/load.js';

function valid(overrides: Record<string, unknown> = {}) {
  return {
    id: 'irs-gov',
    host: 'www.irs.gov',
    url: 'https://www.irs.gov/',
    agency: 'Internal Revenue Service',
    jurisdiction: 'federal',
    inclusion_reason: 'Among the most-visited federal sites',
    traffic_evidence: { source: 'seed', measure: 'hand-picked for development' },
    active: true,
    ...overrides,
  };
}

describe('target list', () => {
  test('parses a well-formed list', () => {
    const targets = parseTargets(JSON.stringify({ targets: [valid()] }));
    assert.equal(targets.length, 1);
    assert.equal(targets[0]!.host, 'www.irs.gov');
  });

  test('rejects a target with no inclusion_reason (FR-001)', () => {
    assert.throws(
      () => parseTargets(JSON.stringify({ targets: [valid({ inclusion_reason: undefined })] })),
      /inclusion_reason/,
    );
  });

  test('rejects a target with no traffic_evidence (FR-001a)', () => {
    // Selection must be traceable to evidence — the point is that nobody can
    // argue we picked targets to make a point.
    assert.throws(
      () => parseTargets(JSON.stringify({ targets: [valid({ traffic_evidence: undefined })] })),
      /traffic_evidence/,
    );
  });

  test('rejects duplicate ids', () => {
    assert.throws(
      () => parseTargets(JSON.stringify({ targets: [valid(), valid()] })),
      /duplicate/i,
    );
  });

  test('rejects a url whose host disagrees with the host field', () => {
    assert.throws(
      () => parseTargets(JSON.stringify({ targets: [valid({ url: 'https://elsewhere.gov/' })] })),
      /host/i,
    );
  });

  test('carries jurisdiction so widening scope adds rows, not columns', () => {
    const targets = parseTargets(JSON.stringify({ targets: [valid()] }));
    assert.equal(targets[0]!.jurisdiction, 'federal');
  });

  test('records a traffic unit mismatch when present (FR-001a)', () => {
    const targets = parseTargets(
      JSON.stringify({
        targets: [valid({ traffic_unit_mismatch: 'source reports the domain, we measure the host' })],
      }),
    );
    assert.match(targets[0]!.traffic_unit_mismatch ?? '', /domain/);
  });

  test('activeTargets excludes retired targets but does not delete them', () => {
    const targets = parseTargets(
      JSON.stringify({
        targets: [valid(), valid({ id: 'old-gov', host: 'old.gov', url: 'https://old.gov/', active: false })],
      }),
    );
    assert.equal(targets.length, 2, 'a retired target stays in the list');
    assert.equal(activeTargets(targets).length, 1, 'but is not checked');
  });
});
