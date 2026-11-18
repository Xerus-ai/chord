import { compareVersions, SemverSchema, ServerHealthSchema } from '@chord/protocol';
import type { DesktopCompatibility } from '@shared/desktop-compatibility';

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
    return { state: 'unknown', reason: `this app's version is unreadable: ${current}` };
  }
  let res: Response;
  try {
    res = await fetch(new URL('/health', baseUrl), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return { state: 'unknown', reason: `sync server unreachable: ${String(error)}` };
  }
  if (!res.ok) return { state: 'unknown', reason: `sync server /health answered ${res.status}` };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { state: 'unknown', reason: 'sync server /health is not JSON' };
  }
  const health = ServerHealthSchema.safeParse(body);
  if (!health.success) {
    return { state: 'unknown', reason: `sync server /health: ${health.error.message}` };
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
 */
export class DesktopCompatibilityMonitor {
  private state: DesktopCompatibility = { state: 'unknown', reason: 'not checked yet' };

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
        reason: `this app's version could not be read: ${String(error)}`,
      };
    }
    if (reading.state === 'unknown' && this.state.state !== 'unknown') return reading;
    const changed =
      reading.state !== this.state.state ||
      (reading.state !== 'unknown' && JSON.stringify(reading) !== JSON.stringify(this.state));
    this.state = reading;
    if (changed) this.options.onChange(reading);
    return reading;
  }
}
