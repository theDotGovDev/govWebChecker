import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { Outcome } from '../record/types.js';
import { requestHeaders } from '../politeness/user-agent.js';

export interface CheckOptions {
  timeoutMs: number;
  maxRedirects: number;
  /** Injectable resolver. Tests use it to produce a DNS failure without leaving the machine. */
  lookup?: LookupFunction;
}

export interface CheckResult {
  outcome: Outcome;
  statusCode?: number;
  /** Time to the final response. Absent when nothing was measured. */
  elapsedMs?: number;
  /** How long we waited before giving up. Present only on a timeout. */
  waitedMs?: number;
  redirectChain: string[];
  finalUrl: string;
}

/** Which phase of the request lifecycle an error arrived in. */
export type Phase = 'lookup' | 'connect' | 'tls' | 'response';

const TLS_ERROR = /^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED|EPROTO)/;
const DNS_ERROR = /^(ENOTFOUND|EAI_AGAIN|EAI_FAIL)$/;

/**
 * Classifies a failure by where in the lifecycle it happened, not by its message.
 * Error strings drift between Node versions and cannot be asserted on durably;
 * the phase can (research.md R3).
 */
export function classifyError(code: string | undefined, phase: Phase): Outcome {
  if (phase === 'lookup' || (code && DNS_ERROR.test(code))) return 'dns_failure';
  if (phase === 'tls' || (code && TLS_ERROR.test(code))) return 'tls_failure';
  return 'connection_failure';
}

/**
 * A 403 or 429 means our traffic was refused rather than the site being down.
 * That is a fact about access, and collapsing it into either "up" or "down"
 * would misrepresent the site (spec.md edge cases).
 */
export function classifyStatus(status: number): Outcome {
  if (status >= 200 && status < 300) return 'success';
  if (status === 403 || status === 429) return 'blocked';
  return 'http_error';
}

interface SingleResponse {
  status: number;
  location?: string;
  elapsedMs: number;
}

function requestOnce(url: string, options: CheckOptions): Promise<SingleResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isTls = parsed.protocol === 'https:';
    const transport = isTls ? https : http;
    const started = process.hrtime.bigint();
    let phase: Phase = 'connect';
    let settled = false;

    const request = transport.request(
      url,
      {
        method: 'GET',
        headers: requestHeaders(),
        ...(options.lookup ? { lookup: options.lookup } : {}),
      },
      (response) => {
        if (settled) return;
        settled = true;
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
        // The body is never read into memory or stored (FR-015). Resuming the
        // stream lets the socket close rather than hang.
        response.resume();
        resolve({
          status: response.statusCode ?? 0,
          ...(typeof response.headers.location === 'string'
            ? { location: response.headers.location }
            : {}),
          elapsedMs,
        });
      },
    );

    request.on('socket', (socket) => {
      socket.on('lookup', (err: Error | null) => {
        if (err) phase = 'lookup';
      });
      if (isTls) {
        // A TCP connection established but no secure channel yet: anything that
        // fails from here is the handshake, not reachability.
        socket.on('connect', () => {
          phase = 'tls';
        });
        socket.on('secureConnect', () => {
          phase = 'response';
        });
      }
    });

    request.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      reject(Object.assign(err, { phase }));
    });

    request.setTimeout(options.timeoutMs, () => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(Object.assign(new Error('timeout'), { phase, timedOut: true }));
    });

    request.end();
  });
}

/**
 * Fetches a small text resource for in-memory evaluation, capped in size.
 *
 * Deliberately separate from `performCheck`, which never returns a body. This
 * exists for `robots.txt` alone — a file whose whole purpose is to be read before
 * we act. The constitution permits analyzing content in memory; what it forbids
 * is persisting it, so the caller must use the result to make a decision and
 * discard it. Nothing here writes.
 *
 * The cap keeps a pathologically large file from becoming a memory problem.
 */
export async function fetchTextForEvaluation(
  url: string,
  options: CheckOptions,
  maxBytes = 64 * 1024,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const transport = new URL(url).protocol === 'https:' ? https : http;
    let settled = false;
    const done = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const request = transport.request(
      url,
      {
        method: 'GET',
        headers: requestHeaders(),
        ...(options.lookup ? { lookup: options.lookup } : {}),
      },
      (response) => {
        if ((response.statusCode ?? 0) >= 400) {
          response.resume();
          done(undefined);
          return;
        }
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          if (text.length < maxBytes) text += chunk;
        });
        response.on('end', () => done(text.slice(0, maxBytes)));
      },
    );

    request.on('error', () => done(undefined));
    request.setTimeout(options.timeoutMs, () => {
      request.destroy();
      done(undefined);
    });
    request.end();
  });
}

/**
 * One check of one URL: follows redirects, records the chain, and measures to the
 * final response.
 *
 * The elapsed figure covers the whole chain, because that is what a visitor
 * experiences — a site that redirects three times before answering is slower for
 * a real person, and timing only the last hop would flatter it.
 */
export async function performCheck(url: string, options: CheckOptions): Promise<CheckResult> {
  const redirectChain: string[] = [];
  let current = url;
  let totalMs = 0;
  const started = Date.now();

  for (let hop = 0; ; hop++) {
    let response: SingleResponse;
    try {
      response = await requestOnce(current, options);
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { phase?: Phase; timedOut?: boolean };
      if (err.timedOut) {
        return { outcome: 'timeout', waitedMs: Date.now() - started, redirectChain, finalUrl: current };
      }
      return {
        outcome: classifyError(err.code, err.phase ?? 'connect'),
        redirectChain,
        finalUrl: current,
      };
    }

    totalMs += response.elapsedMs;
    const redirectTo = response.status >= 300 && response.status < 400 ? response.location : undefined;

    if (redirectTo === undefined) {
      return {
        outcome: classifyStatus(response.status),
        statusCode: response.status,
        elapsedMs: Math.round(totalMs),
        redirectChain,
        finalUrl: current,
      };
    }

    if (redirectChain.length >= options.maxRedirects) {
      // Stopping is the honest outcome: we never saw the page a visitor would.
      return {
        outcome: 'http_error',
        statusCode: response.status,
        elapsedMs: Math.round(totalMs),
        redirectChain,
        finalUrl: current,
      };
    }

    redirectChain.push(current);
    current = new URL(redirectTo, current).toString();
  }
}
