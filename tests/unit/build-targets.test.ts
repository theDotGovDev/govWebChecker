import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrafficCsv, parseRegistryCsv, buildTargets } from '../../src/targets/build.js';

const TRAFFIC = `domain,visits
tools.usps.com,264345084
pmc.ncbi.nlm.nih.gov,93862386
forecast.weather.gov,57789910
usps.com,53158195
secure.login.gov,33015018
notfederal.example.com,10
`;

const REGISTRY = `Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email
nih.gov,Federal - Executive,National Institutes of Health,,Bethesda,MD,x@nih.gov
weather.gov,Federal - Executive,National Oceanic and Atmospheric Administration,,Silver Spring,MD,x@noaa.gov
login.gov,Federal - Executive,General Services Administration,,Washington,DC,x@gsa.gov
somecity.gov,City,City of Somewhere,,Somewhere,CA,(blank)
`;

const OVERRIDES = { 'usps.com': 'United States Postal Service' };

describe('parsing the published sources', () => {
  test('reads the traffic file in published order', () => {
    const rows = parseTrafficCsv(TRAFFIC);
    assert.equal(rows.length, 6);
    assert.deepEqual(rows[0], { domain: 'tools.usps.com', visits: 264_345_084 });
    assert.equal(rows[2]!.domain, 'forecast.weather.gov');
  });

  test('skips malformed traffic rows rather than inventing a number', () => {
    const rows = parseTrafficCsv('domain,visits\ngood.gov,5\nbroken.gov,notanumber\n,7\n');
    assert.deepEqual(rows, [{ domain: 'good.gov', visits: 5 }]);
  });

  test('reads the registry with its branch categorization', () => {
    const rows = parseRegistryCsv(REGISTRY);
    assert.equal(rows.length, 4);
    assert.equal(rows[0]!.domain, 'nih.gov');
    assert.equal(rows[0]!.type, 'Federal - Executive');
    assert.equal(rows[0]!.organization, 'National Institutes of Health');
  });

  test('handles quoted registry fields containing commas', () => {
    const rows = parseRegistryCsv(
      'Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email\n' +
        'x.gov,Federal - Executive,"Dept of Things, Stuff and Matters",,DC,DC,a@x.gov\n',
    );
    assert.equal(rows[0]!.organization, 'Dept of Things, Stuff and Matters');
  });
});

describe('building the target list', () => {
  const traffic = parseTrafficCsv(TRAFFIC);
  const registry = parseRegistryCsv(REGISTRY);

  test('takes the highest-traffic hosts, in order', () => {
    const { targets } = buildTargets(traffic, registry, { limit: 3, overrides: OVERRIDES });
    assert.deepEqual(
      targets.map((t) => t.host),
      ['tools.usps.com', 'pmc.ncbi.nlm.nih.gov', 'forecast.weather.gov'],
    );
  });

  test('attributes each host to its agency via the registrable domain', () => {
    const { targets } = buildTargets(traffic, registry, { limit: 5, overrides: OVERRIDES });
    const nih = targets.find((t) => t.host === 'pmc.ncbi.nlm.nih.gov')!;
    assert.equal(nih.agency, 'National Institutes of Health');
    const noaa = targets.find((t) => t.host === 'forecast.weather.gov')!;
    assert.equal(noaa.agency, 'National Oceanic and Atmospheric Administration');
  });

  test('records the traffic figure that earned each place (FR-001a)', () => {
    const { targets } = buildTargets(traffic, registry, { limit: 1, overrides: OVERRIDES });
    const t = targets[0]!;
    assert.equal(t.traffic_evidence.visits, 264_345_084);
    assert.match(t.traffic_evidence.source, /analytics\.usa\.gov/);
    assert.match(t.inclusion_reason, /rank 1\b/i);
  });

  test('every target is active, federal, and has an https url matching its host', () => {
    const { targets } = buildTargets(traffic, registry, { limit: 5, overrides: OVERRIDES });
    for (const t of targets) {
      assert.equal(t.active, true);
      assert.equal(t.jurisdiction, 'federal');
      assert.equal(new URL(t.url).hostname, t.host);
      assert.equal(new URL(t.url).protocol, 'https:');
    }
  });

  test('ids are stable, unique, and derived from the host', () => {
    const { targets } = buildTargets(traffic, registry, { limit: 5, overrides: OVERRIDES });
    const ids = targets.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(targets.find((t) => t.host === 'tools.usps.com')!.id, 'tools-usps-com');
  });

  test('an agency outside the .gov registry is included only via an explicit override', () => {
    // usps.com is federal but not a .gov domain, so the registry cannot attribute
    // it. Including it silently would mean a target with no accountable owner;
    // dropping it would lose the single largest source of federal web traffic.
    // An explicit, reviewable override is the honest middle.
    const { targets } = buildTargets(traffic, registry, { limit: 5, overrides: OVERRIDES });
    assert.equal(targets.find((t) => t.host === 'usps.com')!.agency, 'United States Postal Service');
  });

  test('a host that can be attributed to nobody is excluded and reported', () => {
    const { targets, unmatched } = buildTargets(traffic, registry, { limit: 6, overrides: {} });
    assert.equal(targets.find((t) => t.host === 'notfederal.example.com'), undefined);
    assert.ok(unmatched.some((u) => u.host === 'notfederal.example.com'));
  });

  test('a non-federal registry entry is excluded even when it has traffic', () => {
    const traffic2 = parseTrafficCsv('domain,visits\nsomecity.gov,999\n');
    const { targets, unmatched } = buildTargets(traffic2, registry, { limit: 5, overrides: {} });
    assert.equal(targets.length, 0);
    assert.match(unmatched[0]!.reason, /not federal/i);
  });

  test('exclusions are reported rather than silently reducing the list', () => {
    const { targets, unmatched } = buildTargets(traffic, registry, { limit: 6, overrides: {} });
    assert.equal(targets.length + unmatched.length, 6, 'every considered host is accounted for');
  });

  test('hosts of one agency keep their own rows — grouping is not collection’s job', () => {
    const { targets } = buildTargets(traffic, registry, { limit: 5, overrides: OVERRIDES });
    const usps = targets.filter((t) => t.host.endsWith('usps.com'));
    assert.equal(usps.length, 2, 'tools.usps.com and usps.com are separate measurements');
  });
});

