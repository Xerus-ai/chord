import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopCompatibility } from '@shared/desktop-compatibility';

/**
 * The verdict an app was turned away with, remembered across launches. The bug
 * these catch: an app told to update, relaunched with the sync server out of
 * reach, read "unknown", opened its traffic to the server and drained its queue
 * for up to half an hour once the network came back. Read from a real local
 * /health and the real settings store on a migrated test database.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { DesktopCompatibilityMonitor } = await import('./desktop-compatibility');
const { settingsVerdictMemory } = await import('./desktop-compatibility-memory');
const { appSettingsService } = await import('@main/core/settings/settings-service');

let server: Server;
let base: string;
let reachable = true;
let minimum: string | null = null;

beforeAll(async () => {
  server = createServer((_req, res) => {
    if (!reachable) {
      res.statusCode = 503;
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', min_desktop_version: minimum }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(async () => {
  reachable = true;
  minimum = null;
  await appSettingsService.reset('desktopCompatibility');
});

/** One launch of the app at `version`: its monitor started, the first check done. */
async function launch(version: string) {
  const changes: DesktopCompatibility[] = [];
  const verdicts: DesktopCompatibility[] = [];
  const monitor = new DesktopCompatibilityMonitor({
    baseUrl: base,
    currentVersion: async () => version,
    onChange: (s) => changes.push(s),
    onVerdict: (s) => verdicts.push(s),
    intervals: { regular: 60_000, paused: 60_000 },
    memory: settingsVerdictMemory,
  });
  // start() resolves once the remembered verdict is applied and the first check is done
  await monitor.start();
  monitor.stop();
  return { monitor, changes, verdicts };
}

describe('the verdict across launches', () => {
  it('an app turned away and relaunched offline starts turned away and stays so', async () => {
    minimum = '2.0.0';
    const first = await launch('1.0.0');
    expect(first.monitor.getState().state).toBe('update_required');

    reachable = false;
    const offline = await launch('1.0.0');
    // the first verdict, before any reading, already pauses traffic
    expect(offline.verdicts[0]).toEqual({
      state: 'update_required',
      current: '1.0.0',
      minimum: '2.0.0',
    });
    expect(offline.verdicts.every((v) => v.state === 'update_required')).toBe(true);
    expect(offline.changes.map((c) => c.state)).toEqual(['update_required']);
  });

  it('a supported verdict forgets the minimum, so the next offline launch is let in', async () => {
    minimum = '2.0.0';
    await launch('1.0.0');
    minimum = '1.0.0';
    const lowered = await launch('1.0.0');
    expect(lowered.monitor.getState().state).toBe('supported');

    reachable = false;
    const offline = await launch('1.0.0');
    expect(offline.verdicts.some((v) => v.state === 'update_required')).toBe(false);
    expect(offline.monitor.getState().state).toBe('unknown');
  });

  it('an app updated past the remembered minimum is not turned away offline', async () => {
    minimum = '2.0.0';
    await launch('1.0.0');
    reachable = false;
    const updated = await launch('2.1.0');
    expect(updated.verdicts.some((v) => v.state === 'update_required')).toBe(false);
  });

  it('the settings store holds the minimum: none by default, the one saved read back', async () => {
    expect(await settingsVerdictMemory.load()).toBeNull();
    await settingsVerdictMemory.save('3.1.0');
    expect(await settingsVerdictMemory.load()).toBe('3.1.0');
    expect(await appSettingsService.get('desktopCompatibility')).toEqual({
      requiredMinimum: '3.1.0',
    });
    await settingsVerdictMemory.save(null);
    expect(await settingsVerdictMemory.load()).toBeNull();
  });
});
