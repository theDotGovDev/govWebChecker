import net from 'node:net';

/**
 * Fails any test that opens a connection to something other than loopback.
 *
 * SC-006 says the suite runs with no network access to any external host, and no
 * test ever contacts a real government site. That is a promise about the suite,
 * so it is enforced by the suite rather than trusted to reviewers.
 *
 * Call `installNoNetworkGuard()` at the top of a test file. It patches
 * `net.Socket.prototype.connect`, which every HTTP and TLS client in Node
 * ultimately goes through.
 */
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/;

let original: typeof net.Socket.prototype.connect | undefined;

export function installNoNetworkGuard(): void {
  if (original) return;
  original = net.Socket.prototype.connect;

  net.Socket.prototype.connect = function patched(
    this: net.Socket,
    ...args: Parameters<typeof net.Socket.prototype.connect>
  ) {
    const options = args[0];
    const host =
      typeof options === 'object' && options !== null && 'host' in options
        ? String((options as { host?: string }).host ?? '')
        : typeof args[1] === 'string'
          ? args[1]
          : '';

    if (host && !LOOPBACK.test(host)) {
      throw new Error(
        `test attempted a connection to "${host}". The suite must not contact any ` +
          'external host (SC-006) — use a fixture server on loopback instead.',
      );
    }
    return (original as typeof net.Socket.prototype.connect).apply(this, args);
  } as typeof net.Socket.prototype.connect;
}

export function removeNoNetworkGuard(): void {
  if (!original) return;
  net.Socket.prototype.connect = original;
  original = undefined;
}
