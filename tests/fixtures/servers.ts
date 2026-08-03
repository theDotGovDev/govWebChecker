import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Fixture {
  url: string;
  port: number;
  requests: http.IncomingMessage[];
  close(): Promise<void>;
}

async function listen(server: http.Server, requests: http.IncomingMessage[]): Promise<Fixture> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function recording(handler: http.RequestListener): { server: http.Server; requests: http.IncomingMessage[] } {
  const requests: http.IncomingMessage[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req);
    handler(req, res);
  });
  return { server, requests };
}

export async function fastServer(body = 'ok'): Promise<Fixture> {
  const { server, requests } = recording((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  });
  return listen(server, requests);
}

export async function slowServer(delayMs: number): Promise<Fixture> {
  const { server, requests } = recording((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('slow');
    }, delayMs);
  });
  return listen(server, requests);
}

/** Accepts the connection and never responds. Used for timeout behavior. */
export async function silentServer(): Promise<Fixture> {
  const { server, requests } = recording(() => {
    /* deliberately no response */
  });
  return listen(server, requests);
}

export async function statusServer(status: number): Promise<Fixture> {
  const { server, requests } = recording((_req, res) => {
    res.writeHead(status);
    res.end(String(status));
  });
  return listen(server, requests);
}

/** Refuses any request whose User-Agent looks automated. */
export async function blockingServer(pattern: RegExp): Promise<Fixture> {
  const { server, requests } = recording((req, res) => {
    if (pattern.test(req.headers['user-agent'] ?? '')) {
      res.writeHead(403);
      res.end('blocked');
      return;
    }
    res.writeHead(200);
    res.end('ok');
  });
  return listen(server, requests);
}

export async function robotsServer(robotsBody: string): Promise<Fixture> {
  const { server, requests } = recording((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(robotsBody);
      return;
    }
    res.writeHead(200);
    res.end('ok');
  });
  return listen(server, requests);
}

/** A port nothing is listening on, for connection-refused behavior. */
export async function closedPort(): Promise<string> {
  const f = await fastServer();
  const url = f.url;
  await f.close();
  return url;
}
