import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { LookupFunction } from 'node:net';

export interface Fixture {
  url: string;
  close(): Promise<void>;
}

/** A self-signed certificate, generated once per process into a temp dir. */
let selfSigned: { key: string; cert: string } | undefined;

function selfSignedCert(): { key: string; cert: string } {
  if (selfSigned) return selfSigned;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwc-cert-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath,
    '-days', '1', '-subj', '/CN=localhost',
  ], { stdio: 'ignore' });
  selfSigned = {
    key: fs.readFileSync(keyPath, 'utf8'),
    cert: fs.readFileSync(certPath, 'utf8'),
  };
  return selfSigned;
}

/** HTTPS with a certificate no client should trust. */
export async function untrustedTlsServer(): Promise<Fixture> {
  const { key, cert } = selfSignedCert();
  const server = https.createServer({ key, cert }, (_req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `https://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Accepts a TCP connection then destroys it, failing the TLS handshake. */
export async function tlsHandshakeFailureServer(): Promise<Fixture> {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `https://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A URL on a port with nothing listening. */
export async function refusedUrl(): Promise<string> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}/`;
}

/**
 * A DNS resolver that always fails, injected rather than relying on a real
 * lookup — SC-006 forbids a test reaching any external host, and a query for a
 * non-resolving name still leaves the machine.
 */
export const failingLookup: LookupFunction = ((_hostname, _options, callback) => {
  const err = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
    code: 'ENOTFOUND',
    errno: -3008,
    syscall: 'getaddrinfo',
  });
  queueMicrotask(() => (callback as (e: Error) => void)(err));
}) as LookupFunction;
