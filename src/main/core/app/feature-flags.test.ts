import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FeatureFlags } from '@chord/protocol';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerdictMemory } from './desktop-compatibility';

/**
 * Feature flags in main (devstation-mg6u.90): the sync server's /health names which flags are on;
 * main keeps the last answer in the app settings and reports each change. The bugs these catch: a
 * flag that stays on after the server turns it off, an old server (no `flags`) read as anything
 * but all off, an offline relaunch that forgets what the server said, and a profile that never
 * reached the server showing an unfinished feature. A real local /health, the real handshake
 * monitor and the real settings store on a migrated test database.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { DesktopCompatibilityMonitor } = await import('./desktop-compatibility');
const { FeatureFlagsStore, settingsFlagsMemory } = await import('./feature-flags');
const { appSettingsService } = await import('@main/core/settings/settings-service');

let server: Server;
let base: string;
let reachable = true;
let flags: Record<string, boolean> | undefined;

beforeAll(async () => {
  server = createServer((_req, res) => {
    if (!reachable) {
      res.statusCode = 503;
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', ...(flags === undefined ? {} : { flags }) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(async () => {
  reachable = true;
  flags = undefined;
  await appSettingsService.reset('featureFlags');
});

const noVerdictMemory: VerdictMemory = { load: async () => null, save: async () => {} };

/** One launch: the flags restored from settings, then the handshake's first reading applied. */
async function launch() {
  const changes: FeatureFlags[] = [];
  const store = new FeatureFlagsStore({
    memory: settingsFlagsMemory,
    onChange: (next) => changes.push(next),
  });
  await store.restore();
  const monitor = new DesktopCompatibilityMonitor({
    baseUrl: base,
    currentVersion: async () => '1.0.0',
    onChange: () => {},
    onVerdict: () => {},
    intervals: { regular: 60_000, paused: 60_000 },
    memory: noVerdictMemory,
    onHealth: (health) => store.apply(health),
  });
  await monitor.start();
  monitor.stop();
  return { store, monitor, changes };
}

describe('feature flags from the sync server', () => {
  it('a flag the server serves turns on, and turns off when the server stops serving it', async () => {
    flags = { whats_new: true };
    const app = await launch();
    expect(app.store.get().whats_new).toBe(true);
    expect(app.changes.at(-1)?.whats_new).toBe(true);

    flags = { whats_new: false };
    await app.monitor.check();
    expect(app.store.get().whats_new).toBe(false);
    expect(app.changes.at(-1)?.whats_new).toBe(false);
  });

  it('a server that sends no flags turns every flag off; a name the app does not know is ignored', async () => {
    flags = { whats_new: true, not_a_flag: true };
    const app = await launch();
    expect(Object.keys(app.store.get())).not.toContain('not_a_flag');

    flags = undefined;
    await app.monitor.check();
    expect(Object.values(app.store.get()).every((on) => on === false)).toBe(true);
  });

  it('a relaunch with the server out of reach keeps the last served flags', async () => {
    flags = { whats_new: true };
    await launch();

    reachable = false;
    const offline = await launch();
    expect(offline.store.get().whats_new).toBe(true);
  });

  it('a profile that never read the server has every flag off', async () => {
    reachable = false;
    const offline = await launch();
    expect(Object.values(offline.store.get()).every((on) => on === false)).toBe(true);
    expect(offline.store.get().whats_new).toBe(false);
  });
});
