import { compareVersions, SemverSchema, ServerHealthSchema } from '@chord/protocol';

/**
 * The desktop half of the version handshake (devstation-mg6u.2): read the sync
 * server's /health and compare this app's version with the minimum it names.
 *   supported        at or above the minimum, or the server names none
 *   update_required  below it: the renderer shows the update-required screen
 *   unknown          the server could not be read; never blocks (offline is
 *                    shown elsewhere), and the next check tries again
 */
export type DesktopCompatibility =
  | { state: 'supported'; current: string; minimum: string | null }
  | { state: 'update_required'; current: string; minimum: string }
  | { state: 'unknown'; reason: string };

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

/** Holds the last reading and reports each change of state. */
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

  async check(): Promise<DesktopCompatibility> {
    const next = await readDesktopCompatibility(
      this.options.baseUrl,
      await this.options.currentVersion()
    );
    const changed = JSON.stringify(next) !== JSON.stringify(this.state);
    this.state = next;
    if (changed) this.options.onChange(next);
    return next;
  }
}
