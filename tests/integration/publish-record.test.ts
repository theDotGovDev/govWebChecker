import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SCRIPT = path.resolve('scripts/publish-record.sh');

let dir: string;
let origin: string;
let work: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd });
  return stdout;
}

async function rows(cwd: string, file: string): Promise<string[]> {
  const text = await fs.readFile(path.join(cwd, file), 'utf8');
  return text.trim().split('\n').filter((l) => l !== '');
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gwc-publish-'));
  origin = path.join(dir, 'origin.git');
  work = path.join(dir, 'work');

  await fs.mkdir(origin, { recursive: true });
  await git(origin, 'init', '--bare', '--initial-branch=main');
  await git(dir, 'clone', origin, 'work');
  await git(work, 'config', 'user.email', 'test@example.com');
  await git(work, 'config', 'user.name', 'test');

  await fs.mkdir(path.join(work, 'data/availability'), { recursive: true });
  await fs.writeFile(path.join(work, 'data/availability/2026-08.jsonl'), '{"row":"existing"}\n');
  await git(work, 'add', '-A');
  await git(work, 'commit', '-m', 'seed');
  await git(work, 'push', 'origin', 'main');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * A census slice takes forty minutes, so it overlaps an hourly check every single
 * time it runs. Both append to the same monthly file, and git calls two additions
 * at the end of one file a content conflict.
 *
 * It is not one. The correct merge of two appends is both appends. The previous
 * implementation rebased and retried three times, and could not succeed — the
 * first conflict left the repository mid-rebase and the remaining attempts died
 * with "Pulling is not possible because you have unmerged files". That cost a
 * completed 40-minute sweep of 2,300 government domains.
 */
describe('publishing an append-only record past a concurrent writer', () => {
  test('keeps both writers rows when another landed mid-collection', async () => {
    const file = 'data/availability/2026-08.jsonl';

    // Another writer — the hourly check — lands while our slice is still running.
    const other = path.join(dir, 'other');
    await git(dir, 'clone', origin, 'other');
    await git(other, 'config', 'user.email', 'other@example.com');
    await git(other, 'config', 'user.name', 'other');
    await fs.appendFile(path.join(other, file), '{"row":"hourly-check"}\n');
    await git(other, 'add', '-A');
    await git(other, 'commit', '-m', 'hourly');
    await git(other, 'push', 'origin', 'main');

    // Our slice finishes and appends its own rows to the copy it started from.
    await fs.appendFile(path.join(work, file), '{"row":"census-a"}\n{"row":"census-b"}\n');

    await run('bash', [SCRIPT, 'main', 'data: census slice'], { cwd: work });

    // Read what actually landed on the branch, not what our tree believes.
    const check = path.join(dir, 'check');
    await git(dir, 'clone', origin, 'check');
    const published = await rows(check, file);

    assert.ok(published.includes('{"row":"existing"}'), 'the seed row must survive');
    assert.ok(
      published.includes('{"row":"hourly-check"}'),
      'the other writers row must survive — losing it is the silent hole this guards',
    );
    assert.ok(published.includes('{"row":"census-a"}'), 'our first row must be published');
    assert.ok(published.includes('{"row":"census-b"}'), 'our second row must be published');
    assert.equal(published.length, 4, `expected exactly four rows, got ${published.length}`);
  });

  test('publishes cleanly when nothing else landed', async () => {
    const file = 'data/availability/2026-08.jsonl';
    await fs.appendFile(path.join(work, file), '{"row":"census-a"}\n');

    await run('bash', [SCRIPT, 'main', 'data: census slice'], { cwd: work });

    const check = path.join(dir, 'check');
    await git(dir, 'clone', origin, 'check');
    assert.deepEqual(await rows(check, file), ['{"row":"existing"}', '{"row":"census-a"}']);
  });

  test('a brand-new months file is published, not left untracked', async () => {
    // September's first run creates a file git has never seen. Staging before
    // capturing is what makes it count as added rather than as untracked noise.
    const fresh = 'data/availability/2026-09.jsonl';
    await fs.writeFile(path.join(work, fresh), '{"row":"september"}\n');

    await run('bash', [SCRIPT, 'main', 'data: census slice'], { cwd: work });

    const check = path.join(dir, 'check');
    await git(dir, 'clone', origin, 'check');
    assert.deepEqual(await rows(check, fresh), ['{"row":"september"}']);
  });

  test('does nothing, successfully, when there is nothing to publish', async () => {
    const { stdout } = await run('bash', [SCRIPT, 'main', 'data: census slice'], { cwd: work });
    assert.match(stdout, /nothing to commit/i);
  });
});
