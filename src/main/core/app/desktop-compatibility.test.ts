import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { compareVersions } from '@chord/protocol';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DesktopCompatibilityMonitor,
  readDesktopCompatibility,
  type DesktopCompatibility,
} from './desktop-compatibility';

/**
 * The version handshake (devstation-mg6u.2), read from a real local HTTP server
 * standing in for the sync server's /health. The bugs these catch: a prerelease
 * or a two-digit part compared as text (1.0.0-canary.1 above 1.0.0, 0.10.0 below
 * 0.9.0), an old app let through or a current one blocked, an unreachable or
 * broken server read as "update required" (which would lock users out of a
 * working app), and a change that never reaches the renderer.
 */
let server: Server;
let base: string;
let statusCode = 200;
let body: unknown = { status: 'ok' };

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url !== '/health') {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json');
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  statusCode = 200;
  body = { status: 'ok' };
});

describe('version handshake', () => {
  it('compareVersions orders prereleases and multi-digit parts', () => {
    expect(compareVersions('1.0.0-canary.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-canary.1')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-canary.2', '1.0.0-canary.10')).toBeLessThan(0);
    expect(compareVersions('2.3.4', '2.3.4')).toBe(0);
    expect(() => compareVersions('banana', '1.0.0')).toThrow(/banana/);
  });

  it('an app below the minimum is update_required', async () => {
    body = { status: 'ok', min_desktop_version: '1.2.0' };
    expect(await readDesktopCompatibility(base, '1.1.9')).toEqual({
      state: 'update_required',
      current: '1.1.9',
      minimum: '1.2.0',
    });
    expect((await readDesktopCompatibility(base, '1.2.0-canary.1')).state).toBe('update_required');
  });

  it('an app at or above the minimum is supported', async () => {
    body = { status: 'ok', min_desktop_version: '1.2.0' };
    expect(await readDesktopCompatibility(base, '1.2.0')).toEqual({
      state: 'supported',
      current: '1.2.0',
      minimum: '1.2.0',
    });
    expect((await readDesktopCompatibility(base, '1.10.0')).state).toBe('supported');
    // A server deployed before the handshake names no minimum: it demands nothing.
    body = { status: 'ok', timestamp: '2026-11-17T00:00:00Z', version: '0.1.0' };
    expect(await readDesktopCompatibility(base, '0.1.0')).toEqual({
      state: 'supported',
      current: '0.1.0',
      minimum: null,
    });
  });

  it('an unreachable server or a bad body is unknown', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const gone = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const states: DesktopCompatibility[] = [await readDesktopCompatibility(gone, '0.1.0')];
    statusCode = 503;
    states.push(await readDesktopCompatibility(base, '0.1.0'));
    statusCode = 200;
    body = 'not json';
    states.push(await readDesktopCompatibility(base, '0.1.0'));
    body = { status: 'ok', min_desktop_version: 'banana' };
    states.push(await readDesktopCompatibility(base, '0.1.0'));
    for (const s of states) expect(s.state).toBe('unknown');
    expect(states[1]).toMatchObject({ reason: expect.stringContaining('503') });
  });

  it('the service emits a change and holds the state', async () => {
    const changes: DesktopCompatibility[] = [];
    const monitor = new DesktopCompatibilityMonitor({
      baseUrl: base,
      currentVersion: async () => '1.0.0',
      onChange: (s) => changes.push(s),
    });
    expect(monitor.getState().state).toBe('unknown');
    body = { status: 'ok', min_desktop_version: '0.1.0' };
    await monitor.check();
    await monitor.check();
    expect(changes.map((c) => c.state)).toEqual(['supported']);
    body = { status: 'ok', min_desktop_version: '2.0.0' };
    await monitor.check();
    expect(changes.map((c) => c.state)).toEqual(['supported', 'update_required']);
    expect(monitor.getState()).toEqual({
      state: 'update_required',
      current: '1.0.0',
      minimum: '2.0.0',
    });
  });
});
