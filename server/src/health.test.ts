import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { compareVersions, MIN_DESKTOP_VERSION, ServerHealthSchema } from '@chord/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The server half of the version handshake (devstation-mg6u.2): the real app
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

  // devstation-mg6u.5, the equality boundary: the minimum ships with the server
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
});