describe('agency attribution detail', () => {
  const REGISTRY_WITH_SUB = `Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email
weather.gov,Federal - Executive,Department of Commerce,National Oceanic and Atmospheric Administration,Silver Spring,MD,x@noaa.gov
gsa.gov,Federal - Executive,General Services Administration,,Washington,DC,x@gsa.gov
`;

  test('carries the operating unit when the registry names one', () => {
    const { targets } = buildTargets(
      parseTrafficCsv('domain,visits\nforecast.weather.gov,100\n'),
      parseRegistryCsv(REGISTRY_WITH_SUB),
      { limit: 1, overrides: {} },
    );
    assert.equal(targets[0]!.agency, 'Department of Commerce');
    assert.equal(targets[0]!.suborganization, 'National Oceanic and Atmospheric Administration');
  });

  test('omits the field entirely when the registry names none', () => {
    const { targets } = buildTargets(
      parseTrafficCsv('domain,visits\nwww.gsa.gov,100\n'),
      parseRegistryCsv(REGISTRY_WITH_SUB),
      { limit: 1, overrides: {} },
    );
    assert.equal('suborganization' in targets[0]!, false, 'absent, not empty string');
  });
});

describe('id stability across regeneration', () => {
  const REG = `Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email
irs.gov,Federal - Executive,Department of the Treasury,Internal Revenue Service,DC,DC,x@irs.gov
`;

  test('reuses the existing id for a host already measured', () => {
    // Regeneration must not orphan history. A host keeps whatever id it was
    // first given, because every stored observation joins on that id — changing
    // it silently severs the series the whole project exists to build.
    const existing = [
      {
        id: 'irs-gov',
        host: 'www.irs.gov',
        url: 'https://www.irs.gov/',
        agency: 'Department of the Treasury',
        jurisdiction: 'federal',
        inclusion_reason: 'seed',
        traffic_evidence: { source: 's', measure: 'm' },
        active: true,
      },
    ];
    const { targets } = buildTargets(
      parseTrafficCsv('domain,visits\nwww.irs.gov,100\n'),
      parseRegistryCsv(REG),
      { limit: 1, overrides: {}, existing },
    );
    assert.equal(targets[0]!.id, 'irs-gov', 'the historical id must survive regeneration');
  });

  test('derives a fresh id only for a host never seen before', () => {
    const { targets } = buildTargets(
      parseTrafficCsv('domain,visits\nwww.irs.gov,100\n'),
      parseRegistryCsv(REG),
      { limit: 1, overrides: {}, existing: [] },
    );
    assert.equal(targets[0]!.id, 'www-irs-gov');
  });

  test('a reused id does not collide with a derived one', () => {
    const existing = [
      {
        id: 'www-irs-gov',
        host: 'irs.gov',
        url: 'https://irs.gov/',
        agency: 'Department of the Treasury',
        jurisdiction: 'federal',
        inclusion_reason: 'seed',
        traffic_evidence: { source: 's', measure: 'm' },
        active: true,
      },
    ];
    const { targets } = buildTargets(
      parseTrafficCsv('domain,visits\nirs.gov,200\nwww.irs.gov,100\n'),
      parseRegistryCsv(REG),
      { limit: 2, overrides: {}, existing },
    );
    const ids = targets.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, `ids collided: ${ids.join(', ')}`);
  });
});
