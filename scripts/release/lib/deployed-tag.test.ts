import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { readDeployedTag } from './deployed-tag.ts';

/**
 * The tag the live sync server runs, read from its /health (server/src/server.ts: version is the
 * deploy's CHORD_RELEASE_TAG, null outside a deploy). release.yml's preflight measures the server
 * range from it, so a release after a failed deploy still deploys the server (devstation-pqub).
 */
let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = null;
});

function serve(status: number, body: string): Promise<string> {
  server = createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  });
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/health`);
    });
  });
}

describe('readDeployedTag', () => {
  it('reads the release tag the server reports', async () => {
    const url = await serve(200, JSON.stringify({ status: 'ok', version: 'v1.1.0-canary.2' }));

    await expect(readDeployedTag(url)).resolves.toBe('v1.1.0-canary.2');
  });

  it('a server outside a deploy reports no release: null', async () => {
    const url = await serve(200, JSON.stringify({ status: 'ok', version: null }));

    await expect(readDeployedTag(url)).resolves.toBeNull();
  });

  it('refuses an answer that is not a health reading or names no release tag', async () => {
    const noField = await serve(200, JSON.stringify({ status: 'ok' }));
    await expect(readDeployedTag(noField)).rejects.toThrow(/version/);
    await new Promise((resolve) => server!.close(resolve));

    const notATag = await serve(200, JSON.stringify({ status: 'ok', version: 'main' }));
    await expect(readDeployedTag(notATag)).rejects.toThrow(/main/);
  });

  it('refuses an unhealthy server, naming its status', async () => {
    const url = await serve(503, JSON.stringify({ error: 'down' }));

    await expect(readDeployedTag(url)).rejects.toThrow(/503/);
  });

  it('refuses a server it cannot reach', async () => {
    const url = await serve(200, '{}');
    await new Promise((resolve) => server!.close(resolve));
    server = null;

    await expect(readDeployedTag(url, 2_000)).rejects.toThrow(/127\.0\.0\.1/);
  });
});
