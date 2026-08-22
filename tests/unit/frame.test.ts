import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrame, parseRegistry, frameDigest } from '../../src/census/frame.js';
import { sliceOf } from '../../src/census/slice.js';

// The real header, verbatim from the published registry. An invented column
// order here would test the parser against our own assumption rather than
// against the thing it parses — which is how `organization` silently came to
// read the Suborganization column.
const REGISTRY_CSV = [
  'Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email',
  'alamosa.gov,City,City of Alamosa,,Alamosa,CO,(blank)',
  'abingtonpa.gov,City,"Abington Township, PA",,Abington,PA,(blank)',
  'nih.gov,Federal - Executive,Department of Health and Human Services,National Institutes of Health,Bethesda,MD,(blank)',
  'tsa.gov,Federal - Executive,Department of Homeland Security,Transportation Security Administration,Springfield,VA,(blank)',
].join('\n');

describe('parsing the published registry', () => {
  test('reads one entry per domain, honoring quoted fields', () => {
    const entries = parseRegistry(REGISTRY_CSV);
    assert.equal(entries.length, 4);
    assert.equal(entries[0]!.domain, 'alamosa.gov');
    // The organization name contains a comma inside quotes — a naive split
    // shifts every later column and silently mislabels the jurisdiction.
    assert.equal(entries[1]!.organization, 'Abington Township, PA');
    assert.equal(entries[1]!.city, 'Abington');
    assert.equal(entries[1]!.state, 'PA');
  });

  test('reads the accountable organization and the operating unit separately', () => {
    // The department is who is accountable; the suborganization is who the public
    // recognises — NIH under HHS. 001 keeps both for the same reason.
    const entries = parseRegistry(REGISTRY_CSV);
    assert.equal(entries[2]!.organization, 'Department of Health and Human Services');
    assert.equal(entries[2]!.suborganization, 'National Institutes of Health');
    assert.equal(entries[0]!.suborganization, '');
  });

  test('keeps the registry type verbatim', () => {
    // The survey found sixteen distinct values, not the six first assumed.
    // Normalising here would silently define what comparisons are possible.
    const entries = parseRegistry(REGISTRY_CSV);
    assert.equal(entries[2]!.type, 'Federal - Executive');
  });

  test('lowercases domains, so a case difference is not two domains', () => {
    const entries = parseRegistry(REGISTRY_CSV.replace('alamosa.gov', 'Alamosa.GOV'));
    assert.equal(entries[0]!.domain, 'alamosa.gov');
  });
});

describe('building the census frame', () => {
  test('produces one entry per domain, each with its slice', () => {
    const frame = buildFrame({ csv: REGISTRY_CSV, exclusions: [], retrievedAt: '2026-08-22T04:00:00Z' });
    assert.equal(frame.domains.length, 4);
    for (const entry of frame.domains) {
      assert.equal(entry.slice, sliceOf(entry.domain), 'stored slice must match the hash');
    }
  });

  test('removes excluded domains', () => {
    // The constitution requires a removal request be honored without argument,
    // and FR-105 requires it take effect without hand-editing a generated file.
    const frame = buildFrame({
      csv: REGISTRY_CSV,
      exclusions: [{ domain: 'alamosa.gov', since: '2026-08-22', reason: 'operator request' }],
      retrievedAt: '2026-08-22T04:00:00Z',
    });
    assert.equal(frame.domains.length, 3);
    assert.ok(!frame.domains.some((d) => d.domain === 'alamosa.gov'));
  });

  test('carries a digest that changes when the domain set changes', () => {
    const a = buildFrame({ csv: REGISTRY_CSV, exclusions: [], retrievedAt: '2026-08-22T04:00:00Z' });
    const b = buildFrame({
      csv: REGISTRY_CSV,
      exclusions: [{ domain: 'alamosa.gov', since: '2026-08-22', reason: 'test' }],
      retrievedAt: '2026-08-22T04:00:00Z',
    });
    assert.notEqual(a.digest, b.digest);
  });

  test('the digest does not change merely because it was fetched again', () => {
    // A cycle is complete when seven slices ran against the same digest. If the
    // digest moved on every refresh, no cycle would ever look complete.
    const a = buildFrame({ csv: REGISTRY_CSV, exclusions: [], retrievedAt: '2026-08-22T04:00:00Z' });
    const b = buildFrame({ csv: REGISTRY_CSV, exclusions: [], retrievedAt: '2026-08-23T09:31:00Z' });
    assert.equal(a.digest, b.digest);
  });

  test('the digest ignores the order the registry happened to list domains in', () => {
    const shuffled = [
      REGISTRY_CSV.split('\n')[0]!,
      ...REGISTRY_CSV.split('\n').slice(1).reverse(),
    ].join('\n');
    const a = buildFrame({ csv: REGISTRY_CSV, exclusions: [], retrievedAt: '2026-08-22T04:00:00Z' });
    const b = buildFrame({ csv: shuffled, exclusions: [], retrievedAt: '2026-08-22T04:00:00Z' });
    assert.equal(a.digest, b.digest);
  });
});

/**
 * The refusals.
 *
 * A truncated download produces a small frame, and a small frame produces a cycle
 * that reads as a coverage collapse across US government rather than as a failed
 * HTTP request on our side. This is the same class of error as the run from a
 * sandbox with broken egress that would have asserted federal agencies refuse
 * automated traffic — and it is caught the same way, by refusing to publish
 * rather than by hoping someone notices the number.
 */
describe('building refuses rather than publishing a lie', () => {
  test('refuses an empty registry', () => {
    assert.throws(
      () => buildFrame({ csv: 'Domain name,Domain type\n', exclusions: [], retrievedAt: 'x' }),
      /empty/i,
    );
  });

  test('refuses a frame far smaller than the one it replaces', () => {
    const previous = { size: 16_535 };
    assert.throws(
      () =>
        buildFrame({
          csv: REGISTRY_CSV,
          exclusions: [],
          retrievedAt: 'x',
          previous,
        }),
      /smaller/i,
      'four domains replacing 16,535 must not be written silently',
    );
  });

  test('allows a frame that shrank within the tolerance', () => {
    // Domains really are retired. The guard is against a collapse, not against
    // ordinary drift, or it would block the thing it exists to protect.
    const previous = { size: 4 };
    assert.doesNotThrow(() =>
      buildFrame({ csv: REGISTRY_CSV, exclusions: [], retrievedAt: 'x', previous }),
    );
  });

  test('allows growth without complaint', () => {
    const previous = { size: 2 };
    assert.doesNotThrow(() =>
      buildFrame({ csv: REGISTRY_CSV, exclusions: [], retrievedAt: 'x', previous }),
    );
  });

  test('refuses a frame whose stored slices disagree with recomputing them', () => {
    // Cannot happen unless the hash changed — in which case every historical
    // slice claim is wrong, and the build must stop rather than paper over it.
    const frame = buildFrame({ csv: REGISTRY_CSV, exclusions: [], retrievedAt: 'x' });
    frame.domains[0]!.slice = (frame.domains[0]!.slice + 1) % 7;
    assert.throws(() => frameDigest(frame, { verifySlices: true }), /slice/i);
  });
});
