import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkChannelsMeetMinimum } from './channel-minimum.ts';
import { meetsMinimum, readMinDesktopVersion } from './min-desktop.ts';

/**
 * A server release that raises MIN_DESKTOP_VERSION deploys only once every update channel
 * serves a desktop release that meets it (server/DEPLOYMENT.md section 7; devstation-mg6u.24).
 * An app below the minimum is told to update, so a minimum with nothing to update to on one
 * channel locks that channel's users out.
 */
const temps: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done));
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sha512 = (text: string) => createHash('sha512').update(text).digest('base64');

/** A bucket served over real HTTP from a temp dir: a missing key answers 404. */
async function serveBucket(files: Record<string, string>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'bucket-'));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const server = createServer((req, res) => {
    const path = join(dir, decodeURIComponent((req.url ?? '/').slice(1)));
    if (!existsSync(path)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(readFileSync(path));
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** One channel's three manifests, each listing one installer, all at `version`. */
function channel(name: 'stable' | 'canary', version: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const suffix of ['', '-mac', '-linux']) {
    const installer = `chord-${name}${suffix || '-win'}-${version}.bin`;
    files[installer] = `bytes of ${installer}`;
    files[`v1-${name}${suffix}.yml`] = [
      `version: ${version}`,
      'files:',
      `  - url: ${installer}`,
      `    sha512: ${sha512(files[installer])}`,
      '    size: 10',
      `path: ${installer}`,
      `sha512: ${sha512(files[installer])}`,
      "releaseDate: '2026-11-18T00:00:00.000Z'",
      '',
    ].join('\n');
  }
  return files;
}

describe('readMinDesktopVersion', () => {
  it('reads the minimum from packages/protocol/src/version.ts', () => {
    const source = "/** doc */\nexport const MIN_DESKTOP_VERSION = '1.2.0-canary.3';\n";

    expect(readMinDesktopVersion(source)).toBe('1.2.0-canary.3');
  });

  it('refuses a source without it', () => {
    expect(() => readMinDesktopVersion('export const X = 1;\n')).toThrow(/MIN_DESKTOP_VERSION/);
  });
});

describe('meetsMinimum', () => {
  it('orders canaries below their stable release', () => {
    expect(meetsMinimum('1.2.0', '1.2.0-canary.3')).toBe(true);
    expect(meetsMinimum('1.2.0-canary.3', '1.2.0-canary.3')).toBe(true);
    expect(meetsMinimum('1.2.0-canary.2', '1.2.0-canary.3')).toBe(false);
    expect(meetsMinimum('1.2.0-canary.9', '1.2.0')).toBe(false);
    expect(meetsMinimum('1.10.0', '1.9.0')).toBe(true);
  });
});

describe('checkChannelsMeetMinimum', () => {
  it('passes when both channels serve a release at or above the minimum, intact', async () => {
    const base = await serveBucket({
      ...channel('stable', '1.2.0'),
      ...channel('canary', '1.3.0-canary.1'),
    });

    const result = await checkChannelsMeetMinimum({ baseUrl: base, major: 1, min: '1.2.0' });

    expect(result.checks.filter((check) => !check.ok)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('fails when one channel still serves a release below the minimum', async () => {
    const base = await serveBucket({
      ...channel('stable', '1.2.0'),
      ...channel('canary', '1.2.0-canary.1'),
    });

    const result = await checkChannelsMeetMinimum({ baseUrl: base, major: 1, min: '1.2.0' });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => !check.ok)?.name).toBe('v1-canary.yml meets 1.2.0');
  });

  it('fails when a channel has no release at all', async () => {
    const base = await serveBucket(channel('stable', '1.2.0'));

    const result = await checkChannelsMeetMinimum({ baseUrl: base, major: 1, min: '1.2.0' });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => !check.ok)).toMatchObject({
      name: 'v1-canary.yml fetch',
      detail: 'answered 404',
    });
  });

  it('fails when a channel names a good version but an installer differs from its manifest', async () => {
    const files = { ...channel('stable', '1.2.0'), ...channel('canary', '1.2.1-canary.1') };
    files['chord-canary-mac-1.2.1-canary.1.bin'] = 'tampered';
    const base = await serveBucket(files);

    const result = await checkChannelsMeetMinimum({ baseUrl: base, major: 1, min: '1.2.0' });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => !check.ok)?.name).toBe(
      'sha512 chord-canary-mac-1.2.1-canary.1.bin'
    );
  });
});
