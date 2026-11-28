import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net';
import { compareVersions } from '@chord/protocol';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopCompatibility } from '@shared/desktop-compatibility';
import { DesktopCompatibilityMonitor, readDesktopCompatibility } from './desktop-compatibility';

/**
 * The version handshake, read from a real local HTTP server
 * standing in for the sync server's /health. The bugs these catch: a prerelease
 * or a two-digit part compared as text (1.0.0-canary.1 above 1.0.0, 0.10.0 below
 * 0.9.0), an old app let through or a current one blocked, an unreachable or
 * broken server read as "update required" (which would lock users out of a
 * working app), and a change that never reaches the renderer.
 */
/** These tests are about one launch: nothing is remembered between them. */
const noMemory = { load: async () => null, save: async () => {} };

let server: Server;
let base: string;
let statusCode = 200;

function monitorOf(
  currentVersion: () => Promise<string>,
  onChange: (s: DesktopCompatibility) => void = () => {},
  intervals = { regular: 60_000, paused: 60_000 }
) {
  return new DesktopCompatibilityMonitor({
    memory: noMemory,
    baseUrl: base,
    currentVersion,
    onChange,
    onVerdict: () => {},
    intervals,
  });
}
let body: unknown = { status: 'ok' };
/** Delays of the next /health answers, one per request, in ms. */
let delays: number[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    // A deployment mounted under a path prefix answers there, with its own minimum.
    if (req.url === '/api/health') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', min_desktop_version: '9.0.0' }));
      return;
    }
    if (req.url !== '/health') {
      res.statusCode = 404;
      res.end();
      return;
    }
    const answer = () => {
      res.statusCode = statusCode;
      res.setHeader('content-type', 'application/json');
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const delay = delays.shift() ?? 0;
    if (delay > 0) setTimeout(answer, delay);
    else answer();
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
  delays = [];
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

  // Decision: semver order is kept. A beta of 0.2.0 is older than 0.2.0, so a
  // minimum of 0.2.0 turns it away; a minimum that names the prerelease admits
  // it and every later prerelease of that version.
  it('a minimum admits a prerelease only when it names one', async () => {
    body = { status: 'ok', min_desktop_version: '0.2.0' };
    expect((await readDesktopCompatibility(base, '0.2.0-beta.1')).state).toBe('update_required');
    body = { status: 'ok', min_desktop_version: '0.2.0-beta.1' };
    expect((await readDesktopCompatibility(base, '0.2.0-beta.1')).state).toBe('supported');
    expect((await readDesktopCompatibility(base, '0.2.0-beta.2')).state).toBe('supported');
    expect((await readDesktopCompatibility(base, '0.2.0-alpha.9')).state).toBe('update_required');
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
    // The parse error itself, not just "not JSON".
    expect(states[2]).toMatchObject({
      reason: expect.stringMatching(/Unexpected token|not valid JSON/),
    });
  });

  // new URL('/health', base) would drop a path prefix in the base.
  it('a base URL with a path prefix is read under that prefix', async () => {
    expect(await readDesktopCompatibility(`${base}/api`, '1.0.0')).toEqual({
      state: 'update_required',
      current: '1.0.0',
      minimum: '9.0.0',
    });
    expect((await readDesktopCompatibility(`${base}/api/`, '1.0.0')).state).toBe('update_required');
  });

  // The first reading is what lets the renderer leave its
  // placeholder, so it is reported even when it is unknown; a later unknown is not.
  it('the first completed reading is reported, even an unknown one', async () => {
    const changes: DesktopCompatibility[] = [];
    const monitor = monitorOf(
      async () => '1.0.0',
      (s) => changes.push(s)
    );
    expect(monitor.getState()).toMatchObject({ state: 'unknown', checked: false });
    statusCode = 503;
    await monitor.check();
    expect(changes).toEqual([
      { state: 'unknown', checked: true, reason: expect.stringContaining('503') },
    ]);
    await monitor.check();
    expect(changes).toHaveLength(1);
    expect(monitor.getState()).toMatchObject({ state: 'unknown', checked: true });
  });

  it('the monitor reports each change once and holds the state', async () => {
    const changes: DesktopCompatibility[] = [];
    const monitor = monitorOf(
      async () => '1.0.0',
      (s) => changes.push(s)
    );
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

  // A failed re-check must not let an app the
  // server already turned away back in; only a supported reading clears it.
  it('a verdict survives a failed re-check', async () => {
    const changes: DesktopCompatibility[] = [];
    const monitor = monitorOf(
      async () => '1.0.0',
      (s) => changes.push(s)
    );
    body = { status: 'ok', min_desktop_version: '2.0.0' };
    await monitor.check();
    statusCode = 503;
    expect((await monitor.check()).state).toBe('unknown');
    expect(monitor.getState().state).toBe('update_required');
    statusCode = 200;
    body = { status: 'ok', min_desktop_version: '1.0.0' };
    await monitor.check();
    expect(changes.map((c) => c.state)).toEqual(['update_required', 'supported']);
    // a version that cannot be read is a reading, not a crash
    const unreadable = monitorOf(async () => {
      throw new Error('no package.json');
    });
    expect(await unreadable.check()).toMatchObject({
      state: 'unknown',
      reason: expect.stringContaining('no package.json'),
    });
  });

  // The window stays blank until the first reading completes: a network that
  // accepts the connection and never answers must not hold it for the full
  // periodic timeout (10 s).
  it('the first reading gives up on a silent server within 4 s', async () => {
    const sockets = new Set<Socket>();
    const silent = createTcpServer((socket) => {
      sockets.add(socket);
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const silentBase = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`;
    const changes: DesktopCompatibility[] = [];
    const monitor = new DesktopCompatibilityMonitor({
      memory: noMemory,
      baseUrl: silentBase,
      currentVersion: async () => '1.0.0',
      onChange: (s) => changes.push(s),
      onVerdict: () => {},
      intervals: { regular: 60_000, paused: 60_000 },
    });
    const started = Date.now();
    try {
      expect((await monitor.check()).state).toBe('unknown');
      expect(Date.now() - started).toBeLessThan(4_000);
      expect(changes).toEqual([{ state: 'unknown', checked: true, reason: expect.any(String) }]);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  }, 15_000);

  // A minimum lowered or rolled back must let a paused app back in on the
  // short paused interval, not the regular one (30 minutes in the app).
  it('a started monitor re-checks on the paused interval while turned away', async () => {
    const verdicts: string[] = [];
    const monitor = new DesktopCompatibilityMonitor({
      memory: noMemory,
      baseUrl: base,
      currentVersion: async () => '1.0.0',
      onChange: () => {},
      onVerdict: (s) => verdicts.push(s.state),
      intervals: { regular: 60_000, paused: 100 },
    });
    body = { status: 'ok', min_desktop_version: '2.0.0' };
    void monitor.start();
    try {
      await vi.waitFor(() => expect(monitor.getState().state).toBe('update_required'), {
        timeout: 2_000,
        interval: 20,
      });
      body = { status: 'ok', min_desktop_version: '0.1.0' };
      await vi.waitFor(() => expect(monitor.getState().state).toBe('supported'), {
        timeout: 2_000,
        interval: 20,
      });
      // Supported: the next check waits the regular interval.
      const settled = verdicts.length;
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(verdicts).toHaveLength(settled);
      expect(verdicts.at(-1)).toBe('supported');
    } finally {
      monitor.stop();
    }
  });

  // A cold boot can keep the first reading past its short timeout although the
  // server answers: the app is let through, then turned away seconds later by
  // an immediate second reading with the full timeout, not minutes later.
  it('a first reading that timed out is asked again at once with the full timeout', async () => {
    const monitor = monitorOf(
      async () => '1.0.0',
      () => {},
      { regular: 60_000, paused: 60_000 }
    );
    body = { status: 'ok', min_desktop_version: '2.0.0' };
    delays = [3_500, 3_500];
    const started = Date.now();
    void monitor.start();
    try {
      await vi.waitFor(() => expect(monitor.getState().state).toBe('update_required'), {
        timeout: 12_000,
        interval: 50,
      });
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      monitor.stop();
    }
  }, 15_000);

  // A listener that throws must not end the schedule, or an app turned away
  // could stay paused for good.
  it('a started monitor keeps checking after a listener throws', async () => {
    let calls = 0;
    const monitor = new DesktopCompatibilityMonitor({
      memory: noMemory,
      baseUrl: base,
      currentVersion: async () => '1.0.0',
      onChange: () => {},
      onVerdict: () => {
        calls += 1;
        if (calls === 1) throw new Error('listener failed');
      },
      intervals: { regular: 100, paused: 100 },
    });
    body = { status: 'ok', min_desktop_version: '0.1.0' };
    void monitor.start();
    try {
      await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(3), {
        timeout: 2_000,
        interval: 20,
      });
    } finally {
      monitor.stop();
    }
  });

  // A first reading that failed (a slow boot or network) let the app through
  // unjudged: it is asked again on the short interval too.
  it('a started monitor that has not read the server re-checks on the short interval', async () => {
    const monitor = monitorOf(
      async () => '1.0.0',
      () => {},
      { regular: 60_000, paused: 100 }
    );
    statusCode = 503;
    void monitor.start();
    try {
      await vi.waitFor(() => expect(monitor.getState()).toMatchObject({ checked: true }), {
        timeout: 2_000,
        interval: 20,
      });
      statusCode = 200;
      body = { status: 'ok', min_desktop_version: '2.0.0' };
      await vi.waitFor(() => expect(monitor.getState().state).toBe('update_required'), {
        timeout: 2_000,
        interval: 20,
      });
    } finally {
      monitor.stop();
    }
  });
});
