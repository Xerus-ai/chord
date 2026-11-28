import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServerHealth } from '@chord/protocol';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DesktopCompatibility } from '@shared/desktop-compatibility';
import { DesktopCompatibilityMonitor } from './desktop-compatibility';

/**
 * What else rides the handshake's /health reading (the feature flags, devstation-mg6u.98), read
 * from a real local /health. The bugs these catch: a flags reader that stalls holds the verdict
 * (and with it every sender the verdict opens), a reader that throws changes the verdict, an app
 * whose version is unreadable never gets the flags, and a monitor stopped before it started
 * (the service disposed while the flags restore runs) reads the server anyway.
 */
let server: Server;
let base: string;
let requests = 0;
let body: unknown = { status: 'ok' };

beforeAll(async () => {
  server = createServer((_req, res) => {
    requests += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  requests = 0;
  body = { status: 'ok' };
});

function monitor(options: {
  version?: string;
  onHealth: (health: ServerHealth) => void | Promise<void>;
  verdicts?: DesktopCompatibility[];
}) {
  return new DesktopCompatibilityMonitor({
    baseUrl: base,
    currentVersion: async () => options.version ?? '1.0.0',
    onChange: () => {},
    onVerdict: (state) => options.verdicts?.push(state),
    intervals: { regular: 60_000, paused: 60_000 },
    memory: { load: async () => null, save: async () => {} },
    onHealth: options.onHealth,
    healthReaderTimeoutMs: 50,
  });
}

const within = <T>(ms: number, p: Promise<T>) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`not within ${ms} ms`)), ms)
    ),
  ]);

describe('readers of the /health answer', () => {
  it('a stalled flags reader does not hold the verdict', async () => {
    body = { status: 'ok', min_desktop_version: '2.0.0' };
    const verdicts: DesktopCompatibility[] = [];
    const m = monitor({ onHealth: () => new Promise(() => {}), verdicts });
    const reading = await within(2_000, m.check());
    expect(reading).toEqual({ state: 'update_required', current: '1.0.0', minimum: '2.0.0' });
    expect(verdicts.map((v) => v.state)).toEqual(['update_required']);
  });

  it('a throwing flags reader leaves the verdict alone', async () => {
    body = { status: 'ok', min_desktop_version: '2.0.0' };
    const verdicts: DesktopCompatibility[] = [];
    const m = monitor({
      onHealth: () => {
        throw new Error('settings store gone');
      },
      verdicts,
    });
    expect((await m.check()).state).toBe('update_required');
    expect(verdicts.map((v) => v.state)).toEqual(['update_required']);
  });

  // devstation-mg6u.94 moved here: a flags field this app cannot read must not cost the verdict.
  it('a malformed flags field leaves the verdict alone and reads as no flags', async () => {
    const seen: unknown[] = [];
    body = { status: 'ok', min_desktop_version: '2.0.0', flags: { whats_new: 'yes' } };
    const m = monitor({ onHealth: (h) => void seen.push(h.flags) });
    expect(await m.check()).toEqual({
      state: 'update_required',
      current: '1.0.0',
      minimum: '2.0.0',
    });
    body = { status: 'ok', min_desktop_version: '0.1.0', flags: 'all' };
    expect((await m.check()).state).toBe('supported');
    expect(seen).toEqual([undefined, undefined]);
  });

  it('an app whose version is unreadable still gets the flags', async () => {
    body = { status: 'ok', flags: { whats_new: true } };
    const seen: unknown[] = [];
    const m = monitor({ version: 'not-a-version', onHealth: (h) => void seen.push(h.flags) });
    const reading = await m.check();
    expect(reading.state).toBe('unknown');
    expect(reading.state === 'unknown' && reading.reason).toMatch(/not-a-version/);
    expect(seen).toEqual([{ whats_new: true }]);
  });

  it('a monitor stopped before it starts never reads the server', async () => {
    const m = monitor({ onHealth: () => {} });
    m.stop();
    await m.start();
    expect(requests).toBe(0);
  });
});
