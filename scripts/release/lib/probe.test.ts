import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { probeRelease, readReleaseManifests } from './probe.ts';

describe('readReleaseManifests', () => {
  it("names the tag's channel manifest for every platform", () => {
    expect(readReleaseManifests('v1.4.0')).toEqual([
      'v1-stable.yml',
      'v1-stable-mac.yml',
      'v1-stable-linux.yml',
    ]);
    expect(readReleaseManifests('v2.0.1-canary.3')).toEqual([
      'v2-canary.yml',
      'v2-canary-mac.yml',
      'v2-canary-linux.yml',
    ]);
  });

  it('refuses a tag outside the release grammar', () => {
    expect(() => readReleaseManifests('v1.0.0-rc1')).toThrow(/not a release tag/);
  });
});

/**
 * The post-release probe (devstation-g98j, C3, F14): what a user's updater would fetch, checked
 * against the tag. The manifest's version must be the tag's, and every file it lists must be
 * served with the sha512 it states. A loopback server stands in for the release host.
 */
const INSTALLER = Buffer.from('the windows installer bytes');
const sha512 = (bytes: Buffer) => createHash('sha512').update(bytes).digest('base64');

function manifest(version: string, fileSha: string): string {
  return [
    `version: ${version}`,
    'files:',
    `  - url: chord-${version}-x64.exe`,
    `    sha512: ${fileSha}`,
    `    size: ${INSTALLER.length}`,
    `path: chord-${version}-x64.exe`,
    `sha512: ${fileSha}`,
    "releaseDate: '2026-10-31T00:00:00.000Z'",
    '',
  ].join('\n');
}

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

async function serve(files: Record<string, string | Buffer>): Promise<string> {
  server = createServer((request, response) => {
    const body = files[(request.url ?? '/').slice(1)];
    if (body === undefined) return void response.writeHead(404).end();
    response.writeHead(200).end(body);
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('probeRelease', () => {
  it('passes a manifest of the tag whose files match their sha512', async () => {
    const baseUrl = await serve({
      'v1-stable.yml': manifest('1.0.0', sha512(INSTALLER)),
      'chord-1.0.0-x64.exe': INSTALLER,
    });

    const receipt = await probeRelease({ tag: 'v1.0.0', baseUrl, manifests: ['v1-stable.yml'] });

    expect(receipt.ok).toBe(true);
    expect(receipt.tag).toBe('v1.0.0');
    expect(receipt.checks.map((c) => c.name)).toEqual([
      'v1-stable.yml version',
      'sha512 chord-1.0.0-x64.exe',
    ]);
  });

  it('fails a file served with a different sha512, naming it', async () => {
    const baseUrl = await serve({
      'v1-stable.yml': manifest('1.0.0', sha512(Buffer.from('other bytes'))),
      'chord-1.0.0-x64.exe': INSTALLER,
    });

    const receipt = await probeRelease({ tag: 'v1.0.0', baseUrl, manifests: ['v1-stable.yml'] });

    expect(receipt.ok).toBe(false);
    expect(receipt.checks.find((c) => !c.ok)?.name).toBe('sha512 chord-1.0.0-x64.exe');
  });

  it('fails a manifest of another version, and one the host does not serve', async () => {
    const baseUrl = await serve({
      'v1-stable.yml': manifest('0.9.0', sha512(INSTALLER)),
      'chord-0.9.0-x64.exe': INSTALLER,
    });

    const receipt = await probeRelease({
      tag: 'v1.0.0',
      baseUrl,
      manifests: ['v1-stable.yml', 'v1-stable-mac.yml'],
    });

    expect(receipt.ok).toBe(false);
    const failed = receipt.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(['v1-stable.yml version', 'v1-stable-mac.yml fetch']);
  });
});
