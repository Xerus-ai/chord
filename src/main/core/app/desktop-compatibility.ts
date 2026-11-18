import { compareVersions, SemverSchema, ServerHealthSchema } from '@chord/protocol';
import type { DesktopCompatibility } from '@shared/desktop-compatibility';
import { log } from '@main/lib/logger';

/**
 * The desktop half of the version handshake: read the sync server's /health
 * and compare this app's version with the minimum it names.
 */

/** A periodic check: nothing waits on it. */
const TIMEOUT_MS = 10_000;
/**
 * The first reading: the window shows a blank placeholder until it completes,
 * so a network that drops requests silently must not hold it for long.
 */
const FIRST_READING_TIMEOUT_MS = 3_000;

export async function readDesktopCompatibility(
  baseUrl: string,
  current: string,
  timeoutMs = TIMEOUT_MS
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
    res = await fetch(new URL('health', root), { signal: AbortSignal.timeout(timeoutMs) });
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
  // Semver order: a prerelease sorts below its release, so a minimum admits a
  // prerelease of that version only when it names one (see MIN_DESKTOP_VERSION).
  if (minimum !== null && compareVersions(current, minimum) < 0) {
    return { state: 'update_required', current, minimum };
  }
  return { state: 'supported', current, minimum };
}

export interface DesktopCompatibilityMonitorOptions {
  baseUrl: string;
  currentVersion: () => Promise<string>;
  /** Each change of the verdict kept, and the first completed reading. */
  onChange: (state: DesktopCompatibility) => void;
  /** After every completed check, with the verdict kept (what drives server traffic). */
  onVerdict: (state: DesktopCompatibility) => void;
  /**
   * The wait between checks once started: `regular` while supported, `paused`
   * otherwise. Turned away, a lowered minimum lets the app back in soon; never
   * read (a first reading that timed out on a slow boot or network), the
   * verdict it let through is asked for again soon, not half an hour later.
   */
  intervals: { regular: number; paused: number };
}

/**
 * Holds the verdict and reports each change. A reading that fails (unknown)
 * never replaces a verdict the server already gave: an app told to update stays
 * told until the server says otherwise, and going offline does not let it in.
 */
export class DesktopCompatibilityMonitor {
  private state: DesktopCompatibility = {
    state: 'unknown',
    checked: false,
    reason: 'not checked yet',
  };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly options: DesktopCompatibilityMonitorOptions) {}

  getState(): DesktopCompatibility {
    return this.state;
  }

  /** Checks now, then again after each interval until stop(). */
  start(): void {
    this.running = true;
    void this.checkAndSchedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Reads the server once; returns that reading, which may differ from the state kept. */
  async check(): Promise<DesktopCompatibility> {
    // The first completed reading is always reported: it is what lets the
    // renderer leave its placeholder, even when it is unknown.
    const first = this.state.state === 'unknown' && !this.state.checked;
    let reading: DesktopCompatibility;
    try {
      reading = await readDesktopCompatibility(
        this.options.baseUrl,
        await this.options.currentVersion(),
        first ? FIRST_READING_TIMEOUT_MS : TIMEOUT_MS
      );
    } catch (error) {
      reading = {
        state: 'unknown',
        checked: true,
        reason: `this app's version could not be read: ${String(error)}`,
      };
    }
    const keep = reading.state === 'unknown' && this.state.state !== 'unknown';
    if (!keep) {
      const changed =
        first ||
        reading.state !== this.state.state ||
        (reading.state !== 'unknown' && JSON.stringify(reading) !== JSON.stringify(this.state));
      this.state = reading;
      if (changed) this.options.onChange(reading);
    }
    this.options.onVerdict(this.state);
    return reading;
  }

  private async checkAndSchedule(): Promise<void> {
    const reading = await this.check();
    if (reading.state === 'unknown') log.info(`desktop compatibility not read: ${reading.reason}`);
    if (!this.running) return;
    const { regular, paused } = this.options.intervals;
    const wait = this.state.state === 'supported' ? regular : paused;
    this.timer = setTimeout(() => void this.checkAndSchedule(), wait);
    this.timer.unref?.();
  }
}
