import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chooseAddress, pinnedLookup } from '../../src/checker/resolve.js';

describe('choosing which backend address to contact', () => {
  test('is deterministic for a host, so the record is comparable run to run', () => {
    const addresses = ['192.0.2.1', '192.0.2.2', '192.0.2.3'];
    const first = chooseAddress('alamosa.gov', addresses);
    for (let i = 0; i < 5; i++) {
      assert.equal(chooseAddress('alamosa.gov', addresses), first);
    }
  });

  test('does not depend on the order the resolver happened to return', () => {
    const addresses = ['192.0.2.1', '192.0.2.2', '192.0.2.3'];
    const rotated = ['192.0.2.3', '192.0.2.1', '192.0.2.2'];
    assert.equal(chooseAddress('alamosa.gov', addresses), chooseAddress('alamosa.gov', rotated));
  });

  test('spreads different hosts across a real fleet', () => {
    // A vendor with several machines should not have every one of its customers
    // pinned onto one of them — that would concentrate the load the address
    // limit exists to spread.
    const addresses = ['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4'];
    const hosts = Array.from({ length: 60 }, (_, i) => `city${i}.gov`);
    const chosen = new Set(hosts.map((h) => chooseAddress(h, addresses)));
    assert.ok(
      chosen.size > 1,
      `all ${hosts.length} hosts pinned to one of ${addresses.length} addresses`,
    );
  });

  test('returns nothing when resolution produced no address', () => {
    assert.equal(chooseAddress('alamosa.gov', []), undefined);
  });
});

describe('pinning the connection to the address we rate-limited', () => {
  test('hands the socket the address the limiter accounted for', async () => {
    // Without this the limit is fiction: we would account for one address and
    // let Node reconnect to whatever it resolves at connect time.
    const lookup = pinnedLookup('192.0.2.7', 4);
    const result = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      lookup('alamosa.gov', {}, (err, address, family) => {
        if (err) reject(err);
        else resolve({ address: address as string, family: family as number });
      });
    });
    assert.equal(result.address, '192.0.2.7');
    assert.equal(result.family, 4);
  });

  test('answers the all-addresses form callers may ask for', async () => {
    const lookup = pinnedLookup('192.0.2.7', 4);
    const result = await new Promise<unknown>((resolve, reject) => {
      lookup('alamosa.gov', { all: true }, (err, addresses) => {
        if (err) reject(err);
        else resolve(addresses);
      });
    });
    assert.deepEqual(result, [{ address: '192.0.2.7', family: 4 }]);
  });

  test('carries an IPv6 backend without mangling its family', async () => {
    const lookup = pinnedLookup('2001:db8::1', 6);
    const result = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      lookup('alamosa.gov', {}, (err, address, family) => {
        if (err) reject(err);
        else resolve({ address: address as string, family: family as number });
      });
    });
    assert.equal(result.address, '2001:db8::1');
    assert.equal(result.family, 6);
  });
});
