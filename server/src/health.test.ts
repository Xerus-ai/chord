import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { compareVersions, MIN_DESKTOP_VERSION, ServerHealthSchema } from '@chord/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The server half of the version handshake: the real app
 * from createApp, on a real port, answers /health without a token and names
 * the protocol's minimum desktop version. The bug this catches: a server that
 * stops advertising the minimum (or advertises one of its own), so old
 * desktops are never told to update.
 */
// No database for this app: nothing it builds may reach the shared dev/prod one.
vi.stubEnv('DATABASE_URL', '');
vi.stubEnv('DEV_MODE', '');
vi.stubEnv('WORKOS_CLIENT_ID', 'client_health_test');
const { createApp } = await import('./server');
const { ConnectionManager } = await import('./ws/connection-manager');

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer(createApp(new ConnectionManager()));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('/health', () => {
  it('health advertises the minimum desktop version', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const health = ServerHealthSchema.parse(await res.json());
    expect(health.status).toBe('ok');
    expect(health.min_desktop_version).toBe(MIN_DESKTOP_VERSION);
  });

  // The equality boundary: the minimum ships with the server
  // built from this commit, so the desktop built from it must be at or above
  // it, or a release would tell its own installers to update. The bug: a
  // minimum raised past the app's version in the same change.
  it('the advertised minimum never turns away the desktop built from the same commit', async () => {
    const desktop = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
    ) as { version: string };
    const health = ServerHealthSchema.parse(await (await fetch(`${base}/health`)).json());
    expect(health.min_desktop_version).toBeDefined();
    expect(compareVersions(desktop.version, health.min_desktop_version!)).toBeGreaterThanOrEqual(0);
  });

  /**
   * devstation-5s42: deploy.sh asserts /health's version equals the tag it
   * installed, so a server that reports a hardcoded version (the old '0.1.0')
   * would pass a deploy of the wrong release, and one that invents a version
   * outside a deploy would hide that nothing was deployed.
   */
  it('health reports the release it runs', async () => {
    const { SERVER_EPOCH } = await import('./ws/connection-manager');
    vi.stubEnv('CHORD_RELEASE_TAG', 'v1.2.3-canary.4');
    vi.stubEnv('CHORD_RELEASE_COMMIT', 'a'.repeat(40));
    const deployed = ServerHealthSchema.parse(await (await fetch(`${base}/health`)).json());
    expect(deployed.version).toBe('v1.2.3-canary.4');
    expect(deployed.commit).toBe('a'.repeat(40));
    expect(deployed.epoch).toBe(SERVER_EPOCH);
    expect(typeof SERVER_EPOCH).toBe('string');

    vi.stubEnv('CHORD_RELEASE_TAG', '');
    vi.stubEnv('CHORD_RELEASE_COMMIT', '');
    const undeployed = ServerHealthSchema.parse(await (await fetch(`${base}/health`)).json());
    expect(undeployed.version).toBeNull();
    expect(undeployed.commit).toBeNull();
  });
});
