import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { readCiRan } from './ci-ran.ts';

/**
 * Whether CI ran on a release merge, from GitHub's Actions API (release-preflight.ts asks it for
 * an untagged version a later commit names, devstation-mg6u.66). A local server stands in for the
 * API. ci.yml cancels a main run when another merge lands, so a cancelled run is no run: counting
 * it would strand the release the same way a lost push event does.
 */
let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = null;
});

const SHA = '7364c16aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const seen: { url?: string; headers?: IncomingHttpHeaders } = {};

function serve(status: number, body: unknown): Promise<string> {
  server = createServer((req, res) => {
    seen.url = req.url;
    seen.headers = req.headers;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`);
    });
  });
}

const runs = (...list: { status: string; conclusion: string | null }[]) => ({
  total_count: list.length,
  workflow_runs: list,
});

describe('readCiRan', () => {
  it('asks for the CI workflow runs of the commit, with the token', async () => {
    const api = await serve(200, runs());

    await readCiRan(api, 'owner/repo', 'tok-1', SHA);

    expect(seen.url).toMatch(/^\/repos\/owner\/repo\/actions\/workflows\/ci\.yml\/runs\?/);
    expect(new URLSearchParams(seen.url!.split('?')[1]).get('head_sha')).toBe(SHA);
    expect(seen.headers?.authorization).toBe('Bearer tok-1');
  });

  it('a queued, running, passed or failed run counts as CI having run', async () => {
    for (const run of [
      { status: 'queued', conclusion: null },
      { status: 'in_progress', conclusion: null },
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
    ]) {
      const api = await serve(200, runs(run));
      await expect(readCiRan(api, 'o/r', 't', SHA)).resolves.toBe(true);
      await new Promise((resolve) => server!.close(resolve));
      server = null;
    }
  });

  it('no run, or only cancelled and skipped runs, is CI never having run', async () => {
    const none = await serve(200, runs());
    await expect(readCiRan(none, 'o/r', 't', SHA)).resolves.toBe(false);
    await new Promise((resolve) => server!.close(resolve));

    const cancelled = await serve(
      200,
      runs(
        { status: 'completed', conclusion: 'cancelled' },
        { status: 'completed', conclusion: 'skipped' }
      )
    );
    await expect(readCiRan(cancelled, 'o/r', 't', SHA)).resolves.toBe(false);
  });

  it('refuses an answer other than 200, naming the status', async () => {
    const api = await serve(403, { message: 'Resource not accessible by integration' });

    await expect(readCiRan(api, 'o/r', 't', SHA)).rejects.toThrow(/403/);
  });

  it('refuses a body without workflow_runs', async () => {
    const api = await serve(200, { total_count: 1 });

    await expect(readCiRan(api, 'o/r', 't', SHA)).rejects.toThrow(/workflow_runs/);
  });

  it('refuses an unreachable API, naming the commit', async () => {
    const api = await serve(200, runs());
    await new Promise((resolve) => server!.close(resolve));
    server = null;

    await expect(readCiRan(api, 'o/r', 't', SHA, 2_000)).rejects.toThrow(/7364c16/);
  });
});
