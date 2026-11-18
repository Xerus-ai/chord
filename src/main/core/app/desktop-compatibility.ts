import { compareVersions, SemverSchema, ServerHealthSchema } from '@chord/protocol';
import type { DesktopCompatibility } from '@shared/desktop-compatibility';
import { serverTraffic } from './server-traffic';

/**
 * The desktop half of the version handshake (devstation-mg6u.2): read the sync
 * server's /health and compare this app's version with the minimum it names.
 */

const TIMEOUT_MS = 10_000;

export async function readDesktopCompatibility(
  baseUrl: string,
  current: string
): Promise<DesktopCompatibility> {
  if (!SemverSchema.safeParse(current).success) {
    return {
      state: 'unknown',
      checked: true,
      reason: `this app's version is unreadable: ${current}`,
    };
  }
  let res: Response;
  try {
    // Relative to the base with a trailing slash, so a path prefix in it is kept.
    const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    res = await fetch(new URL('health', root), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return { state: 'unknown', checked: true, reason: `sync server unreachable: ${String(error)}` };
  }
  if (!res.ok) {
    return {
      state: 'unknown',
      checked: true,
      reason: `sync server /health answered ${res.status}`,
    };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    return {
      state: 'unknown',
      checked: true,
      reason: `sync server /health is not JSON: ${String(error)}`,
    };
  }
  const health = ServerHealthSchema.safeParse(body);
  if (!health.success) {
    return {
      state: 'unknown',
      checked: true,
      reason: `sync server /health: ${health.error.message}`,
    };
  }
  const minimum = health.data.min_desktop_version ?? null;
  if (minimum !== null && compareVersions(current, minimum) < 0) {
    return { state: 'update_required', current, minimum };
  }
  return { state: 'supported', current, minimum };
}

/**
 * Holds the verdict and reports each change. A reading that fails (unknown)
 * never replaces a verdict the server already gave: an app told to update stays
 * told until the server says otherwise, and going offline does not let it in.
 * After every completed check the verdict it holds drives serverTraffic, which
 * pauses main's own traffic to the sync server (devstation-mg6u.5).
 */
export class DesktopCompatibilityMonitor {
  private state: DesktopCompatibility = {
    state: 'unknown',
    checked: false,
    reason: 'not checked yet',
  };

  constructor(
    private readonly options: {
      baseUrl: string;
      currentVersion: () => Promise<string>;
      onChange: (state: DesktopCompatibility) => void;
    }
  ) {}

  getState(): DesktopCompatibility {
    return this.state;
  }

  /** Reads the server once; returns that reading, which may differ from the state kept. */
  async check(): Promise<DesktopCompatibility> {
    let reading: DesktopCompatibility;
    try {
      reading = await readDesktopCompatibility(
        this.options.baseUrl,
        await this.options.currentVersion()
      );
    } catch (error) {
      reading = {
        state: 'unknown',
        checked: true,
        reason: `this app's version could not be read: ${String(error)}`,
      };
    }
    // The first completed reading is always reported: it is what lets the
    // renderer leave its placeholder, even when it is unknown (mg6u.5).
    const first = this.state.state === 'unknown' && !this.state.checked;
    const keep = reading.state === 'unknown' && this.state.state !== 'unknown';
    if (!keep) {
      const changed =
        first ||
        reading.state !== this.state.state ||
        (reading.state !== 'unknown' && JSON.stringify(reading) !== JSON.stringify(this.state));
      this.state = reading;
      if (changed) this.options.onChange(reading);
    }
    serverTraffic.apply(this.state);
    return reading;
  }
}
