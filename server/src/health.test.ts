import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MIN_DESKTOP_VERSION, ServerHealthSchema } from '@chord/protocol';
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
    expect(MIN_DESKTOP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
